# Contract: orders + kitchen tickets (M3 §7, MSC-T02)

Draft 2026-11-10 by **DAVIN** (implementation notes from MSC-T04 are marked inline) for ALAN's review. **DAVIN** implements the schema, the RPCs and `lib/orders`. **ADIT** builds the POS (send to kitchen), the live order board and the KDS against it. **REYKI** writes the isolation tests against it. Changes need agreement from all three, plus ALAN, and are made in this file first. Bills, payments, refunds and cash sessions are a **separate later contract** (M3 Bills); this file only leaves the hooks they need.

Decisions on the earlier OPEN questions (ALAN and the user, 2026-11-10) are folded in below and marked **Decided**. The decisions log is at the end.

## Scope and rules that apply everywhere

- Hierarchy: organization → location → (area → table). Every table below has `organization_id` (NOT NULL, indexed) and `location_id`, with a composite FK `(location_id, organization_id) → locations (id, organization_id)`, the same pattern as `areas`/`tables`.
- **RLS on every table.** Policies use `is_org_member`, `has_permission`, `has_location_access` (staff limited by `location_staff` see only their locations). Each table ships with a pgTAP test that org A cannot read or write org B, and that a location-scoped member cannot see another location.
- **Money is `bigint` minor units** plus the location's `currency` (IDR exponent 0). No floats anywhere, including JSON. Amounts are never negative: voids and discounts are separate positive rows (PLAN decision 2026-11-08).
- **Nothing priced or scoped by the client.** The client sends item ids, variant/modifier ids, quantities, notes and a `client_ref`. The server derives the organization from the location, and derives every name, price, tax rate and station from the database.
- **Clients never write order tables directly.** `INSERT/UPDATE/DELETE` on all tables in this file is revoked from `anon` and `authenticated`; the only write path is the security-definer RPCs below (`search_path = ''`, execute revoked from `public`/`anon`, granted to `authenticated`). `SELECT` is granted per column and RLS-filtered.
- Timestamps are `timestamptz`. Display in the location timezone.

## Schema

### `orders`

| Column | Type / rule |
|---|---|
| `id` | uuid pk |
| `organization_id`, `location_id` | as above |
| `order_number` | integer, human number, unique per `(location_id, business_date)`, resets daily. Allocated from `order_counters` (below), never `max()+1` |
| `business_date` | date, the **location-local** date when the order was opened: `(now() at time zone locations.timezone)::date`. Never the UTC date |
| `channel` | `dine_in` \| `takeaway` \| `qr` \| `online` |
| `status` | `draft` \| `placed` \| `accepted` \| `preparing` \| `ready` \| `served` \| `completed` \| `cancelled` |
| `table_id` | uuid null. Required for `dine_in`, null for `takeaway`. Composite FK `(table_id, location_id)` → `tables` |
| `opened_by` | uuid → `auth.users` (null for guest `qr`/`online`, M4) |
| `customer_name` | text null, ≤ 60. Takeaway label only. Never sent to PostHog or Realtime |
| `guest_count` | integer null, 1–50 |
| `round_count` | integer not null default 0. Number of rounds sent so far |
| `currency` | char(3), copied from the location |
| `subtotal` | bigint, sum of `line_total` of non-void items. Maintained by the RPCs, never by the client |
| `discount_total` | bigint, sum of `order_discounts.amount` (≥ 0, ≤ `subtotal`) |
| `cancel_reason` | text null |
| `placed_at`, `served_at`, `completed_at`, `cancelled_at` | timestamptz null |
| `created_at`, `updated_at` | timestamptz |

Tax and service charge are **not** stored on the order. They are computed on the bill from the per-item `tax_rate_bps` snapshot and the location's service-charge setting (`lib/money.ts`). The order carries only the subtotal and discounts.

Constraints: `channel`/`status` checks; `dine_in` ⇒ `table_id` not null; `subtotal >= 0`; `discount_total between 0 and subtotal`. One **open** dine-in order per table: unique `(table_id)` where `status not in ('completed','cancelled')`. A second round on an occupied table is added to that order (see the intake RPC).

### `order_counters`

`(location_id, business_date, kind)` primary key, `last_value integer`. `kind` is `order` or `ticket`. The intake RPC upserts the row and locks it `FOR UPDATE` to allocate the next `order_number` / `ticket_number`, so numbers are gapless per day and concurrent rounds serialise on the counter. No client access.

