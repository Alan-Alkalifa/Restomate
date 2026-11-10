# Contract: orders + kitchen tickets (M3 §7, MSC-T02)

Draft 2026-11-10 by **DAVIN** for ALAN's review. **DAVIN** implements the schema, the RPCs and `lib/orders`. **ADIT** builds the POS (send to kitchen), the live order board and the KDS against it. **REYKI** writes the isolation tests against it. Changes need agreement from all three, plus ALAN, and are made in this file first. Bills, payments, refunds and cash sessions are a **separate later contract** (M3 Bills); this file only leaves the hooks they need.

Items marked **OPEN** are product questions for ALAN. The text states the default DAVIN will build unless told otherwise.

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
| `order_number` | integer, human number, unique per `(location_id, business_date)`; see OPEN-7 |
| `business_date` | date, the location-local date when the order was opened |
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

### `order_rounds`

One row per successful `submit_order_round` call. It exists for idempotency and for grouping.

| Column | Rule |
|---|---|
| `id` | uuid pk |
| `organization_id`, `location_id`, `order_id` | FKs |
| `round_no` | integer, 1.. per order, unique `(order_id, round_no)` |
| `client_ref` | uuid, **unique `(organization_id, client_ref)`** |
| `request_hash` | text, sha-256 of the canonical `lines` + `table_id` + `channel`, to detect a reused `client_ref` with a different body |
| `created_by`, `created_at` | |

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
| `kitchen_station_id` | uuid null snapshot, from `location_menu_overrides.kitchen_station_id` (null = no station, see OPEN-3) |
| `status` | `active` \| `void` |
| `voided_at`, `voided_by`, `void_reason` | set together by `void_order_item`; reason 3–200 chars |
| `created_at` | |

A void keeps the row (`status = 'void'`, `line_total` unchanged for audit) and the subtotal drops it. Quantity edits after sending are a void plus a new round, never an UPDATE of `quantity`.

### `order_item_modifiers`

`id`, `organization_id`, `order_item_id`, `modifier_id` (nullable, on delete set null), `modifier_group_id` (nullable), `name` (snapshot), `price_delta` (snapshot, bigint ≥ 0). Immutable after insert.

### `order_discounts`

The `pos.discount` hook. **Amounts only**; percentage rules, coupons and tax effect belong to the Bills contract.
`id`, `organization_id`, `location_id`, `order_id`, `amount` (bigint > 0), `reason` (3–200), `applied_by`, `created_at`. Positive rows; a discount is removed by a compensating event, not a delete (OPEN-5). `orders.discount_total` is the sum.

### `order_events` (audit trail, append-only)

`id`, `organization_id`, `location_id`, `order_id`, `order_item_id` null, `ticket_id` null, `actor_id` null (null = system, e.g. derived status), `event_type`, `from_status` null, `to_status` null, `payload` jsonb (ids, amounts, reasons; **no PII, no tokens**), `created_at`.

`event_type` values: `round_sent`, `order_status_changed`, `item_voided`, `order_cancelled`, `discount_applied`, `kot_status_changed`, `table_status_changed`. Written only inside the RPCs, in the same transaction as the change. No UPDATE/DELETE grants or policies for anyone. A mirror row goes to `audit_logs` for void, cancel and discount.

### `kitchen_stations` (exists, M2)

Unchanged. `(id, location_id)` is the FK target for tickets.

### `kitchen_tickets` (KOT)

