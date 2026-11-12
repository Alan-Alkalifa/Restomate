# Contract: customer storefront, guest ordering, approval, guest status, requests (M4 §8, MCS-T01)

Draft 2026-11-12 by **DAVIN** for ALAN's review. **DAVIN** implements the schema, the RPCs and `lib/storefront`. **ADIT** builds the customer pages and the staff approval panels against it. **REYKI** writes the isolation tests against it. Changes need agreement from all three, plus ALAN, and are made in this file first. This is the "M4" contract that `docs/contracts/orders.md` defers to (QR/online approval, opening hours, secondary-table QR); it assumes orders.md (including *Table operations*) and `docs/contracts/bills.md`, and changes them only where listed in *Changes to existing contracts and RPCs*. **Payments are not here**: guests pay at the counter until M5 (DOKU).

Everything marked **Proposed** is a decision DAVIN made so the contract is complete; ALAN can overturn it. Product questions are in **Still open** at the end, not decided silently.

## Scope and rules that apply everywhere

- Hierarchy and money rules are those of orders.md: organization → location → table; money is `bigint` minor units plus the location's `currency`; no floats; amounts never negative.
- **The guest is anonymous and untrusted.** The client may send item ids, variant/modifier ids, quantities, notes, an optional contact name/phone, a pickup time and a `client_ref`. It never sends a price, name, total, tax, station, organization id, location id (for QR), table id, order id or status. Every one of those is derived on the server from the database.
- **Two kinds of access, and they are different on purpose:**
  1. *Public reads* (menu, hours, branding, pickup slots): security-definer functions executable by `anon`, returning whitelisted fields only. They already are public information.
  2. *Everything that writes, and every read that depends on a secret* (submitting an order, the guest status page, cancel, call-waiter): security-definer functions whose execute privilege is **revoked from `anon` and `authenticated` and granted to `service_role` only**. They are called from Next.js route/action code with the service-role client (`lib/supabase/admin.ts`, `server-only`; CLAUDE.md allows it for "the public storefront order intake") **after Arcjet has allowed the request**. Why: a function granted to `anon` can be called straight at PostgREST with the public key, which bypasses the Arcjet rules that live in the Next.js route; revoking it closes that bypass.
- Staff RPCs (accept, reject, list, acknowledge) are ordinary `authenticated` security-definer functions with the usual `has_permission` + `has_location_access` checks, `search_path = ''`, and the same `FORBIDDEN` (`42501`) for an unknown id and a missing permission.
- **Clients never write storefront tables.** `INSERT/UPDATE/DELETE` is revoked from `anon` and `authenticated` on every new table; `SELECT` is granted per column with RLS (staff only, `orders.view` + location access). Guests have no table access at all.
- RLS on every new table, and a pgTAP test that org A cannot read or write org B's rows.
- Timestamps are `timestamptz`; opening hours and "today" use the location's timezone.
- No customer PII (name, phone, notes) in PostHog, logs, Realtime payloads, cache keys or cache tags.

## Tenant resolution (host routing)

- `proxy.ts` maps `{slug}.{ROOT_DOMAIN}` to `/s/{slug}/…` (rewrite, no session refresh, cache-friendly) and the app host serves the dashboard. Custom domains need a verified `custom_domains` row and are **out of M4** (the proxy keeps returning 404 for an unknown host until that table exists; Decisions log 14).
- The slug is the **only** thing the host tells us. The server resolves it with `get_storefront(slug)` (exists): `null` for an unknown slug, `{ status: 'unavailable' }` for a suspended or non-active organization (the page shows a neutral "not available" screen, never why), otherwise the tenant's public data. A suspended organization can neither be browsed for ordering nor receive orders (`ORDERING_UNAVAILABLE`).
- **A token never overrides the host.** Every token route (`/t/{qr}`, `/o/{access}`) resolves the token, then compares the token's organization slug with the host's slug; a mismatch is answered exactly like an unknown token. This is what stops tenant A's QR from working on tenant B's domain, and it keeps cross-tenant probing uniform.
- Routes (all under `apps/web/app/(storefront)/s/[tenant]/`): `/` (menu + hours + order), `/t/[qrToken]` (QR landing, the cart for a table), `/o/[accessToken]` (guest order status). Server components read public data inside `<Suspense>`; the cached menu uses `'use cache'` tagged `storefront:{slug}`; anything time-dependent (open now, pickup slots, status) is **not** cached (`connection()`), so a stale cache can never let an order through.
- **Package gate:** guest ordering needs the organization's package feature `qr_ordering` (`FEATURE_KEYS`), checked server-side in every guest RPC and shown as "ordering unavailable" in the UI. The same flag gates QR and online pickup in M4 (Still open 12).

## Public reads (anon)

| Function | Returns |
|---|---|
| `get_storefront(slug)` (exists) | tenant name, branding (logo URL, colours, font, theme) and its active locations (name, address, city, phone, timezone) |
| `get_public_menu(org_slug, location_id)` (exists) | published, active, currently available items with the effective price, variants and modifier groups. Never costs, stock, stations or staff |
| `get_public_location_info(org_slug, location_id)` (new) | `{ name, currency, timezone, address, city, phone, taxRateBps, serviceChargeBps, taxOnServiceCharge, hours: [{ day, opens, closes }], openNow, ordering: { qr, online, accepting }, minOrderAmount, pickup: { leadMinutes, slotMinutes } }`. `null` for an unknown/inactive location, a location of another org, a suspended org |
| `get_pickup_slots(org_slug, location_id)` (new) | up to 24 upcoming pickup times today (ISO UTC), computed from the hours, the lead time and the slot length, in the location's timezone; `[]` when closed or online ordering is off |