### `order_rounds`

One row per successful `submit_order_round` call. It exists for idempotency and for grouping.

| Column | Rule |
|---|---|
| `id` | uuid pk |
| `organization_id`, `location_id`, `order_id` | FKs |
| `round_no` | integer, 1.. per order, unique `(order_id, round_no)` |
| `client_ref` | uuid, **unique `(organization_id, client_ref)`** |
| `request_hash` | text, sha-256 of the canonical request (below), to detect a reused `client_ref` with a different body |
| `created_by`, `created_at` | `created_by = auth.uid()`; used by the creator self-void rule |

**Canonical request for `request_hash`:** one JSON object with keys in this fixed order: `channel`, `table_id` (null if none), `customer_name` (null if none), `guest_count` (null if none), `lines`. `lines` keeps the order the client sent them. Each line is an object with keys in fixed order `item_id`, `variant_id` (null if none), `modifier_ids` (**sorted ascending**), `quantity`, `note` (null if none; trimmed). No whitespace, UTF-8, uuids lowercase. A retry of the same cart therefore always hashes equal, whatever order the client serialised `modifier_ids` or object keys in.

### `order_items`

One row per cart line. **Snapshots**: later menu edits never change a past order.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `order_id`, `round_id` | `round_no` is read through `round_id` |
| `menu_item_id`, `variant_id` | uuid, nullable FKs with **on delete set null** (history survives deletes) |
| `item_name` | text snapshot |
| `variant_name` | text null snapshot |
| `unit_price` | bigint: effective item price (location override or `base_price`) plus the variant delta, ≥ 0 |
| `modifiers_total` | bigint ≥ 0, sum of its modifiers' `price_delta` (per unit) |
| `quantity` | integer 1–99 |
| `line_total` | bigint = `(unit_price + modifiers_total) * quantity` |
| `tax_rate_bps` | integer snapshot of `locations.tax_rate_bps` at order time |
| `note` | text null ≤ 200 (allergies, "no onion"). Free text, shown on tickets |
| `kitchen_station_id` | uuid null snapshot, from `location_menu_overrides.kitchen_station_id`. **Null = station-less: the item never reaches the KDS** (no ticket, no ticket item) but stays on the order and the bill (**Decided**) |
| `status` | `active` \| `void` |
| `voided_at`, `voided_by`, `void_reason` | set together by `void_order_item`; reason 3–200 chars |
| `created_at` | |

A void keeps the row (`status = 'void'`, `line_total` unchanged for audit) and the subtotal drops it. Quantity edits after sending are a void plus a new round, never an UPDATE of `quantity`.

### `order_item_modifiers`

`id`, `organization_id`, `order_item_id`, `modifier_id` (nullable, on delete set null), `modifier_group_id` (nullable), `name` (snapshot), `price_delta` (snapshot, bigint ≥ 0). Immutable after insert.

### `order_discounts`

The `pos.discount` hook. **Amounts only**; percentage rules, coupons and tax effect belong to the Bills contract.
`id`, `organization_id`, `location_id`, `order_id`, `amount` (bigint > 0), `reason` (3–200), `applied_by`, `created_at`, plus `removed_at`, `removed_by`, `remove_reason` (set together, reason 3–200). Rows are never deleted; amounts stay positive. `orders.discount_total` is the sum of rows where `removed_at is null` (**Decided**: `remove_order_discount`, below).

### `order_events` (audit trail, append-only)

`id`, `organization_id`, `location_id`, `order_id`, `order_item_id` null, `ticket_id` null, `actor_id` null (null = system, e.g. derived status), `event_type`, `from_status` null, `to_status` null, `payload` jsonb (ids, amounts, reasons; **no PII, no tokens**), `created_at`.

`event_type` values: `round_sent`, `order_status_changed`, `item_voided`, `order_cancelled`, `discount_applied`, `discount_removed`, `kot_status_changed`, `table_status_changed`. Written only inside the RPCs, in the same transaction as the change. No UPDATE/DELETE grants or policies for anyone. A mirror row goes to `audit_logs` for void, cancel, and discount apply/remove.

### `kitchen_stations` (exists, M2)

Unchanged. `(id, location_id)` is the FK target for tickets.

### `kitchen_tickets` (KOT)