One ticket per **(order, round, station)**. Items with no station go to the location's default station (OPEN-3).

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `order_id`, `round_id` | |
| `kitchen_station_id` | uuid not null, composite FK `(kitchen_station_id, location_id)` |
| `ticket_number` | integer, per `(location_id, business_date)` |
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
export function nextOrderStatusFromTickets(current: OrderStatus, ticketStatuses: KotStatus[]): OrderStatus; // derived (below)
```

### Order

`draft → placed → accepted → preparing → ready → served → completed`, plus `cancelled` from any state **before `served`**. `completed` and `cancelled` are terminal. No skipping, no going back.

| Transition | Trigger | Permission |
|---|---|---|
| `draft → placed` | first `submit_order_round` (staff POS orders are never left in `draft` by the server; `draft` exists for M4 carts) | `orders.create` |
| `placed → accepted` | automatic for staff-entered orders (`dine_in`, `takeaway`) inside the same RPC. `qr`/`online` wait for a staff accept (M4, **OPEN-4**) | system / `orders.create` |
| `accepted → preparing` | **derived**: first KOT of the order goes `in_progress` | system |
| `preparing → ready` | **derived**: every non-void ticket of the order is `ready` or `bumped` | system |
| `ready → preparing` | not a general transition. Only the intake RPC may do it, when an add-on round is added (see "Add-on rounds") | system |
| `ready → served` | `markOrderServed` | `orders.create` |
| `served → completed` | **system**, when the bill is fully paid (Bills contract). Until then a served order stays `served`. Cash-first POS may call `completeOrder` once the bill exists | system (Bills) |
| `* → cancelled` (pre-`served`) | `cancelOrder` with reason | `orders.void` |

Derived transitions run inside the RPC that changes a ticket, in the same transaction, and write an `order_status_changed` event with `actor_id = null`.

### Add-on rounds

`submit_order_round` on an existing open order is allowed while the order is `accepted`, `preparing` or `ready`. The new round creates new `new` tickets, and a `ready` order moves back to `preparing` through a **dedicated, documented exception**: `ready → preparing` is permitted **only** from the intake RPC when a new round is added. It is not callable on its own. Adding a round to a `served` order is rejected with `ORDER_CLOSED` (the POS opens a new order, or reopens the bill flow in M3 Bills). Cancelled/completed orders reject the same way.

### KOT

`new → in_progress → ready → bumped`. No skipping, no backwards moves. `bumped` is terminal and removes the ticket from the KDS. A ticket whose items are all void is set to `bumped` by the void RPC (system).

| Transition | Permission |
|---|---|
| `new → in_progress` (accept/start) | `kitchen.update` |
| `in_progress → ready` | `kitchen.update` |
| `ready → bumped` | `kitchen.update` |

Item-level: a ticket item can be marked `ready` individually (`kitchen.update`) but the **ticket** status is the unit the order derives from. Marking the last pending item ready does **not** auto-ready the ticket (the cook confirms with one tap; **OPEN-6**).

### Table (`tables.status`, owned by M2, driven here)

`available → reserved → occupied → needs_cleaning → available`.

| Event | Table transition | Who |
|---|---|---|
| Seat (first round on a free table) | `available \| reserved → occupied` | inside `submit_order_round` (`orders.create`) |
| Order `completed` or `cancelled` with no other open order on the table | `occupied → needs_cleaning` | system, same transaction |
| Cleaned | `needs_cleaning → available` | `markTableClean` action: **`orders.create`** (waiters), not `tables.manage` (**OPEN-2**) |
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
4. **Find or create the order.** For `dine_in`, lock the table row (`FOR UPDATE`); if an open order exists, add a round to it (subject to "Add-on rounds"); otherwise create the order and seat the table. `takeaway` always creates a new order.
5. **Recompute every line from the database.**
   - Item must exist in this org, be `is_active` and `is_published`; the location override must have `is_available` and no active `sold_out_until` → else `ITEM_UNAVAILABLE` (the error's `details.itemIds` lists them; the whole round is rejected, nothing partial).
   - Effective price = `coalesce(location_menu_overrides.price_override, menu_items.base_price)`. Variant (if the item has active variants one is required: `VARIANT_REQUIRED`) must belong to the item and be active; `unit_price = effective price + variant.price_delta`, and if it is negative → `INVALID_INPUT`.
   - Modifiers: each must be active and belong to a group attached to the item (`menu_item_modifier_groups`). Per group, the selected count must satisfy `min_select ≤ n ≤ max_select` → else `MODIFIER_INVALID` (`details.groupId`).
   - `modifiers_total`, `line_total`, `tax_rate_bps` (location), `kitchen_station_id` (override), and all names are snapshotted.
   - Opening hours: **not enforced for staff POS** (a cashier can ring up a late order). Enforced in the M4 guest wrapper.
6. **Write** `order_rounds`, `order_items`, `order_item_modifiers`, one `kitchen_tickets` row **per station** with its `kitchen_ticket_items`, update `orders.subtotal` / `round_count` / status, seat the table, and append `order_events` (`round_sent`, plus any derived status or table change).
7. **Return** the result. Any error rolls back everything, including the seat and the `client_ref` row, so a failed attempt can be retried with the same `client_ref`.

Plan limits: `max_orders_per_month` (if the package defines it) is checked when a **new** order is created, raising `PLAN_LIMIT` (`PLAN_LIMIT:max_orders_per_month`, P0001), consistent with `PLAN_LIMIT:max_tables`.

### Other RPCs (all security definer, `search_path = ''`, same authorization pattern, each writes `order_events`)

| RPC | Permission | Behaviour |
|---|---|---|
| `void_order_item(item_id uuid, reason text)` | `orders.void` | Item must be `active` on a non-terminal order (`ALREADY_VOID`, `ORDER_CLOSED`). Sets void fields, flips the ticket item to `void`, recomputes `subtotal`, clamps nothing: if `discount_total > new subtotal` the call fails with `DISCOUNT_EXCEEDS_SUBTOTAL` (remove/adjust the discount first, **OPEN-5**). If every item of the order is void the order becomes `cancelled`. Audit row. |
| `cancel_order(order_id uuid, reason text)` | `orders.void` | Allowed pre-`served` only (`ORDER_CLOSED` otherwise). Voids all items, bumps open tickets (system), frees the table (`occupied → needs_cleaning`), writes `order_cancelled`. |
| `apply_order_discount(order_id uuid, amount bigint, reason text)` | `pos.discount` | `amount > 0`, `discount_total + amount ≤ subtotal` (`DISCOUNT_EXCEEDS_SUBTOTAL`), order not terminal. Inserts an `order_discounts` row. |
| `set_order_status(order_id uuid, to_status text)` | per the order table (`served`, `accepted`) | Validates through the SQL mirror of `canTransitionOrder`. Derived statuses (`preparing`, `ready`) and `completed` are rejected here (`INVALID_TRANSITION`). |
| `update_kot_status(ticket_id uuid, to_status text)` | `kitchen.update` | Validates `canTransitionKot`, stamps `accepted_at`/`ready_at`/`bumped_at`, re-derives the order status, writes `kot_status_changed`. Idempotent: setting the current status again is a no-op that returns ok. |
| `set_kot_item_status(ticket_item_id uuid, to_status text)` | `kitchen.update` | `pending ↔ ready` only. |
| `mark_table_clean(table_id uuid)` | `orders.create` | `needs_cleaning → available`. |

## Void and discount rules

- **Void** needs `orders.void` and a reason (3–200 chars, trimmed). Allowed on an item at any time before the order is `served`, including after the kitchen started it (the KDS shows it struck through so the cook stops). After `served`/`completed`, items cannot be voided here; refunds are the Bills contract.
- **Cancel** is the whole-order version of void. Reason required.
- **Discount** needs `pos.discount`, amount in minor units, reason required. It reduces what the bill charges; tax treatment is decided in the Bills contract. Discounts do not touch kitchen tickets.
- Voids, cancels and discounts write `audit_logs` (actor, reason, amounts) in addition to `order_events`.
- Default role grants today: `orders.void` and `pos.discount` are held by `owner` and `manager` only. **OPEN-1**: can waiters or cashiers void an item they just entered by mistake (before the kitchen accepted it)? Default: no. Alternative: allow the creator to void their own item while its ticket is still `new`.

## Realtime

Subscribe per location channel **`location:{locationId}`** (Broadcast; RLS on the channel via `realtime.messages` policies requires org membership + `has_location_access` + `orders.view` or `kitchen.view`). Database triggers publish **after commit of the row change** through `realtime.broadcast_changes`/`realtime.send`, with **ids and statuses only**.

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

`OrderSummary` = `{ id, orderNumber, channel, status, tableLabel | null, itemCount, subtotal, currency, createdAt, updatedAt }`. `KdsTicket` = `{ id, ticketNumber, orderNumber, tableLabel | null, stationId, status, createdAt, items: { id, name, variantName, quantity, modifiersText, note, status }[] }`. The KDS never receives prices. Timers on the KDS (amber/red) are computed in the client from `createdAt` and the server `now` returned with the payload, in thresholds from location settings (default amber 10 min, red 20 min; **OPEN-8**).

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
| `markOrderServed` | `orderId` | `set_order_status(..., 'served')` |
| `updateKotStatus` | `ticketId`, `status` (`in_progress` \| `ready`) | `update_kot_status` |
| `bumpKot` | `ticketId` | `update_kot_status(..., 'bumped')` |
| `setKotItemStatus` | `ticketItemId`, `status` | `set_kot_item_status` |
| `markTableClean` | `tableId` | `mark_table_clean` |

Every mutation calls `requirePermission(orgId, perm)` in the lib before touching the database (defence in depth over the RPC check), validates with Zod (schemas shared with the form), and calls `updateTag('orders:{locationId}')`. PostHog events (group = org, no PII, no names/notes): `order_placed`, `order_round_sent`, `order_item_voided`, `order_cancelled`, `discount_applied`, `kot_status_changed`; added to `lib/posthog/events.ts`. Emails: none.

POS offline behaviour: the cart is persisted locally with its `clientRef`. On reconnect the POS re-sends with the **same** `clientRef`; the server's replay makes this safe. The POS must not mint a new `clientRef` for a retry of the same cart.

## Errors

New members of `ActionErrorCode` in `lib/auth/schemas.ts`, added by DAVIN: **`ITEM_UNAVAILABLE`**, **`MODIFIER_INVALID`**, **`VARIANT_REQUIRED`**, **`TABLE_NOT_FOUND`**, **`ORDER_CLOSED`**, **`ALREADY_VOID`**, **`INVALID_TRANSITION`**, **`DISCOUNT_EXCEEDS_SUBTOTAL`**, **`CLIENT_REF_CONFLICT`**. Reused: `FORBIDDEN`, `PLAN_LIMIT`, `INVALID_INPUT` (Zod/shape errors).

| SQL | Code |
|---|---|
| `42501` | `FORBIDDEN` |
| P0001 `ITEM_UNAVAILABLE` (hint: item ids) | `ITEM_UNAVAILABLE`, `details.itemIds` |
| P0001 `MODIFIER_INVALID`, `VARIANT_REQUIRED`, `TABLE_NOT_FOUND`, `ORDER_CLOSED`, `ALREADY_VOID`, `INVALID_TRANSITION`, `DISCOUNT_EXCEEDS_SUBTOTAL`, `CLIENT_REF_CONFLICT` | same names |
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
| Apply discount (`pos.discount`) | ✓ | ✓ | – (OPEN-1) | – | – |
| Read KDS tickets (`kitchen.view`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Update/bump tickets (`kitchen.update`) | ✓ | ✓ | – | – | ✓ |
| Read `order_events` | ✓ | ✓ | – | – | – (`orders.void` or `reports.view` required) |

Notes: `kitchen` has `orders.view`, so it can read orders at its locations; ticket-item columns carry no prices. `order_items` price columns are readable by `orders.view` holders (the kitchen role included). Hiding prices from the kitchen role would need a view; **OPEN-9**. Custom roles get exactly the permissions they were granted, nothing is implied.

Tests (REYKI, `supabase/tests/isolation/`): cross-org read/write fails on every table; a location-scoped member cannot read another location's orders, tickets or events; direct `INSERT/UPDATE/DELETE` by `authenticated` fails everywhere; `anon` cannot execute any RPC; each RPC rejects a caller lacking its permission; replay with the same `client_ref` returns the same order and creates no second row; a different body with the same `client_ref` fails `CLIENT_REF_CONFLICT`; a failed round leaves no order, items, tickets, seat or `order_rounds` row; client-supplied price/total keys are rejected; sold-out/unpublished/invalid-modifier lines reject the whole round; the transition matrix in SQL equals the TS table; derived order status follows tickets; table status follows seat/close.

## Open questions for ALAN

1. **OPEN-1** Can waiters/cashiers void? Default: only `orders.void` holders (owner, manager). Option: creator may void their own item while its ticket is `new`.
2. **OPEN-2** Who marks a table clean? Default: `orders.create` (waiters, cashiers), because waiters do not hold `tables.manage`.
3. **OPEN-3** Items with no kitchen station: default is to route them to the location's first active station (by `sort_order`). If a location has no station at all, the round is rejected `INVALID_INPUT` ("Set up a kitchen station first"), or alternatively the item skips the KDS (e.g. drinks). Which?
4. **OPEN-4** QR/online orders need staff approval before `accepted`? (PLAN M4 says optional.) This contract keeps `placed → accepted` as a staff action for those channels and automatic for staff-entered ones; the guest wrapper RPC is specified in the M4 contract.
5. **OPEN-5** Removing a discount after the fact: this contract has no delete. Proposal: a `remove_order_discount` RPC (needs `pos.discount`, writes an event). Needed before launch?
6. **OPEN-6** Should marking the last ticket item `ready` auto-mark the ticket `ready`? Default: no, the cook taps the ticket.
7. **OPEN-7** Order number: resets daily per location (default, short numbers on the pass and receipts) or runs forever?
8. **OPEN-8** KDS timer thresholds: fixed 10/20 minutes or a per-location setting (needs a settings column in a later migration)?
9. **OPEN-9** Should the `kitchen` role be unable to read prices (`order_items.unit_price`, `line_total`)? Default: they can; the KDS payload simply omits them.

## Out of scope here

Bills, bill items, payments, partial/split payments, refunds, cash sessions, tax and service charge computation, printing, reservations, QR guest intake (`submit_guest_order`, M4), online pickup, loyalty. Each gets its own contract.