Nothing else is readable by `anon`: no staff, no other tenant's data, no costs, no orders, no tokens. Location ids are already public (the menu function takes one), so they are not secrets, but they confer nothing: every write validates the location server-side.

Prices on the storefront are item prices; the page states service charge and tax are added (it shows `serviceChargeBps` / `taxRateBps` from `get_public_location_info`), and the submission response and the status page show the exact totals computed on the server with `calculateBill` (service charge first, then tax, the location's setting for tax-on-service; half-up IDR rounding), as in bills.md.

## Schema

### `location_ordering_settings` (one row per location; default row created with the location)

| Column | Rule |
|---|---|
| `location_id` (pk), `organization_id` | composite FK `(location_id, organization_id)` → `locations` |
| `qr_enabled` | boolean, default **true** |
| `online_enabled` | boolean, default **false** (the restaurant opts in) |
| `accepting_orders` | boolean, default true: the "pause ordering" switch, applies to both channels |
| `auto_accept_qr`, `auto_accept_online` | boolean, default **false** (Still open 1) |
| `pickup_lead_minutes` | integer 5..240, default 20 |
| `pickup_slot_minutes` | integer 5..60, default 15 |
| `pickup_max_orders_per_slot` | integer null (null = unlimited), 1..200 |
| `min_order_amount` | bigint ≥ 0, default 0 (none) |
| `pending_ttl_minutes` | integer 5..60, default 15 |
| `updated_at` | |

Writes: direct update through RLS + a column grant with **`locations.manage`** (the same permission as the other location settings; owners and custom roles that hold it). Reads: members with location access.

### `location_hours` (opening hours; guests only)

`id`, `organization_id`, `location_id`, `day_of_week` (0 = Sunday .. 6), `opens_min` (0..1439), `closes_min` (1..1440), `opens_min < closes_min`. Several rows per day are allowed (lunch and dinner); a late night past midnight is two rows (Friday 18:00 to 24:00, Saturday 00:00 to 02:00). An exclusion constraint on `(location_id, day_of_week, int4range(opens_min, closes_min))` forbids overlaps (needs `btree_gist`). **No rows at all means "not enforced / always open"** so existing tenants are not locked out (**Proposed**, Still open 4). Writes `locations.manage`; reads members. **Staff POS ignores hours** (orders.md); only guest channels enforce them.

### `guest_submissions` (the staging area: a guest's order waiting for staff)

A guest order is **not** an `orders` row until staff accept it. **Proposed, and the central design choice:** a submission is a priced snapshot in its own table, and acceptance runs the normal order-intake core, so no unaccepted item can reach a total, a bill, the KDS, a daily order number or the one-open-order-per-table index, and a flood of junk submissions cannot burn order numbers or touch real orders. (The alternative, orders sitting in `placed` with `pending` items, would touch the totals, the bill snapshot, the KDS filter and the counters; see Decisions log 1.)

| Column | Rule |
|---|---|
| `id` | uuid pk, **generated by the app server** (needed for the access token, below) |
| `organization_id`, `location_id` | composite FK as everywhere |
| `channel` | `qr` \| `online` |
| `table_id` | uuid null: the table whose QR was scanned (`qr` only); composite FK `(table_id, location_id)` → `tables`. A secondary (merged) table is stored as scanned and attaches to the group's order at acceptance |
| `status` | `pending` \| `accepted` \| `rejected` \| `cancelled` \| `expired` |
| `lines` | jsonb: the canonical request lines (`item_id`, `variant_id`, `modifier_ids` sorted, `quantity`, `note`), exactly the `submit_order_round` shape; used to re-validate at acceptance |
| `display` | jsonb: the priced snapshot shown to the guest (names, variant, modifiers text, quantity, unit and line totals) and the totals (`subtotal`, `serviceCharge`, `tax`, `total`) computed at submission |
| `currency` | char(3) |
| `contact_name` | text null ≤ 60 (**required for `online`**) |
| `contact_phone` | text null, digits with optional `+`, 6..20 (optional; online only asks if the location wants it, Still open 7) |
| `pickup_at` | timestamptz null: the chosen slot (`online`); null means ASAP |
| `client_ref` | uuid, **unique `(organization_id, client_ref)`** |
| `request_hash` | text: sha-256 of the canonical request, to detect a reused `client_ref` with a different body |
| `access_token_hash` | text, sha-256 of the guest access token, **unique**; the raw token is never stored (below) |
| `reason_code`, `reason_note` | set on rejection: code in `out_of_stock`, `kitchen_closed`, `table_unavailable`, `other`; note ≤ 80, shown to the guest |
| `order_id`, `round_id` | uuid null: set at acceptance (the order and round it became) |
| `decided_by`, `decided_at` | the staff member who accepted or rejected; **never shown to the guest** |
| `expires_at` | `created_at + pending_ttl_minutes` |
| `created_at`, `updated_at` | |

Constraints: `channel`/`status` checks; `qr` ⇒ `table_id` not null, `online` ⇒ `table_id` null and `contact_name` not null; `accepted` ⇒ `order_id` and `round_id` not null; `rejected` ⇒ `reason_code` not null. Indexes: `(location_id, status, created_at)`, `(table_id) where status = 'pending'`, `(access_token_hash)`.

RLS: `SELECT` on non-PII columns for `orders.view` + location access; `contact_name`/`contact_phone` are **not** in the client SELECT grant and are returned only by `list_guest_submissions` to callers with `orders.create` (below). No write path for clients.

### `guest_requests` (call waiter / request bill)

`id`, `organization_id`, `location_id`, `table_id` (composite FK), `kind` (`call_waiter` \| `request_bill`), `status` (`open` \| `acknowledged` \| `resolved`), `client_ref` (unique per org), `created_at`, `acknowledged_by`/`acknowledged_at`, `resolved_by`/`resolved_at`. **A table has at most one non-resolved request per kind** (unique partial index `(table_id, kind) where status <> 'resolved'`): pressing the button again while one is open returns the existing request instead of creating another. There is no free text from the guest (nothing to abuse or to moderate). RLS `SELECT`: `orders.view` + location access; writes only through the RPCs.

### Existing tables that change

- `orders.pickup_at` `timestamptz null` (set for accepted online orders; shown on the order board and the print route).
- `orders.customer_name` already exists (takeaway label ≤ 60): the online contact name is copied to it at acceptance; the phone is **not** copied (it stays in `guest_submissions` until purged, Still open 8).
- `order_events.event_type` gains `guest_order_accepted`, `guest_order_rejected`; `order_rounds` gains a nullable `guest_submission_id` (unique) so a round can be traced to the submission it came from.
- `orders.opened_by` and `orders.waiter_id` stay null for guest-created orders until a waiter takes the table (orders.md, *Table operations*).

### Guest access token

A guest proves "this is my order" with a random **256-bit token** carried in the URL (`/o/{token}`) and kept in a cookie on the device. Only `sha256(token)` is stored. To make a retry after a lost response safe (the raw token is not stored, so the database cannot reproduce it), the token is **derived on the app server**: `token = base64url(HMAC_SHA256(GUEST_TOKEN_KEY, submission_id))`, where `GUEST_TOKEN_KEY` is a server-only secret (new env var, validated in `lib/env.ts`, never `NEXT_PUBLIC_`; the user must add it to Vercel staging and to the agents' HQ app variables with different values before the implementation runs, see *Changes*). The app generates the submission id, passes the id and `sha256(token)` to `submit_guest_order`, and on a replay recomputes the same token from the returned id. The token grants read of that one submission, cancel while pending, and nothing else. It expires 12 hours after the submission reaches a terminal state (or its order completes); an expired token behaves like an unknown one. The page sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store` and is `noindex`.

## State machines

### Submission

`pending → accepted | rejected | cancelled | expired`. All four exits are terminal. No going back.

| Transition | Trigger | Who |
|---|---|---|
| `pending → accepted` | `accept_guest_submission`, or inside `submit_guest_order` when the location's auto-accept for that channel is on | `orders.create`, or system |
| `pending → rejected` | `reject_guest_submission` with a reason code | `orders.create` |
| `pending → cancelled` | `cancel_guest_submission` with the access token | the guest |
| `pending → expired` | `now() > expires_at` (evaluated lazily at read/write time and persisted; no scheduler needed) | system |

### What acceptance does to the order (reuses orders.md)

Acceptance calls the **same intake core as `submit_order_round`** (extracted into a private function by the implementation, *Changes*), with the guest's lines, inside one transaction:

1. **Re-validate** every line from the database as `submit_order_round` step 5 does (item active/published/available, not sold out, variant required, modifier group min/max). A line that is no longer valid fails the accept with `ITEM_UNAVAILABLE` (`details.itemIds`) and the submission stays `pending`; staff then reject it with reason `out_of_stock`. Prices are **recomputed at acceptance**, so a price changed since submission is charged at the current price; the guest status page then shows the new total. Partial acceptance is not offered in M4 (Still open 6).
2. **Find or create the order.** `qr`: the table's open dine-in order (the primary table, or the group's order when the scanned table is a secondary table) if it is `accepted`, `preparing` or `ready`: the lines become a new **round** on it (a guest add-on). If that order is `served` the accept fails with `ORDER_CLOSED` (staff reject or take the order over at the POS). If there is no open order, a new `dine_in`-style order is created with `channel = 'qr'`, the table is seated (`available → occupied`; a `reserved` or `needs_cleaning` table refuses with `TABLE_NOT_READY`). `online`: a new order with `channel = 'online'`, no table, `customer_name` and `pickup_at` from the submission.
3. **Status:** the order is created directly in `accepted` (it never sits in `placed`; the `draft`/`placed` states remain in the machine for POS carts and are unused by the guest flow), the derived path to `preparing`/`ready` applies exactly as for staff orders, tickets are created per station for the new round, and `order_events` records `guest_order_accepted` and `round_sent`. **The KDS receives tickets only after acceptance** (nothing exists for a pending submission). The plan limit `max_orders_per_month` is checked here, at acceptance, not at submission, so pending junk cannot consume a restaurant's quota.
4. The submission becomes `accepted` with `order_id`/`round_id` set; `decided_by` is the approver (null for auto-accept).

A rejected, cancelled or expired submission leaves **no trace in `orders`**.

## RPCs

### Guest paths (`service_role` only; called by Next.js after Arcjet)

| RPC | Behaviour |
|---|---|
| `get_qr_context(qr_token text)` | Resolves the token (reusing `resolve_table_qr`'s rules: active table, area, location, organization; **a rotated token does not resolve**) and returns `{ orgSlug, locationId, tableLabel, canOrder, reason, hasOpenOrder, orderServed }` where `reason` is one of `ok`, `closed`, `paused`, `ordering_off`, `table_not_ready`, `order_served`. `null` for anything unresolved (unknown, rotated, inactive): one answer for all, so a probe learns nothing |
| `submit_guest_order(...)` | See below |
| `get_guest_order(token_hash text)` | The status page payload (below), or `null` for unknown/expired token |
| `cancel_guest_submission(token_hash text)` | `pending → cancelled`; anything else returns the current state unchanged (idempotent) |
| `create_guest_request(qr_token text, kind text, client_ref uuid)` | Resolves the table, checks the location is active and ordering for that channel is on, and inserts a request unless one is already non-resolved for `(table, kind)`, in which case it returns that one (`replayed: true`). Rate limit and cooldown below |

#### `submit_guest_order`

```sql
public.submit_guest_order(
  submission_id uuid,         -- generated by the app server
  access_token_hash text,     -- sha256 of the derived token
  channel text,               -- 'qr' | 'online'
  qr_token text,              -- required for 'qr', null for 'online'
  org_slug text,              -- required for 'online' (the host's tenant); for 'qr' it must match the token's org
  location_id uuid,           -- required for 'online'; ignored for 'qr' (the table decides)
  lines jsonb,                -- 1..60, the submit_order_round line shape
  client_ref uuid,
  contact_name text default null, contact_phone text default null,
  pickup_at timestamptz default null
) returns jsonb
-- security definer, volatile, search_path = '', execute: service_role only
```

Returns `{ submissionId, status, replayed, totals: { subtotal, serviceCharge, tax, total }, currency, pickupAt }`; the app derives the token from `submissionId`.

All in **one transaction**:
1. **Resolve the scope from the server, never the client.** `qr`: the table from `qr_token` (unknown, rotated, inactive, or an organization slug that differs from `org_slug` → `QR_INVALID`). `online`: the active location of the active organization `org_slug` (else `ORDERING_UNAVAILABLE`).
2. **Gate:** package has `qr_ordering` and the organization is active (`ORDERING_UNAVAILABLE`); `location_ordering_settings`: the channel is enabled and `accepting_orders` (`ORDERING_UNAVAILABLE`); **opening hours** in the location timezone (`LOCATION_CLOSED`; skipped when the location has no hours rows).
3. **Idempotency.** Serialise on `(org, client_ref)`. Found with the same `request_hash` → return the stored result with `replayed = true`, changing nothing; a different hash → `CLIENT_REF_CONFLICT`. A guest retrying on flaky mobile data is therefore safe.
4. **Shape:** the `submit_order_round` rules (1..60 lines, quantity 1..99, note ≤ 200 stripped of control characters, no duplicate modifier ids, **unknown keys rejected**, no price/name/total key accepted). `online`: `contact_name` 1..60 required, `contact_phone` optional per the format above, `pickup_at` null (ASAP) or a slot that `get_pickup_slots` would return now (`PICKUP_TIME_INVALID`), and if `pickup_max_orders_per_slot` is set, the slot must still have room (`PICKUP_TIME_INVALID`). `qr`: no `pickup_at`.
5. **Table state (`qr`):** `available` or `occupied` with an open order that is `accepted`/`preparing`/`ready` is fine; `reserved`, `needs_cleaning` or an inactive table → `TABLE_NOT_READY`; an open order that is `served` → `ORDER_CLOSED` ("ask your waiter"). Pending caps: at most **3 pending submissions per table** and **50 per location** (`TOO_MANY_PENDING`), and a **20 second cooldown between submissions**, keyed by what the server actually knows at that point: **per table for `qr`** and **per client IP and location for `online`** (a new submission has no access token yet, so the cooldown cannot be per token). The cooldown is a database check against the most recent submission for that key, so it holds even if Arcjet is down.
6. **Recompute every line from the database** exactly as `submit_order_round` step 5 (item must belong to the resolved organization: another tenant's item id fails like an unavailable item, `ITEM_UNAVAILABLE`, with no hint that it exists elsewhere), compute the totals with the SQL mirror of `calculateBill`, enforce `min_order_amount` on the subtotal (`MIN_ORDER_NOT_MET`).
7. **Insert** the submission (`pending`, `expires_at`), the display snapshot, the hashes. If the location's auto-accept for the channel is on, run the acceptance (above) in the same transaction and return `status: 'accepted'`; an acceptance failure leaves the submission `pending` (not an error to the guest).
8. Emit `guest_submission.changed` on the staff channel (below). Nothing is written to `orders` unless auto-accepted.

### Staff paths (`authenticated`)

| RPC | Permission | Behaviour |
|---|---|---|
| `list_guest_submissions(location_id uuid, status text default 'pending')` | `orders.view`; contact fields only if the caller also holds `orders.create` | The staff inbox: `{ id, channel, status, tableLabel, pickupAt, submittedAt, expiresAt, lines (name, variant, modifiers text, quantity, note), totals, contactName?, contactPhone? }`. Expired rows are persisted as `expired` first |
| `accept_guest_submission(submission_id uuid)` | `orders.create` | Runs the acceptance above. Errors: `SUBMISSION_NOT_PENDING` (already decided or expired, idempotent for the same decision), `ITEM_UNAVAILABLE`, `ORDER_CLOSED`, `TABLE_NOT_READY`, `PLAN_LIMIT`. Returns `{ submissionId, orderId, orderNumber, roundNo }` |
| `reject_guest_submission(submission_id uuid, reason_code text, note text default null)` | `orders.create` | `pending → rejected`. `reason_code` in the fixed list; `note` ≤ 80 chars and is **shown to the guest**, so it must not contain names (UI hint). Audit row |
| `acknowledge_guest_request(request_id uuid)` | `orders.create` | `open → acknowledged` (idempotent) |
| `resolve_guest_request(request_id uuid)` | `orders.create` | `open`/`acknowledged → resolved`; the table can then be called again |

Every decision writes `order_events` (when an order exists) and `audit_logs` (actor, submission id, decision, reason code), with no contact data.

### Guest status payload (`get_guest_order`)

```ts
type GuestOrderView = {
  channel: 'qr' | 'online';
  status: 'waiting' | 'received' | 'preparing' | 'ready' | 'served' | 'done' | 'not_accepted' | 'cancelled' | 'expired';
  rejection: { reason: 'out_of_stock' | 'kitchen_closed' | 'table_unavailable' | 'other'; note: string | null } | null;
  orderNumber: number | null;            // after acceptance, e.g. "#42" for the pickup counter
  tableLabel: string | null;             // QR
  pickupAt: string | null;               // online
  location: { name: string; timezone: string; currency: string };
  lines: { name: string; variantName: string | null; modifiersText: string | null; quantity: number; note: string | null; lineTotal: number }[];
  totals: { subtotal: number; serviceCharge: number; tax: number; total: number };
  updatedAt: string;                      // for the poll's ETag
  now: string;
};
```

Status mapping: `pending` → `waiting`; `accepted` → derived from **the round's tickets** (no tickets/station-less: follows the order: `accepted`/`preparing` → `received`/`preparing`, `ready` → `ready`, `served` → `served`, `completed` → `done`; with tickets: all `new` → `received`, any `in_progress` → `preparing`, all `ready`/`bumped` → `ready`); `rejected` → `not_accepted`; the rest map by name. **Never present:** staff names or ids, `decided_by`, the order uuid, other guests' items or submissions, internal ids of any kind, costs, the contact phone, the waiter. The guest sees their own lines, their own totals and the order number only.

## Realtime

**Staff**: two new events on the existing private `location:{id}` channel (policy unchanged: `orders.view` or `kitchen.view`), emitted by triggers in the same transaction as the row change, **ids and statuses only**:

| Event | Payload |
|---|---|
| `guest_submission.changed` | `{ submissionId, status, channel, tableId, updatedAt }` |
| `guest_request.changed` | `{ requestId, tableId, kind, status, updatedAt }` |

No names, notes, phone, items or money. Clients treat them as a signal to refetch `list_guest_submissions` / the requests list through RLS, refetch on reconnect, never assume order, and show the reconnecting banner. Accepted submissions also emit the usual `order.changed`/`ticket.changed`.

**Guests: polling, not Realtime (Proposed).** Supabase private channels need an authenticated user, and a public (unauthenticated) channel cannot be authorized or rate limited per guest. The status page therefore polls `GET /o/{token}` (a Route Handler returning the payload, `no-store`, with an `ETag`/`If-None-Match` so an unchanged status answers `304` with no body): every 4 s while `waiting`/`received`/`preparing`, every 15 s when `ready`, stopping on a terminal status and when the tab is hidden. Backoff on errors. The poll is Arcjet rate limited per IP and token (below). Upgrading to a broadcast channel keyed by a second random key is possible later without changing the payload (Decisions log 12).

## Arcjet protection points

Every anon-reachable path is listed. Presets live in `lib/arcjet.ts` (the existing `publicForm`/`probe` presets are reused or tightened; new names are added to `ArcjetPreset`). All server-side validation below runs regardless of what Arcjet says; Arcjet fails open when its service is down, and the database limits are the backstop.

| Path | Arcjet rule (bot + shield + rate limit per client IP) | Server-side validation that does not depend on it |
|---|---|---|
| `GET /` , `/s/{tenant}` pages | proxy shield only (already, `/s` prefix); cached public data | public functions return whitelisted fields only |
| `GET /t/{qrToken}` (QR landing) | `probe` preset, **20/min** (a token probe leaks existence) | `get_qr_context` answers `null` for every failure; host/token tenant match |
| Server Action `submitGuestOrder` (online and QR) | new `guestOrder` preset: bot detection + shield + **6 per 10 min per IP** (a table of friends behind one NAT still fits; the numbers are a starting point, tuned from staging Arcjet logs, Decisions log 13) | whole `submit_guest_order` validation; `client_ref` idempotency; pending caps; 20 s cooldown (per table for QR, per IP and location for online); body size cap (64 KB) and line cap |
| `GET /o/{token}` (status poll) and `cancelGuestSubmission` | new `guestStatus` preset: **60/min per IP and token** | token is 256-bit and stored hashed; unknown and expired look the same |
| Server Action `createGuestRequest` | `publicForm` preset + a stricter **4 per 5 min per IP** | one non-resolved request per `(table, kind)`; `create_guest_request` validates the table |
| `get_pickup_slots` / `get_public_location_info` (read through the server) | proxy shield; cached briefly | read-only whitelisted |

PostHog (anonymous funnel, group = organization, **no PII, no contact data, no tokens, no notes**): `storefront_menu_viewed`, `storefront_item_added`, `storefront_checkout_started`, `guest_order_submitted` (channel only), `guest_request_created` (kind only). They are new names, distinct from the staff events (`order_placed`, `order_round_sent`).

## Abuse cases and where each is stopped

| Case | Stopped by |
|---|---|
| Replaying a submission | `client_ref` + `request_hash`: same body replays, other body `CLIENT_REF_CONFLICT`; the derived token makes the retry return the same link |
| Price or total tampering | no price/total/name key is accepted (unknown keys rejected); every price recomputed from the DB at submission **and again at acceptance** |
| Ordering at a closed location or while paused | hours check in the location timezone, `accepting_orders`, channel switches, package gate |
| Rotated or unknown QR code | `get_qr_context`/`submit_guest_order` fail closed with one answer (`QR_INVALID`); a token used on the wrong tenant's host is the same answer |
| Flooding | Arcjet per IP (above) + 3 pending per table + 50 pending per location + 20 s cooldown (per table for QR, per IP and location for online) + 15 min expiry; junk never reaches `orders`, the KDS or order numbers |
| Another tenant's item or modifier ids | items must belong to the resolved organization; fails as `ITEM_UNAVAILABLE`, indistinguishable from an unavailable item |
| Token guessing / scraping the status page | 256-bit random-looking HMAC token, hash-only storage, uniform not-found, rate limit, `noindex`, `no-store`, `no-referrer` |
| Remote prank orders to someone else's seated table | staff acceptance by default (auto-accept off); the table label is on the approval card; an add-on to an occupied table is visible to the approver (Still open 1) |
| Spamming call-waiter | one open request per `(table, kind)`, rate limit, no free text |
| Injection / XSS in notes and names | length caps, control characters stripped, rendered as text everywhere (never as HTML), never used in SQL outside parameters |
| PII leakage | contact fields excluded from client grants, from Realtime, from PostHog, from the print route's public data and from cache keys/tags |

## Changes to existing contracts and RPCs (applied by the implementation task)

1. **orders.md**: Decision 4 ("`placed` stays as written for these channels") is superseded: guest orders are staged in `guest_submissions` and become `accepted` orders at acceptance; `draft`/`placed` stay in the machine, unused by the guest flow. `orders.pickup_at` and `order_rounds.guest_submission_id` are added.
2. **Intake core**: extract the body of `submit_order_round` (steps 4 to 7: find/create the order, recompute, write, seat, derive) into a private function used by both `submit_order_round` (staff) and the acceptance path, so there is one pricing and validation implementation.
3. **Secondary-table QR** (orders.md *Table operations* change 5): `get_qr_context` and the acceptance resolve a scanned table to the open order of its group when it is an active secondary table.
4. `lib/env.ts`: `GUEST_TOKEN_KEY` (server-only, 32 random bytes) added and documented in `.env.example`. **It is a new secret that must exist before the implementation runs:** the user adds it to **Vercel (staging)** and to the agents' **HQ app variables** (local development), each with a **different value** (a token minted locally must not verify on staging, and vice versa). It is never committed, never `NEXT_PUBLIC_`, never logged, and never reused across environments. Rotating it invalidates every outstanding guest status link (a guest then sees the neutral "not found" page and orders again), so rotate only deliberately.
5. `get_storefront(slug)` returns each active location's `id` as well (today it returns names only, but the menu and ordering calls need the id; ids are already public through `get_public_menu`).
6. Staff settings screens (ADIT): ordering switches, hours and pickup settings write the two new settings tables under `locations.manage`.

## What ADIT consumes (`apps/web/lib/storefront/` and the staff inbox)

Public data (server-only, inside `<Suspense>`, org slug and ids as arguments):

```ts
export function getStorefront(slug: string): Promise<Storefront | null>;                                   // exists
export function getPublicMenu(slug: string, locationId: string): Promise<PublicMenu | null>;              // cached, tag storefront:{slug}
export function getLocationInfo(slug: string, locationId: string): Promise<LocationInfo | null>;           // not cached (open now)
export function getPickupSlots(slug: string, locationId: string): Promise<string[]>;                        // not cached
export function getQrContext(slug: string, qrToken: string): Promise<QrContext | null>;                    // service role; null = invalid
export function getGuestOrder(slug: string, accessToken: string): Promise<GuestOrderView | null>;          // service role; null = invalid
```

Guest Server Actions (`'use server'`, `ActionResult`; tenant slug bound from the host, never from FormData; Arcjet runs first):

| Action | FormData fields | Maps to |
|---|---|---|
| `submitGuestOrder` | `channel`, `qrToken?`, `locationId?` (online), `lines` (JSON), `clientRef`, `contactName?`, `contactPhone?`, `pickupAt?` | `submit_guest_order`; on success `data: { status, total }` and the status link `/o/{token}` (also set as a cookie) |
| `cancelGuestSubmission` | none (token from the cookie/URL) | `cancel_guest_submission` |
| `createGuestRequest` | `qrToken`, `kind`, `clientRef` | `create_guest_request` |

`clientRef` is created once per attempt and **reused on retry**. The cart lives in the browser (`localStorage`, wrapped in try/catch); it is cleared only on `ok`.

Staff (inside the dashboard, `lib/storefront/staff.ts`): `getGuestSubmissions(orgSlug, locationId, status?)` (`orders.view`; contact only with `orders.create`), `getGuestRequests(orgSlug, locationId)`, and the Server Actions `acceptGuestSubmission`, `rejectGuestSubmission` (`reasonCode`, `note?`), `acknowledgeGuestRequest`, `resolveGuestRequest`, `updateOrderingSettings`, `saveLocationHours` (each: `requirePermission`, Zod, the id must belong to this location, `updateTag('orders:{locationId}')`). Staff PostHog events: `guest_order_accepted`, `guest_order_rejected`, `guest_request_resolved` (ids and counts only).

## Errors

New members of `ActionErrorCode`: **`ORDERING_UNAVAILABLE`**, **`LOCATION_CLOSED`**, **`QR_INVALID`**, **`TABLE_NOT_READY`**, **`MIN_ORDER_NOT_MET`**, **`PICKUP_TIME_INVALID`**, **`TOO_MANY_PENDING`**, **`SUBMISSION_NOT_PENDING`**. Reused: `ITEM_UNAVAILABLE` (`details.itemIds`), `MODIFIER_INVALID`, `VARIANT_REQUIRED`, `CLIENT_REF_CONFLICT`, `ORDER_CLOSED`, `INVALID_INPUT`, `RATE_LIMITED` (Arcjet), `FORBIDDEN`, `PLAN_LIMIT`, `NOT_FOUND`. SQL errors are P0001 with the code as the message (`FORBIDDEN` is `42501`, shape errors `22023`). Guest-facing messages are friendly and generic ("This QR code isn't valid", "We're closed right now", "Ordering isn't available here"); they never reveal which tenant, why a token failed, or any id. Every failing result is `{ ok: false, code, formError }`; everything is all-or-nothing.

## Permission matrix (staff side)

| Capability | owner | manager | cashier | waiter | kitchen |
|---|---|---|---|---|---|
| See the inbox without contact details (`orders.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| See contact name/phone, accept, reject, acknowledge, resolve (`orders.create`) | ✓ | ✓ | ✓ | ✓ | – |
| Edit ordering switches, hours, pickup settings (`locations.manage`) | ✓ | – | – | – | – |
| Anything guest-side | no staff permission applies: guests are anonymous and go through the service-role path |

`kitchen` holds `orders.view`, so it can see that submissions exist (ids, statuses) but never contact data, and cannot decide. `has_location_access` applies to every row for location-limited staff.

## Tests (REYKI, `supabase/tests/isolation/`)

- **Privilege surface:** `anon` and `authenticated` cannot execute `submit_guest_order`, `get_guest_order`, `cancel_guest_submission`, `create_guest_request`, `get_qr_context` (only `service_role` can); `anon` can execute `get_storefront`, `get_public_menu`, `get_public_location_info`, `get_pickup_slots` and nothing in staff paths; `authenticated` staff RPCs refuse a caller without the permission (`FORBIDDEN`, identical to an unknown id); no client write grant on any new table; RLS on every new table.
- **Isolation:** org B cannot read or write org A's settings, hours, submissions or requests; a location-scoped member sees only their location's inbox; a QR token of tenant A used under tenant B's slug behaves exactly like an unknown token; an item/modifier/variant id of another tenant yields `ITEM_UNAVAILABLE` (same as unavailable); contact columns are not selectable by `authenticated`, and `list_guest_submissions` omits them for a caller without `orders.create`.
- **Public reads:** the public functions return only whitelisted fields (no cost, station, stock, staff, token, internal-only column); `null` for an unknown/suspended/inactive tenant or a location of another org; `openNow` and the pickup slots follow the location timezone, multiple intervals per day, a span past midnight and a location with no hours rows (open).
- **submit_guest_order:** server-computed totals equal the TS `calculateBill` golden vectors; unknown keys, client prices and bad shapes are rejected; `client_ref` replay returns the same submission and the same token, a different body is `CLIENT_REF_CONFLICT`, and a failed call leaves nothing; hours, `accepting_orders`, channel switches and the package gate each return their code (and leak nothing else); `QR_INVALID` for an unknown, a rotated and an inactive-table token alike; `TABLE_NOT_READY` for `reserved`/`needs_cleaning`; `ORDER_CLOSED` for a served order; caps (3 per table, 50 per location) and the 20 s cooldown (per table for QR, per IP and location for online) return `TOO_MANY_PENDING`; `MIN_ORDER_NOT_MET`; pickup validation (slot not offered, slot full, ASAP); contact required for online, optional phone format.
- **Acceptance:** accept creates the order directly `accepted` (never `placed`), seats the table, creates tickets per station only now (a pending submission has no ticket, no order row, no order number); an add-on to an open order creates a round, not a new order; a secondary table's submission attaches to the group's order; re-validation at accept fails with `ITEM_UNAVAILABLE` and leaves the submission `pending`; price changes between submit and accept charge the new price and show the new total; `max_orders_per_month` is enforced at accept, not at submit; accepting twice is idempotent; rejecting records the reason and creates nothing in `orders`; reject/accept after `expired`/`cancelled` is `SUBMISSION_NOT_PENDING`; auto-accept on accepts inside the submit transaction and a failing accept leaves it pending; online orders copy the name to `customer_name` and set `pickup_at`, and the phone is not copied.
- **Expiry and cancel:** a pending row past `expires_at` reads as and is persisted `expired`; the guest cancels only while pending, an accepted one is unchanged and idempotent.
- **Guest view:** `get_guest_order` returns the status mapping (including per-round ticket derivation) and never contains a staff name or id, `decided_by`, the order uuid, another guest's lines or the phone; an unknown, wrong-tenant and expired token are indistinguishable; the poll's `ETag` changes only when `updatedAt` does.
- **Requests:** one non-resolved request per `(table, kind)`; a second press returns the existing one; resolved frees it; only `orders.create` acknowledges/resolves; rotated QR and wrong tenant fail closed.
- **Realtime:** the two staff events carry only ids/status, arrive on `location:{A}` and not on another org's channel or on `location:{A}:payments`, contain no contact, item or money field; a guest cannot subscribe to anything.
- **Abuse (unit, Vitest at the lib layer):** Arcjet denials map to `RATE_LIMITED` (or a generic message for a bot) and never reach the RPC; the service-role client is only imported in `server-only` files; contact data never reaches `captureServer`.

## Decisions log (all Proposed by DAVIN)

1. Guest orders are **staged** in `guest_submissions` and become orders only on acceptance (not `orders.status = 'placed'` with pending items): keeps unaccepted items out of totals, bills, the KDS, order numbers and the one-open-order-per-table index, and makes rejection free.
2. Writes and secret-dependent reads are **service-role only**, called after Arcjet; only the public catalog reads are `anon`: closes the PostgREST bypass of the rate limits.
3. The guest token is **derived on the app server** (HMAC of the submission id) and only its hash is stored: retries are safe and the database holds no usable token.
4. QR ordering is **table-level**: any guest at the table may add a round to its open order; each guest only ever sees their own submissions. Staff acceptance (auto-accept off by default) is the guard against a remote stranger ordering.
5. Prices are recomputed at submission **and** at acceptance; the plan limit is checked at acceptance.
6. Opening hours are guest-only, stored as weekday minute intervals in the location timezone; no rows means always open.
7. Online pickup is `channel = 'online'`, no table, ASAP or a slot, pay at the counter (M5 adds DOKU); the contact name is required, the phone optional.
8. Guest status uses **polling** (adaptive, ETag) in M4, not Realtime.
9. Call waiter / request bill is a `guest_requests` row with one open request per `(table, kind)` and no free text; staff see it through the existing private channel.
10. Guests can cancel only while the submission is `pending`.
11. The package feature `qr_ordering` gates both guest channels.

Technical calls by ALAN (review of #140):
12. **Polling is fine for the guest status page in M4** (adaptive interval, ETag/304). A public broadcast channel keyed by a second random key stays an option if polling cost or latency becomes a problem; the payload would not change.
13. **Start with the proposed rate limits** (6 submissions per 10 min per IP, `probe` 20/min, `guestStatus` 60/min, request 4 per 5 min, the 20 s cooldown) and **tune them from the staging Arcjet logs**; the database caps are the backstop either way.
14. **Custom domains are out of M4.** DNS and TLS for a tenant's own domain is a production change that needs the user's approval; until a verified `custom_domains` table exists the proxy keeps returning 404 for an unknown host.

## Still open (ALAN / the user)

1. **Auto-accept defaults and risk.** Off by default for both channels. If a restaurant turns it on for QR, anyone with a photo of a table's QR can send a kitchen order to an empty or occupied table. Should auto-accept apply only when the table has no open order, never to add-ons, or only with a staff-confirmed "table is seated" step?
2. **Ordering when the table is empty.** Today a guest can order from an `available` table (acceptance seats it). Should QR ordering be limited to tables staff have already seated?
3. **Add-ons after `served`.** Refused (`ORDER_CLOSED`, "ask your waiter"). Should a guest be able to reopen ordering for dessert?
4. **No hours configured = always open.** Confirm, or require hours before guest ordering can be switched on.
5. **Minimum order and pickup defaults** (min 0, lead 20 min, slot 15 min, capacity unlimited): confirm or set per package.
6. **Partial acceptance.** When one line is out of stock, staff can only reject the whole submission. Allow "accept without the unavailable items" (the guest sees the change)?
7. **Phone number for online pickup:** optional today. Required? Verified by OTP/WhatsApp? Any consent text?
8. **Retention** of contact data and submissions (proposal: clear name/phone 30 days after the decision, delete rows after 90 days) and linking to a `customers` record when a guest identifies themselves (loyalty, M7).
9. *(decided: polling is fine for M4; Decisions log 12)*
10. *(decided: start with the proposed rate limits and tune from staging logs; Decisions log 13)*
11. *(decided: custom domains are out of M4; Decisions log 14)*
12. **Separate package flags** for QR ordering and online pickup (today one flag, `qr_ordering`).
13. **Guest cancellation after acceptance** (today: call the waiter) and a visible estimated preparation time.
14. **Language** of the storefront and the guest status page (Bahasa Indonesia default with English under `/en`, as the rest of the app).

## Out of scope here

Payments and refunds for guests (M5, DOKU), custom domains, customer accounts, loyalty and feedback (M7), reservations (M6), delivery, order-ahead scheduling beyond today, multi-language menu content, guest-initiated cancellation after acceptance, push/SMS/WhatsApp notifications.