One ticket per **(order, round, station)**, only for items that have a station. Station-less items create no ticket (**Decided**). A location with no stations at all is valid; its orders never produce tickets.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `order_id`, `round_id` | |
| `kitchen_station_id` | uuid not null, composite FK `(kitchen_station_id, location_id)` |
| `ticket_number` | integer, per `(location_id, business_date)` from `order_counters` |
| `status` | `new` \| `in_progress` \| `ready` \| `bumped` |
| `accepted_at` (→ `in_progress`), `ready_at`, `bumped_at` | timestamptz null; `created_at` is the timer start |
| `updated_by` | uuid null |

### `kitchen_ticket_items`

`id`, `organization_id`, `ticket_id`, `order_item_id` (unique per ticket), `item_name`, `variant_name`, `quantity`, `modifiers_text` (snapshot, comma-joined names), `note`, `status` (`pending` \| `ready` \| `void`). Snapshotted so the KDS needs one query and never reads prices. Voiding an order item flips this row to `void` (the KDS shows it struck through) in the same transaction.

### Indexes

`orders (organization_id, location_id, status)`, `orders (organization_id, location_id, created_at)`, `orders (table_id) where open`, `order_items (order_id)`, `kitchen_tickets (location_id, status, created_at)`, `kitchen_ticket_items (ticket_id)`, `order_events (order_id, created_at)`, plus the report index `(organization_id, location_id, created_at)` on `orders`.

## State machines — `apps/web/lib/orders/transitions.ts`

Pure, dependency-free functions, unit-tested with Vitest, and **mirrored by SQL** (`orders_status_guard` and `kitchen_tickets_status_guard` triggers reject any transition the TS table rejects; a pgTAP test walks the full matrix). Signatures:

```ts
export type OrderStatus = 'draft' | 'placed' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
export type KotStatus = 'new' | 'in_progress' | 'ready' | 'bumped';
export type TableStatus = 'available' | 'reserved' | 'occupied' | 'needs_cleaning';

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean;
export function canTransitionKot(from: KotStatus, to: KotStatus): boolean;
export function canTransitionTable(from: TableStatus, to: TableStatus): boolean;
export function requiredPermission(machine: 'order' | 'kot' | 'table', to: string): string | 'system';
export function nextOrderStatusFromTickets(current: OrderStatus, ticketStatuses: KotStatus[]): OrderStatus[]; // derived path, in order (below)
```

### Order

`draft → placed → accepted → preparing → ready → served → completed`, plus `cancelled` from any state **before `served`**. `completed` and `cancelled` are terminal. No skipping, no going back.

| Transition | Trigger | Permission |
|---|---|---|
| `draft → placed` | first `submit_order_round` (staff POS orders are never left in `draft` by the server; `draft` exists for M4 carts) | `orders.create` |
| `placed → accepted` | automatic for staff-entered orders (`dine_in`, `takeaway`) inside the same RPC. `qr`/`online` wait for a staff accept (approval flow deferred to the M4 contract, **Decided**) | system / `orders.create` |
| `accepted → preparing` | **derived**: first KOT of the order goes `in_progress`, **or** the order has no live tickets (below) | system |
| `preparing → ready` | **derived**: every non-void ticket of the order is `ready` or `bumped` (vacuously true with no tickets) | system |
| `ready → preparing` | not a general transition. Only the intake RPC may do it, when an add-on round is added (see "Add-on rounds") | system |
| `ready → served` | `markOrderServed` | `orders.create` |
| `served → completed` | **system**, when the bill is fully paid (Bills contract). Until then a served order stays `served`. Cash-first POS may call `completeOrder` once the bill exists | system (Bills) |
| `* → cancelled` (pre-`served`) | `cancelOrder` with reason | `orders.void` |

The unique index "one open order per table" makes "cancel an order whose table has another open order" impossible, so cancel and close always free the table (`occupied → needs_cleaning`) without checking for siblings.

Derived transitions run inside the RPC that changes a ticket, in the same transaction, and write an `order_status_changed` event with `actor_id = null`.

**No live tickets (Decided).** Order status derives only from tickets. A *live* ticket is one whose status is `new`, `in_progress` or `ready` and that has at least one non-void item. If, after a round or after a void/cancel, the order has **no live tickets** (all items station-less, a location without stations, or everything void/bumped), the same RPC walks `accepted → preparing → ready` in the same transaction, writing two system `order_status_changed` events (no state skipped), so the waiter can mark the order served. `nextOrderStatusFromTickets` returns the ordered path (for example `['preparing', 'ready']`) and has unit tests for: no tickets, only `new`, mixed `in_progress`/`ready`, all `ready`, all `bumped`, and all-void.

### Add-on rounds

`submit_order_round` on an existing open order is allowed while the order is `accepted`, `preparing` or `ready`. The new round creates new `new` tickets, and a `ready` order moves back to `preparing` through a **dedicated, documented exception**: `ready → preparing` is permitted **only** from the intake RPC when a new round is added. It is not callable on its own. Adding a round to a `served` order is rejected with `ORDER_CLOSED` (the POS opens a new order, or reopens the bill flow in M3 Bills). Cancelled/completed orders reject the same way.

### KOT

`new → in_progress → ready → bumped`. No skipping, no backwards moves. `bumped` is terminal and removes the ticket from the KDS. A ticket whose items are all void is set to `bumped` by the void RPC (system).

| Transition | Permission |
|---|---|
| `new → in_progress` (accept/start) | `kitchen.update` |
| `in_progress → ready` | `kitchen.update` |
| `ready → bumped` | `kitchen.update` |

Item-level: a ticket item can be marked `ready` individually (`kitchen.update`) but the **ticket** status is the unit the order derives from. Marking the last pending item ready does **not** auto-ready the ticket; the cook confirms with one tap (**Decided**).

### Table (`tables.status`, owned by M2, driven here)

`available → reserved → occupied → needs_cleaning → available`.

| Event | Table transition | Who |
|---|---|---|
| Seat (first round on a free table) | `available \| reserved → occupied` | inside `submit_order_round` (`orders.create`) |
| Order `completed` or `cancelled` | `occupied → needs_cleaning` | system, same transaction |
| Cleaned | `needs_cleaning → available` | `markTableClean` action: **`orders.create`** (waiters), not `tables.manage` (**Decided**) |
| Reservation hold (M6) | `available → reserved` | reservations contract |

`tables.status` is only changed by these paths. The existing M2 table CRUD does not write it. Each change writes `order_events.table_status_changed` (or the reservation's own log).

## Intake RPC — `submit_order_round`

```sql
public.submit_order_round(
  location_id uuid,
  table_id    uuid,          -- null for takeaway
  channel     text,          -- 'dine_in' | 'takeaway' (staff POS; qr/online use the M4 guest wrapper)
  lines       jsonb,         -- see below, 1..60 lines
  client_ref  uuid,          -- idempotency key, generated by the POS per cart/send
  customer_name text default null,
  guest_count   integer default null
) returns jsonb
-- language plpgsql, volatile, security definer, set search_path = ''
```

`lines` = `[{ "item_id": uuid, "variant_id": uuid|null, "modifier_ids": [uuid], "quantity": 1..99, "note": text|null }]`. **No price, name, total, tax, station, organization id, order id or status is accepted.** Unknown keys are rejected.

Returns:

```ts
type SubmitRoundResult = {
  orderId: string; orderNumber: number; roundNo: number;
  ticketIds: string[]; subtotal: number; currency: string;
  replayed: boolean;            // true when client_ref was already processed (same result returned)
};
```

Semantics, all in **one transaction**:

1. **Authorize.** Caller needs `orders.create` and `pos.use` at the location's org, plus `has_location_access(location_id)`. Unknown/inactive location, or no permission → `FORBIDDEN` (`42501`), identical for both so ids cannot be probed.
2. **Idempotency.** Look up `(organization_id, client_ref)` in `order_rounds`. Found with the same `request_hash` → return the stored result with `replayed = true`, change nothing. Found with a different hash → `CLIENT_REF_CONFLICT`. A concurrent duplicate is serialised by the unique index (the loser re-reads and replays). The POS retries safely on flaky Wi-Fi.
3. **Validate shape.** `channel` in `dine_in|takeaway`; `dine_in` needs an active table of this location (else `TABLE_NOT_FOUND`), `takeaway` must have `table_id` null (`INVALID_INPUT`). Lines: 1–60, quantity 1–99, note ≤ 200, no duplicate ids in `modifier_ids`.
4. **Find or create the order.** For `dine_in`, lock the table row (`FOR UPDATE`); if an open order exists, add a round to it (subject to "Add-on rounds"); otherwise create the order and seat the table. `takeaway` always creates a new order. `order_number` and `business_date` come from the location timezone and `order_counters`.
5. **Recompute every line from the database.**
   - Item must exist in this org, be `is_active` and `is_published`; the location override must have `is_available` and no active `sold_out_until` → else `ITEM_UNAVAILABLE` (the error's `details.itemIds` lists them; the whole round is rejected, nothing partial).
   - Effective price = `coalesce(location_menu_overrides.price_override, menu_items.base_price)`. Variant (if the item has active variants one is required: `VARIANT_REQUIRED`) must belong to the item and be active; `unit_price = effective price + variant.price_delta`, and if it is negative → `INVALID_INPUT`.
   - Modifiers: each must be active and belong to a group attached to the item (`menu_item_modifier_groups`). Per group, the selected count must satisfy `min_select ≤ n ≤ max_select` → else `MODIFIER_INVALID` (`details.groupId`).
   - `modifiers_total`, `line_total`, `tax_rate_bps` (location), `kitchen_station_id` (override, may be null), and all names are snapshotted.
   - Opening hours: **not enforced for staff POS** (a cashier can ring up a late order). Enforced in the M4 guest wrapper.
6. **Write** `order_rounds`, `order_items`, `order_item_modifiers`, one `kitchen_tickets` row **per station** (only for lines that have a station) with its `kitchen_ticket_items`, update `orders.subtotal` / `round_count` / status, seat the table, and apply the derived status path (including the no-live-tickets walk to `ready`), and append `order_events` (`round_sent`, plus any derived status or table change).
7. **Return** the result. Any error rolls back everything, including the seat and the `client_ref` row, so a failed attempt can be retried with the same `client_ref`.

Plan limits: `max_orders_per_month` (if the package defines it) is checked when a **new** order is created, raising `PLAN_LIMIT` (`PLAN_LIMIT:max_orders_per_month`, P0001), consistent with `PLAN_LIMIT:max_tables`.

### Other RPCs (all security definer, `search_path = ''`, same authorization pattern, each writes `order_events`)

| RPC | Permission | Behaviour |
|---|---|---|
| `void_order_item(item_id uuid, reason text)` | `orders.void`, **or** creator self-void (below) | Item must be `active` on a non-terminal order (`ALREADY_VOID`, `ORDER_CLOSED`). Sets void fields, flips the ticket item to `void`, recomputes `subtotal`, clamps nothing: if `discount_total > new subtotal` the call fails with `DISCOUNT_EXCEEDS_SUBTOTAL` (remove the discount first with `remove_order_discount`). If every item of the order is void the order becomes `cancelled`. Audit row. |
| `cancel_order(order_id uuid, reason text)` | `orders.void` | Allowed pre-`served` only (`ORDER_CLOSED` otherwise). Voids all items, bumps open tickets (system), frees the table (`occupied → needs_cleaning`; the one-open-order-per-table index means no sibling order can exist), writes `order_cancelled`. |
| `apply_order_discount(order_id uuid, amount bigint, reason text)` | `pos.discount` | `amount > 0`, `discount_total + amount ≤ subtotal` (`DISCOUNT_EXCEEDS_SUBTOTAL`), order not terminal. Inserts an `order_discounts` row. |
| `remove_order_discount(discount_id uuid, reason text)` | `pos.discount` | Discount must be active (`ALREADY_REMOVED`) on a non-terminal order. Sets `removed_at/by/reason`, recomputes `discount_total`, writes `discount_removed` + audit. Lets a manager clear the way when a void hits `DISCOUNT_EXCEEDS_SUBTOTAL`. |
| `set_order_status(order_id uuid, to_status text)` | per the order table (`served`, `accepted`) | Validates through the SQL mirror of `canTransitionOrder`. Derived statuses (`preparing`, `ready`) and `completed` are rejected here (`INVALID_TRANSITION`). |
| `update_kot_status(ticket_id uuid, to_status text)` | `kitchen.update` | Validates `canTransitionKot`, stamps `accepted_at`/`ready_at`/`bumped_at`, re-derives the order status, writes `kot_status_changed`. Idempotent: setting the current status again is a no-op that returns ok. |
| `set_kot_item_status(ticket_item_id uuid, to_status text)` | `kitchen.update` | `pending ↔ ready` only. |
| `mark_table_clean(table_id uuid)` | `orders.create` | `needs_cleaning → available`. No order is attached, so the trail is an `audit_logs` row (`table.cleaned`), not `order_events` (implementation note, MSC-T04). |

## Void and discount rules

- **Void** needs a reason (3–200 chars, trimmed) and one of:
  1. `orders.void` (owner, manager): any item, any time before the order is `served`, including after the kitchen started it (the KDS shows it struck through so the cook stops). Station-less items always take this path.
  2. **Creator self-void (Decided):** the caller holds `orders.create`, the item's `order_rounds.created_by = auth.uid()`, the item has a `kitchen_ticket_items` row, and that ticket's status is `new`. Audit-logged exactly like any void. Once the ticket is `in_progress` or later, only `orders.void` works. **Station-less items have no ticket and never qualify**, which closes the "void a served drink" hole. The RPC checks this in SQL; `voidItem` just calls it.
  After `served`/`completed`, items cannot be voided here; refunds belong to the Bills contract.
- **Cancel** is the whole-order version of void and needs `orders.void` only (no self-cancel). Reason required.
- **Discount** needs `pos.discount`, amount in minor units, reason required. It reduces what the bill charges; tax treatment is decided in the Bills contract. Discounts do not touch kitchen tickets. A discount is undone with `remove_order_discount` (reason required), never deleted.
- Voids, cancels and discount apply/remove write `audit_logs` (actor, reason, amounts) in addition to `order_events`.

## Realtime

Subscribe per location channel **`location:{locationId}`**. Channels are **private only**: the client opens them with `config: { private: true }` and there is no public channel. Access is a `realtime.messages` RLS policy requiring org membership + `has_location_access` + (`orders.view` or `kitchen.view`) for the location in the topic. Database triggers on the order tables emit the events in the same transaction as the row change via `realtime.send` / `realtime.broadcast_changes` (so a rolled-back round emits nothing), with **ids and statuses only**. A pgTAP test proves a member of org B cannot subscribe to or receive `location:{A}`, and that a location-scoped member cannot join another location's topic.

| Event | Payload (all columns) |
|---|---|
| `order.changed` | `{ orderId, status, tableId, channel, orderNumber, roundCount, updatedAt }` |
| `ticket.changed` | `{ ticketId, orderId, stationId, status, updatedAt }` |
| `ticket_item.changed` | `{ ticketItemId, ticketId, status }` |
| `table.changed` | `{ tableId, status, updatedAt }` |

Never published: notes, item names, `customer_name`, money amounts, `created_by`/`opened_by`, tokens. The client treats an event as a **signal to refetch** that entity through RLS-filtered selects (so a dropped or reordered event is harmless). Rules for the UI, per CLAUDE.md: refetch everything on reconnect, never assume event order (compare `updatedAt`), show a reconnecting banner while the channel is down.

## What ADIT consumes (`apps/web/lib/orders/`, `server-only` data + `'use server'` actions)

Data (all authorize themselves with `requireOrgContext` + a permission, explicit columns, call inside `<Suspense>`; org slug and location id as arguments, never an org id):

```ts
// POS menu: published, active items available now, with effective price, variants, modifier groups (min/max), station-less.
export function getPosCatalog(orgSlug: string, locationId: string): Promise<PosCatalog>;          // pos.use
export function getOpenOrders(orgSlug: string, locationId: string, f?: { channel?: Channel[]; status?: OrderStatus[] }): Promise<OrderSummary[]>; // orders.view  (live board)
export function getOrder(orgSlug: string, locationId: string, orderId: string): Promise<OrderDetail>;   // orders.view; items with modifiers, rounds, events
export function getTableOrder(orgSlug: string, locationId: string, tableId: string): Promise<OrderDetail | null>; // orders.view
export function getKdsTickets(orgSlug: string, locationId: string, stationId?: string): Promise<KdsTicket[]>;   // kitchen.view; tickets status != bumped, oldest first
```

`OrderSummary` = `{ id, orderNumber, channel, status, tableLabel | null, itemCount, subtotal, currency, createdAt, updatedAt }`. `KdsTicket` = `{ id, ticketNumber, orderNumber, tableLabel | null, stationId, status, createdAt, items: { id, name, variantName, quantity, modifiersText, note, status }[] }`. The KDS never receives prices. Timers on the KDS (amber/red) are computed in the client from `createdAt` and the server `now` returned with the payload, with **fixed thresholds of 10 min (amber) and 20 min (red)** for M3 (**Decided**; a per-location setting is on the M7 backlog).

Actions (`'use server'`, the `useActionState` shape, `ActionResult` from `@/lib/auth/schemas`; `orgSlug` and `locationId` bound server-side in the page, e.g. `sendRound.bind(null, slug, locationId)`; no org id in FormData):

```ts
type OrderAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
```

| Action | FormData fields | Maps to |
|---|---|---|
| `sendRound` | `tableId` (empty for takeaway), `channel`, `lines` (JSON as above), `clientRef` (uuid, created once per cart send and reused on retry), `customerName?`, `guestCount?` | `submit_order_round`. On success `ActionResult` carries `{ orderId, orderNumber, roundNo }` in `data`; the POS clears the cart only on `ok` |
| `voidItem` | `orderItemId`, `reason` | `void_order_item` |
| `cancelOrder` | `orderId`, `reason` | `cancel_order` |
| `applyDiscount` | `orderId`, `amount` (whole minor units, integer string), `reason` | `apply_order_discount` |
| `removeDiscount` | `discountId`, `reason` | `remove_order_discount` |
| `markOrderServed` | `orderId` | `set_order_status(..., 'served')` |
| `updateKotStatus` | `ticketId`, `status` (`in_progress` \| `ready`) | `update_kot_status` |
| `bumpKot` | `ticketId` | `update_kot_status(..., 'bumped')` |
| `setKotItemStatus` | `ticketItemId`, `status` | `set_kot_item_status` |
| `markTableClean` | `tableId` | `mark_table_clean` |

Every mutation calls `requirePermission(orgId, perm)` in the lib before touching the database (defence in depth over the RPC check), validates with Zod (schemas shared with the form), and calls `updateTag('orders:{locationId}')`. PostHog events (group = org, no PII, no names/notes): `order_placed`, `order_round_sent`, `order_item_voided`, `order_cancelled`, `discount_applied`, `discount_removed`, `kot_status_changed`; added to `lib/posthog/events.ts`. Emails: none.

POS offline behaviour: the cart is persisted locally with its `clientRef`. On reconnect the POS re-sends with the **same** `clientRef`; the server's replay makes this safe. The POS must not mint a new `clientRef` for a retry of the same cart.

## Errors

New members of `ActionErrorCode` in `lib/auth/schemas.ts`, added by DAVIN: **`ITEM_UNAVAILABLE`**, **`MODIFIER_INVALID`**, **`VARIANT_REQUIRED`**, **`TABLE_NOT_FOUND`**, **`ORDER_CLOSED`**, **`ALREADY_VOID`**, **`INVALID_TRANSITION`**, **`DISCOUNT_EXCEEDS_SUBTOTAL`**, **`CLIENT_REF_CONFLICT`**, **`ALREADY_REMOVED`**, and **`INVALID_INPUT`** (it did not exist yet; shape errors from the RPC). Reused: `FORBIDDEN`, `PLAN_LIMIT`. `ActionResult` also gains two optional fields: `data` on success (the `sendRound` ids) and `details` on failure (`itemIds`, `groupId`).

| SQL | Code |
|---|---|
| `42501` | `FORBIDDEN` |
| P0001 `ITEM_UNAVAILABLE` (hint: item ids) | `ITEM_UNAVAILABLE`, `details.itemIds` |
| P0001 `MODIFIER_INVALID`, `VARIANT_REQUIRED`, `TABLE_NOT_FOUND`, `ORDER_CLOSED`, `ALREADY_VOID`, `INVALID_TRANSITION`, `DISCOUNT_EXCEEDS_SUBTOTAL`, `CLIENT_REF_CONFLICT`, `ALREADY_REMOVED` | same names |
| P0001 `PLAN_LIMIT:max_orders_per_month` | `PLAN_LIMIT` |
| `22023` / check violations | `INVALID_INPUT` |

Each failing result is `{ ok: false, code, formError }` with a friendly `formError` (no ids, no SQL text); `ITEM_UNAVAILABLE` also returns `details.itemIds` so the POS can mark the lines. A round is **all-or-nothing**.

## RLS and permission matrix

`has_location_access` applies to every row below for staff limited to locations. "Read" is RLS `SELECT`; every write is RPC-only.

| Capability | owner | manager | cashier | waiter | kitchen |
|---|---|---|---|---|---|
| Read orders, items, events (`orders.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Use POS catalog (`pos.use`) | ✓ | ✓ | ✓ | ✓ | – |
| Send a round, mark served, mark table clean (`orders.create`) | ✓ | ✓ | ✓ | ✓ | – |
| Void item / cancel order (`orders.void`) | ✓ | ✓ | – | – | – |
| Void **own** item while its ticket is `new` (`orders.create` + creator) | ✓ | ✓ | ✓ | ✓ | – |
| Apply / remove discount (`pos.discount`) | ✓ | ✓ | – | – | – |
| Read KDS tickets (`kitchen.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Update/bump tickets (`kitchen.update`) | ✓ | ✓ | – | – | ✓ |
| Read `order_events` | ✓ | ✓ | – | – | – (`orders.void` or `reports.view` required) |

Notes: `kitchen` has `orders.view`, so it can read orders at its locations; ticket-item columns carry no prices. `order_items` price columns are readable by `orders.view` holders (the kitchen role included, **Decided**); the KDS payload simply omits prices. Revisit with a view if a customer asks. Custom roles get exactly the permissions they were granted, nothing is implied.

Tests (REYKI, `supabase/tests/isolation/`): creator self-void on a `new` ticket succeeds, on `in_progress` is `FORBIDDEN`, on another waiter's item is `FORBIDDEN`, and on a station-less item is `FORBIDDEN`; an all-station-less round derives `accepted → preparing → ready` with two system events in one transaction; `remove_order_discount` recomputes the total and a second removal is `ALREADY_REMOVED`; order and ticket numbers reset per location-local day and stay unique under concurrent rounds; a member of org B cannot join `location:{A}` and a location-scoped member cannot join another location's topic; cross-org read/write fails on every table; a location-scoped member cannot read another location's orders, tickets or events; direct `INSERT/UPDATE/DELETE` by `authenticated` fails everywhere; `anon` cannot execute any RPC; each RPC rejects a caller lacking its permission; replay with the same `client_ref` returns the same order and creates no second row; a different body with the same `client_ref` fails `CLIENT_REF_CONFLICT`; a failed round leaves no order, items, tickets, seat or `order_rounds` row; client-supplied price/total keys are rejected; sold-out/unpublished/invalid-modifier lines reject the whole round; the transition matrix in SQL equals the TS table; derived order status follows tickets; table status follows seat/close.

## Decisions log and deferrals

Decided 2026-11-10 (ALAN review and the user):

1. Void: `orders.void` holders, plus creator self-void while the item's ticket is `new`; station-less items need `orders.void`.
2. Table clean: `orders.create`.
3. Station-less items skip the KDS; a location without stations is valid; an order with no live tickets derives to `ready` in the same transaction.
4. QR/online approval: deferred to the M4 contract. `placed` stays as written for those channels.
5. `remove_order_discount` is part of this contract.
6. No auto-ready of a ticket.
7. Order and ticket numbers reset daily per location (`business_date` in the location timezone), allocated from a locked counter row.
8. KDS timers fixed at 10/20 minutes for M3; per-location setting goes to the M7 backlog.
9. The `kitchen` role may read prices through RLS; the KDS payload omits them.

No open questions remain for this contract.

## Implementation notes (MSC-T04, accepted by ALAN)

Deviations found while building, all accepted:

1. `mark_table_clean` writes an `audit_logs` row (`table.cleaned`), not `order_events`: a clean-up has no order and `order_events.order_id` is NOT NULL.
2. `tables.status` keeps its M2 column grants for now (tables.manage can still set it from the tables UI); table transitions are enforced inside the RPCs. Locking it to the RPC paths is B1-T27.
3. Seating a table that is `needs_cleaning` is refused with `INVALID_TRANSITION`; a waiter marks it clean first.
4. `cancel_order` marks the order's active discounts removed (reason "Order cancelled") so totals stay consistent.
5. `order_counters` has an explicit deny policy for clients (the repo guard test requires a policy on every public table).
6. `INVALID_INPUT` is added to `ActionErrorCode`, and `ActionResult` gains optional `data` (success) and `details` (failure).

Also: orders are not readable by platform admins through RLS (`orders_select` has no `is_platform_admin()` branch); super admin counts will come through a definer function.

## Out of scope here

Bills, bill items, payments, partial/split payments, refunds, cash sessions, tax and service charge computation, printing, reservations, QR guest intake (`submit_guest_order`, M4), online pickup, loyalty. Each gets its own contract.
