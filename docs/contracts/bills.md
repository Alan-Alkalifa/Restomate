# Contract: bills, payments, refunds, cash sessions (M3 Bills, MSC-T05)

Draft 2026-11-12 by **DAVIN** for ALAN's review. **DAVIN** implements the schema, the RPCs and `lib/bills`. **ADIT** builds the bill, payment and print screens against it. **REYKI** writes the isolation tests against it. Changes need agreement from all three, plus ALAN, and are made in this file first. This is the "M3 Bills" contract that `docs/contracts/orders.md` defers to; it assumes orders.md and changes it only where listed in *Changes required to orders.md*.

Everything marked **Proposed** is a decision DAVIN made so the contract is complete; ALAN can overturn it. The product questions raised in review were answered by the user on 2026-11-12 and are folded in (Decisions log 10–15). Nothing is open; deferred items are listed at the end.

## Scope and rules that apply everywhere

- Same base rules as orders.md: every table has `organization_id` (NOT NULL, indexed) and `location_id` with the composite FK `(location_id, organization_id) → locations (id, organization_id)`; RLS on every table; **money is `bigint` minor units** plus the location's `currency` (IDR exponent 0); no floats anywhere, including JSON; timestamps are `timestamptz`, displayed in the location timezone.
- **Clients never write bill tables.** `INSERT/UPDATE/DELETE` on every table in this file is revoked from `anon` and `authenticated`. The only write path is the security-definer RPCs below (`search_path = ''`, execute revoked from `public`/`anon`, granted to `authenticated`). `SELECT` is granted per column and RLS-filtered.
- **Nothing priced or scoped by the client.** Organization and location come from the order/bill row. Bill amounts are computed in the database from the order snapshot. The only amounts a client ever sends are a payment `amount`, cash `tendered`, a refund `amount`, an `opening_float` and a `counted_cash`, and each is validated server-side (below).
- Amounts are never negative, with one exception: `cash_sessions.variance` is a signed difference (counted − expected), documented where it appears.
- **Payment status is derived, never stored or set by hand** (CLAUDE.md). It is computed from `payments` and `refunds` (see *Derived payment status*).
- The money math lives in **one module**, `apps/web/lib/money.ts`: `calculateBill`, `allocate`, and one new pure helper `allocateByWeights` (added with the implementation, unit-tested, see *Splits*). SQL does not re-implement the percentage math independently: the RPC computes totals with a SQL function that mirrors `calculateBill` exactly, and a pgTAP test checks the SQL against the TS golden vectors in the worked examples below.

## Tables

### `bill_sets`

A bill set is the snapshot of one order at billing time. An unsplit order has a set with one bill; a split order has a set with N bills. The set is the unit that locks the order and completes it.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id` | |
| `order_id` | uuid, composite FK `(order_id, location_id)` → `orders`. **Unique where `status = 'active'`**: one active set per order |
| `split_kind` | `none` \| `equal` \| `by_item` |
| `status` | `active` \| `void` |
| `currency` | char(3), copied from the order |
| `tax_rate_bps` | integer 0–10000, snapshot of the items' `tax_rate_bps` (all items share one rate, see *Tax*) |
| `service_charge_bps`, `tax_on_service_charge` | snapshot of the location settings at billing time |
| `subtotal`, `discount_total`, `service_charge`, `tax`, `total` | bigint ≥ 0 (set-level totals; for `by_item` they are the sums over its bills, see *Splits*) |
| `created_by` | uuid → `auth.users` |
| `voided_at`, `voided_by`, `void_reason` | set together; reason 3–200 chars |
| `created_at`, `updated_at` | |

Constraints: `total = subtotal - discount_total + service_charge + tax`; `discount_total <= subtotal`; `split_kind`/`status` checks; void fields all-or-none and only when `status = 'void'`.

### `bills`

One row per **payable** bill. This is the thing a customer pays and a printer prints.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id` | |
| `bill_set_id` | FK → `bill_sets`; composite FK includes `organization_id` |
| `order_id` | denormalised from the set (same FK as above) for indexes and Realtime |
| `bill_number` | integer, human number, **unique per `(location_id, business_date)`**, resets daily, allocated from `order_counters` with `kind = 'bill'` (the orders.md `kind` check gains `'bill'`), never `max()+1` |
| `business_date` | date, location-local date when the set was created, same rule as `orders.business_date` |
| `share_no`, `share_count` | integers; unsplit is `1 of 1`; unique `(bill_set_id, share_no)`; `share_no between 1 and share_count`; `share_count between 1 and 20` |
| `subtotal`, `discount`, `service_charge`, `tax`, `total` | bigint ≥ 0; `total = subtotal - discount + service_charge + tax`. These are what this bill charges |
| `print_count` | integer not null default 0 |
| `last_printed_at`, `last_printed_by` | timestamptz / uuid null |
| `created_at`, `updated_at` | |

`sum(bills.total)` over a set equals `bill_sets.total` exactly (enforced by the RPC and tested). A bill has **no stored payment status** and no stored paid amount; both come from the view `bill_balances`.

### `bill_items` (snapshot lines)

Copied from `order_items` where `status = 'active'` when the set is created. Immutable afterwards. Later menu or order edits never change a bill.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `bill_set_id` | |
| `bill_id` | uuid null. Set for `none` and `by_item` (the bill this line is on). **Null for `equal`**, where every bill shares all lines (each bill prints the full list plus "share k of n") |
| `order_item_id` | uuid null FK with **on delete set null**; unique `(bill_set_id, order_item_id)` |
| `item_name`, `variant_name` | text snapshot |
| `modifiers_text` | text null, comma-joined modifier names, snapshot |
| `quantity` | integer 1–99 |
| `unit_price`, `modifiers_total`, `line_total` | bigint snapshot of the order item values (`line_total = (unit_price + modifiers_total) * quantity`) |
| `tax_rate_bps` | integer snapshot |
| `created_at` | |

The order item `note` is **not** copied (allergy and kitchen notes do not belong on a bill).

### `payments`

Many per bill. Append-only: a payment is never edited or deleted; a mistake is corrected with a refund.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `bill_id` | composite FK `(bill_id, location_id)` |
| `method` | `cash` \| `edc_card` \| `other` \| `doku`. **`doku` is reserved for M5**: `record_payment` rejects it (`METHOD_NOT_ALLOWED`), and only the verified DOKU notification path (M5 contract) may insert it |
| `status` | `succeeded` in M3. `pending`, `failed`, `expired` are reserved for M5; all M3 rows are `succeeded` and every sum below counts `succeeded` rows only |
| `amount` | bigint **> 0**: the amount applied to the bill (never includes change) |
| `tendered` | bigint null. `cash` only: cash handed over, `>= amount` |
| `change_given` | bigint null. `cash` only: `tendered - amount`, stored |
| `method_label` | text null, 2–40 chars. Required for `other` (for example `Voucher`, `Bank transfer`); null otherwise |
| `approval_code` | text null, `^[A-Za-z0-9]{4,12}$`. `edc_card` only, optional, the terminal's approval code. **No card number, expiry or any card data is ever accepted or stored** (CLAUDE.md) |
| `cash_session_id` | uuid null FK → `cash_sessions`. Required (not null) for `cash`, null for other methods |
| `invoice_number`, `gateway_session_id`, `expires_at` | present for M5, **null in M3**. Unique `(organization_id, invoice_number)` where not null |
| `client_ref` | uuid, **unique `(organization_id, client_ref)`** |
| `request_hash` | text, sha-256 of the canonical request, to detect a reused `client_ref` with a different body |
| `received_by` | uuid → `auth.users` |
| `created_at` | |

Constraints: `amount > 0`; cash rows have `tendered >= amount`, `change_given = tendered - amount` and a session; non-cash rows have null `tendered`, `change_given` and `cash_session_id`; `method = 'other'` ⇒ `method_label` not null; `approval_code` only on `edc_card`.

### `refunds`

Recorded only (no gateway in M3). Append-only.

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id`, `payment_id`, `bill_id` | `payment_id` composite FK; `bill_id` equals the payment's bill |
| `amount` | bigint **> 0** |
| `reason` | text, 3–200 chars, required |
| `kind` | `manual` (the only value in M3; M5 may add `gateway`) |
| `cash_session_id` | uuid null: set when the refunded payment was `cash` (cash leaves the drawer), null otherwise |
| `client_ref`, `request_hash` | same idempotency pair as payments |
| `refunded_by`, `created_at` | |

### `cash_sessions`

| Column | Rule |
|---|---|
| `id`, `organization_id`, `location_id` | |
| `status` | `open` \| `closed`. **At most one open session per location** (unique partial index on `(location_id)` where `status = 'open'`) |
| `opening_float` | bigint ≥ 0 |
| `opened_by`, `opened_at` | |
| `closed_by`, `closed_at` | null while open; set together |
| `expected_cash` | bigint null until closed, computed at close (below) |
| `counted_cash` | bigint ≥ 0 null until closed, the figure the cashier counted |
| `variance` | bigint null until closed: `counted_cash - expected_cash`. **Signed** (negative = short) |
| `close_note` | text null ≤ 200; **required (≥ 3 chars) when `variance <> 0`** |

`expected_cash = opening_float + sum(cash payments.amount in this session) - sum(refunds.amount with cash_session_id = this session)`. Change is not part of the sum because `amount` is already net of change. Expected is computed inside `close_cash_session` from rows, never trusted from the client.

### `bill_events` (audit trail, append-only)

`id`, `organization_id`, `location_id`, `bill_set_id` null, `bill_id` null, `payment_id` null, `refund_id` null, `cash_session_id` null, `actor_id` null (null = system, for example derived paid), `event_type`, `payload` jsonb (ids, amounts, methods, reasons; **no PII, no tokens, no card data**), `created_at`.

`event_type`: `bill_created`, `bill_voided`, `payment_recorded`, `refund_recorded`, `bill_paid` (system, when a bill first becomes paid), `bill_printed`, `cash_session_opened`, `cash_session_closed`. Written only inside the RPCs, in the same transaction as the change. No UPDATE/DELETE grants or policies. A mirror row goes to `audit_logs` for **void, refund, and session close with variance ≠ 0**. Order completion and table changes are written to `order_events` exactly as in orders.md (system actor).

### `bill_balances` (view, `security_invoker = true`)

One row per bill, RLS-filtered through the caller:

`bill_id, bill_set_id, order_id, location_id, total, paid_total, refunded_total, outstanding, payment_status`, where

- `paid_total = coalesce(sum(payments.amount) filter (where status = 'succeeded'), 0)`
- `refunded_total = coalesce(sum(refunds.amount), 0)`
- `outstanding = greatest(total - paid_total, 0)` (**gross**: a refund never re-opens a bill, see *Derived payment status*)
- `payment_status` per the table below.

### Indexes

`bill_sets (order_id) where status = 'active'` (unique), `bills (bill_set_id)`, `bills (organization_id, location_id, business_date)`, `bill_items (bill_set_id)`, `payments (bill_id)`, `payments (organization_id, location_id, created_at)`, `payments (cash_session_id)`, `refunds (payment_id)`, `refunds (bill_id)`, `cash_sessions (organization_id, location_id, opened_at)`, `bill_events (bill_set_id, created_at)`. The report indexes follow CLAUDE.md `(organization_id, location_id, created_at)`.

## When a bill can be created

**Proposed:** from `accepted` onward, that is `accepted`, `preparing`, `ready` or `served`. Never for `draft`, `placed` (guest orders not yet accepted), `completed` or `cancelled` (`ORDER_NOT_BILLABLE`).

Why not "only when served": takeaway and counter service are paid first, and a dine-in guest often asks for the bill while the last dish is still out. Why not earlier than `accepted`: a `qr`/`online` order that staff has not accepted may still be refused. The order must have at least one `active` item; a set with `subtotal = 0` is allowed (free items) and is simply already paid (see below).

**The bill locks the order.** While an `active` set exists for an order, `submit_order_round`, `void_order_item`, `apply_order_discount` and `remove_order_discount` on that order fail with `BILL_EXISTS` (`details.billSetId`). To change the order, void the unpaid set first (`void_bill_set`), edit the order, then create the bill again. This is what keeps the snapshot honest and the totals in step with the order.

## Totals, discount, service charge, tax

All computed **only** by `calculateBill` in `lib/money.ts` (mirrored in SQL), once, at set creation, and stored.

1. `subtotal` = sum of `bill_items.line_total` (the order's non-void items).
2. **Order discounts apply before service charge and tax** (**Proposed**): `net = subtotal - discount_total`, where `discount_total` is `orders.discount_total` (active `order_discounts` only).
3. `calculateBill({ subtotal: net, serviceChargeBps, taxRateBps, taxOnServiceCharge })`: service charge = `net × serviceChargeBps / 10000`, then tax on `net + service charge` when `taxOnServiceCharge` (the default), or on `net` only when the location setting says so.
4. **Rounding (IDR): half-up, once per percentage step, to a whole rupiah** (the `calculateBill` default, exact integer ratio via BigInt). `half-even` is not used. Cash rounding to Rp 100/500 is **not** done in M3 (**Decided**, log 10): the exact rupiah is charged.
5. Stored: `subtotal`, `discount_total`, `service_charge`, `tax`, `total = net + service_charge + tax` on the set; the bills carry their shares.

A bill's `service_charge_bps`, `tax_on_service_charge` and `tax_rate_bps` are the values **snapshotted at creation**; editing the location settings later never changes an existing bill.

**Tax rate.** Every `order_items.tax_rate_bps` is the location rate when that round was sent. If all lines share one rate, that rate is the set's `tax_rate_bps`. If they differ (an owner changed the rate mid-order), `create_bills` fails with `TAX_RATE_MISMATCH` rather than guessing (an M3 limit, Decisions log 9).

## Splits

A set is created with exactly one split choice, in one transaction. Re-splitting later means voiding the unpaid set and creating a new one (a set that holds money cannot be voided or re-split: refund first, see `void_bill_set` and Decisions log 9, 13).

### `none`

One bill. `bills` row = the set totals; every `bill_item` has `bill_id` of that bill.

### `equal` (2–20 shares)

Totals are computed once on the whole order (steps 1–5 above), giving the set `subtotal`, `discount_total`, `service_charge`, `tax`, `total`. Then **every component is allocated** with `allocate` (the remainder goes one unit each to the first shares), and the share total is the **derived sum**:

- `subtotal_i = allocate(subtotal, n)[i]`, `discount_i = allocate(discount_total, n)[i]`, `service_charge_i = allocate(service_charge, n)[i]`, `tax_i = allocate(tax, n)[i]`.
- `total_i = subtotal_i - discount_i + service_charge_i + tax_i`.

Each component sums exactly to its set figure, so `sum(total_i) = set.total` exactly. Every component stays ≥ 0 because `allocate` never returns a negative, and `discount_i <= subtotal_i` always holds: with `discount_total <= subtotal`, both are split with the same remainder order, so the base of the discount is at most the base of the subtotal and, when the bases are equal, the discount remainder is at most the subtotal remainder. Hence `total_i >= 0`. (The first draft allocated the total and derived `tax_i` as the difference; that can go negative, for example a location with service charge but 0% tax, subtotal 5, service 10%, n = 2, so the derivation direction was reversed.) Consequence, accepted: shares may differ from each other by a few rupiah (at most 3: one unit each from subtotal, service charge and tax), not just by 1. `bill_items.bill_id` is null: every bill prints the whole item list and "share k of n".

### `by_item` (2–20 bills)

The client sends an assignment: which order-item lines go on which bill (`assignments`: an array of arrays of `order_item_id`, one inner array per bill). Rules: every `active` order item appears **exactly once** in total (whole lines only, no splitting one line's quantity, an M3 limit, Decisions log 9), no empty bill, ids must belong to the order (else `INVALID_SPLIT`).

Per bill *i*: `subtotal_i` = sum of its lines. The order discount is spread by weight so it sums exactly: `discount_i = allocateByWeights(discount_total, [subtotal_1 … subtotal_n])[i]`. `allocateByWeights(amount, weights)` is a new pure function in `lib/money.ts` using **largest remainder** (floor each exact share, then give the leftover units one each to the largest fractional parts, ties to the lower index), with property tests that the result always sums to `amount`. Then each bill is its own `calculateBill({ subtotal: subtotal_i - discount_i, … })`, and the **set totals are the sums over its bills**.

Consequence, accepted and documented: because each bill rounds its own percentages, `sum(bills)` can differ by a few rupiah from what an unsplit bill of the same order would total (worked example: 1 rupiah). The per-bill figure is what is charged and printed; the difference is never charged separately.

### How split bills relate

All bills of a set share the `bill_set_id` and `order_id`, pay independently, and have their own `bill_number`, payments, refunds and derived status. The **order completes only when every bill in the active set is `paid`** (below).

## Derived payment status

Computed in `bill_balances`, in this order of precedence (**gross** payments, so a refund never re-opens a bill; `refunded_total <= paid_total` always holds):

| Condition | `payment_status` |
|---|---|
| `refunded_total > 0` and `refunded_total = paid_total` | `refunded` |
| `refunded_total > 0` and `refunded_total < paid_total` | `partially_refunded` |
| `paid_total = 0` and `total > 0` | `unpaid` |
| `0 < paid_total < total` | `partially_paid` |
| `paid_total >= total` (including `total = 0`) | `paid` |

Because `paid_total` can never exceed `total` (the cap below), `paid` means `paid_total = total`. A bill with `total = 0` is `paid` from creation.

**Order completion and the table (system, same transaction).** After every `record_payment`, after `create_bills` (for a zero total), and inside `set_order_status(..., 'served')`, the database evaluates: *the order is `served` **and** every bill of its active set is `paid`.* When both hold, in the same transaction it sets `orders.status = 'completed'` (via the existing guard, `served → completed`, `completed_at`, an `order_status_changed` event with `actor_id = null`) and, for a `dine_in` order, moves the table `occupied → needs_cleaning` (a `table_status_changed` event), exactly as orders.md already states for `completed`. Whichever of "served" and "fully paid" happens last triggers it. `takeaway` has no table to move. A later refund never un-completes an order.

## RPCs

All are security definer, `search_path = ''`, authorize first (`has_location_access` plus the permission), return the same `FORBIDDEN` (`42501`) for an unknown id and for a missing permission so ids cannot be probed, run in **one transaction**, and write `bill_events` (and `audit_logs` where stated). **Lock order** (to avoid deadlocks with `submit_order_round`, which locks the table then the order): `tables` → `orders` → `bill_sets`/`bills` → `cash_sessions`.

| RPC | Permission | Behaviour |
|---|---|---|
| `create_bills(order_id uuid, client_ref uuid, split_kind text default 'none', split_count int default null, assignments jsonb default null)` | `payments.take` **or** `bills.print` (a waiter can raise the pre-bill; only `payments.take` holders can void it) | See below |
| `void_bill_set(bill_set_id uuid, reason text)` | `payments.take` if the set never had a payment; `payments.refund` if it has any payment history | Set must be `active` (`BILL_VOID`) and its order not `completed`/`cancelled` (`ORDER_CLOSED`). **A set that holds money cannot be voided** (**Decided**, log 13): the net paid over the whole set, `sum(payments.amount) - sum(refunds.amount)`, must be 0, else `BILL_HAS_PAYMENTS`. So a manager first refunds every payment (`record_refund`, reason + audit), then voids. Sets `status = 'void'` and the void fields, writes `bill_voided` + `audit_logs`. The order is unlocked. Reason 3–200 |
| `record_payment(bill_id uuid, method text, amount bigint, client_ref uuid, tendered bigint default null, method_label text default null, approval_code text default null)` | `payments.take` | See below |
| `record_refund(payment_id uuid, amount bigint, reason text, client_ref uuid)` | `payments.refund` | See below |
| `open_cash_session(location_id uuid, opening_float bigint)` | `payments.take` | No open session at the location (`SESSION_ALREADY_OPEN`); `opening_float` 0..1e12. Inserts the row, `cash_session_opened` |
| `close_cash_session(session_id uuid, counted_cash bigint, note text default null)` | `payments.take` | Session `open` (`SESSION_CLOSED`). Computes `expected_cash`, `variance`; `variance <> 0` requires `note` ≥ 3 chars (`INVALID_INPUT`, field `note`). Sets the closed fields, `cash_session_closed`; `audit_logs` row when `variance <> 0`. Idempotent for an already closed session with the same figures |
| `record_bill_print(bill_id uuid)` | `bills.print` | Locks the bill, increments `print_count`, sets `last_printed_at/by`, writes `bill_printed`; returns `{ printCount, duplicate }` where `duplicate = (print_count before this call) >= 1` |

### `create_bills`

1. Authorize; load and lock the order (`ORDER_NOT_BILLABLE` unless `accepted`/`preparing`/`ready`/`served` with at least one `active` item).
2. **Idempotency.** An `active` set already exists: if it was created with the same `client_ref` and identical split request, return it with `replayed = true`; otherwise `BILL_EXISTS`. The unique index serialises concurrent calls.
3. Validate the split (`INVALID_SPLIT`): `none` takes no count/assignments; `equal` needs `split_count` 2–20 and no assignments; `by_item` needs `assignments` covering every active item exactly once with 2–20 groups.
4. Check one tax rate (`TAX_RATE_MISMATCH`); snapshot the lines into `bill_items`; read the location's `service_charge_bps`/`tax_on_service_charge`; compute totals per *Totals* and *Splits*; allocate `bill_number`s from `order_counters` (`kind = 'bill'`, locked, gapless per day).
5. Insert the set, bills, items, events. If the set's total is 0, run the completion check immediately.
6. Returns:

```ts
type CreateBillsResult = {
  billSetId: string; orderId: string; splitKind: 'none' | 'equal' | 'by_item';
  currency: string; replayed: boolean;
  bills: { id: string; billNumber: number; shareNo: number; shareCount: number; total: number }[];
};
```

### `record_payment`

Canonical request for `request_hash`: one JSON object with keys in the fixed order `bill_id`, `method`, `amount`, `tendered` (null if none), `method_label` (null if none, trimmed), `approval_code` (null if none); no whitespace; UTF-8; uuids lowercase.

1. Authorize; lock the order, then the bill. The bill's set must be `active` (`BILL_VOID`).
2. **Idempotency.** Same `client_ref` and hash returns the stored result with `replayed = true`; a different hash is `CLIENT_REF_CONFLICT`; a concurrent duplicate is serialised by the unique index. The cashier can retry safely on flaky Wi-Fi.
3. `method` must be `cash`, `edc_card` or `other` (`METHOD_NOT_ALLOWED` for `doku` or anything else). `amount > 0`.
4. **Cap:** `amount <= outstanding` (`PAYMENT_EXCEEDS_OUTSTANDING`, `details.outstanding`). The server never accepts more than is owed. Cash change is the only overshoot, and it is `tendered`, not `amount`.
5. `cash`: `tendered` required and `>= amount` (`TENDERED_TOO_LOW`); `change_given = tendered - amount`; requires an **open cash session** at the location (`NO_OPEN_SESSION`) and stores its id. `edc_card`: no tendered; optional `approval_code`. `other`: `method_label` required.
6. Insert the payment, `payment_recorded`; write `bill_paid` (system) if the bill just became paid; run the order completion check.
7. Returns:

```ts
type RecordPaymentResult = {
  paymentId: string; billId: string; paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded';
  paidTotal: number; outstanding: number; changeGiven: number | null;
  orderCompleted: boolean; replayed: boolean;
};
```

### `record_refund`

1. Authorize `payments.refund`; load the payment and lock its bill. `reason` required, 3–200 (`INVALID_INPUT`).
2. `amount > 0` and `amount <= payment.amount - sum(refunds already on this payment)` (`REFUND_EXCEEDS_PAID`). The sum over a bill therefore never exceeds `paid_total`.
3. A refund of a `cash` payment needs an open cash session (`NO_OPEN_SESSION`) and stores it, because the cash leaves the drawer. Refunds of `edc_card`/`other` payments store no session.
4. Idempotency exactly as `record_payment` (canonical keys `payment_id`, `amount`, `reason` trimmed).
5. Insert the refund, `refund_recorded` + `audit_logs` (actor, reason, amount, method). Status is re-derived; the order is **not** touched. Returns `{ refundId, billId, paymentStatus, refundedTotal, replayed }`.
6. DOKU gateway refunds are M5. Until then, every refund is manual: staff return the money themselves and this records it.

## Permissions

| Capability | owner | manager | cashier | waiter | kitchen |
|---|---|---|---|---|---|
| Read payments, refunds, cash sessions and `bill_balances` (`payments.view`) | ✓ | ✓ | ✓ | – | – |
| **View and print bills / pre-bills**: read `bill_sets`, `bills`, `bill_items`; `create_bills`; `record_bill_print` (**`bills.print`**, new) | ✓ | ✓ | ✓ | ✓ | – |
| Void an unpaid bill set, take payments, open / close cash session (`payments.take`) | ✓ | ✓ | ✓ | – | – |
| Refund, and void a set that has payment history once refunded (`payments.refund`) | ✓ | ✓ | – | – | – |
| Read `bill_events` | ✓ | ✓ | – | – | – (`payments.refund` or `reports.view` required) |
| Aggregated bill/payment reports (`reports.view`, through `security invoker` views, never direct table access) | ✓ | ✓ | – | – | – |

Discounts stay in the orders contract (`pos.discount`); creating a bill uses whatever discount the order already has. `has_location_access` applies to every row for staff limited to locations. Custom roles get exactly the permissions they were granted. **New permission `bills.print`** ("View and print bills", **Decided**, log 14): narrower than giving waiters `payments.view`, which would also expose payments, refunds and cash sessions. The implementation migration adds the `permissions` row (`bills.print` fits the key format), adds it to `default_role_permissions` for `manager`, `cashier` and `waiter` (owner has everything), and **backfills `role_permissions`** for the system roles of existing organizations; custom roles get nothing implied. A waiter can read bills and their lines (with totals), raise and print a pre-bill, but `record_payment`, `record_refund`, `open_cash_session`, `close_cash_session` and `void_bill_set` return `FORBIDDEN`, and the waiter sees no payment, refund or session rows and no payment status.

**RLS.** `bill_sets`, `bills` and `bill_items`: `SELECT` where `is_org_member(organization_id) and has_location_access(location_id) and (has_permission(organization_id, 'payments.view') or has_permission(organization_id, 'bills.print'))`. `payments`, `refunds` and `cash_sessions`: the same with `payments.view` only; `bill_events` additionally needs `payments.refund` or `reports.view`, so a cashier (who holds `payments.view` only) selects **0 rows** from `bill_events` (RLS filters; there is no error). No INSERT/UPDATE/DELETE policy and no write grant for anyone; the RPCs bypass RLS as owner and re-check authorization themselves. `bill_balances` is `security_invoker` **and** filters its rows with `has_permission(organization_id, 'payments.view')`, so a `bills.print`-only user gets no rows (and never a misleading `paid_total = 0`); it inherits the rest of the policies above.

## Printing hooks

`lib/bills` exposes the data for ADIT's print routes (`components/print/`, 80 mm and 58 mm). Layout and data stay separate (CLAUDE.md), so the same payload can later feed ESC/POS.

```ts
type BillPrintData = {
  bill: { id: string; billNumber: number; shareNo: number; shareCount: number; createdAt: string; businessDate: string };
  location: { name: string; address: string | null; city: string | null; phone: string | null; taxId: string | null; timezone: string; currency: string };
  order: { orderNumber: number; channel: string; tableLabel: string | null; guestCount: number | null };
  lines: { name: string; variantName: string | null; modifiersText: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  totals: { subtotal: number; discount: number; serviceCharge: number; serviceChargeBps: number; tax: number; taxRateBps: number; total: number };
  payments: { method: string; methodLabel: string | null; amount: number; tendered: number | null; changeGiven: number | null; at: string }[];
  paymentStatus: string | null;   // null unless the caller holds payments.view
  printCount: number;      // value BEFORE this print
  duplicate: boolean;      // printCount >= 1: the route prints a "DUPLICATE" mark
};
```

The print route calls `record_bill_print` and renders `duplicate` from its result. `lines` come from `bill_items` (for `equal`, all lines; for `by_item`, that bill's lines). The footer text and logo come from settings and branding. **NPWP (Decided, log 15):** `locations` gains an optional `tax_id` column (text null, digits only, `^[0-9]{15,16}$`, editable with `locations.manage`), printed as `NPWP {formatted}` when set and omitted when null. The column, its grant and the settings field are a small follow-up task (DAVIN migration, ADIT settings field); this contract only defines the print field. The payments block is included **only for callers with `payments.view`**; for a `bills.print`-only caller (a waiter) `payments` is `[]` and `paymentStatus` is `null`, so a pre-bill never leaks payment data.

## Realtime

Bill events go on a **separate private channel** so they stay behind `payments.view`: topic **`location:{locationId}:payments`**, `config: { private: true }`, with a `realtime.messages` policy requiring org membership + `has_location_access` + `payments.view` (a `bills.print`-only waiter does not subscribe: the signals carry payment status, and the waiter refetches the pre-bill on demand). (The orders channel `location:{id}` needs `orders.view`/`kitchen.view`, which the kitchen role holds and which must not see bill signals.) Database triggers emit in the same transaction as the row change, so a rolled-back payment emits nothing. **Ids and statuses only, no amounts, names or methods.**

| Event | Payload (all columns) |
|---|---|
| `bill.changed` | `{ billId, billSetId, orderId, paymentStatus, updatedAt }` (set created, voided, paid, refunded, printed) |
| `payment.changed` | `{ paymentId, billId, updatedAt }` |
| `cash_session.changed` | `{ sessionId, status, updatedAt }` |

**Exact topic matching.** `location:{A}` is a prefix of `location:{A}:payments`, so neither `realtime.messages` policy may use `like 'location:%'`, `starts_with` or any prefix test. Both policies take `realtime.topic()` and match the **whole string** with an anchored pattern, extract the location id from the capture group, cast it to `uuid` (a failed cast denies), and require the canonical lowercase form (`id::text = captured`): orders `^location:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$` with `orders.view` or `kitchen.view`; payments the same pattern plus `:payments$` with `payments.view`. Any other topic, with any extra suffix or prefix, is denied by both. Bill triggers call `realtime.send` with the `:payments` topic only; nothing about a bill is ever sent to `location:{A}`.

The client treats each event as a **signal to refetch** through RLS-filtered selects; refetch everything on reconnect; never assume event order (compare `updatedAt`); show the reconnecting banner. Order completion and table changes still arrive on the orders channel as `order.changed` and `table.changed`. pgTAP tests for the topic rules are listed under *Tests (REYKI)*.

## What ADIT consumes (`apps/web/lib/bills/`)

Data (each authorizes itself with `requireOrgContext` plus a permission, explicit columns, called inside `<Suspense>`; org slug and location id as arguments, never an org id):

```ts
export function getBillsForOrder(orgSlug: string, locationId: string, orderId: string): Promise<BillSetDetail | null>; // payments.view; active set, bills with balances
export function getPrebill(orgSlug: string, locationId: string, orderId: string): Promise<PrebillDetail | null>;       // bills.print or payments.view; active set, bills, lines, totals, NO payment fields
export function getBill(orgSlug: string, locationId: string, billId: string): Promise<BillDetail>;                    // payments.view; lines, payments, refunds, balance
export function getBillPrintData(orgSlug: string, locationId: string, billId: string): Promise<BillPrintData>;        // bills.print (payments block only with payments.view)
export function getOpenCashSession(orgSlug: string, locationId: string): Promise<CashSession | null>;                // payments.view
export function getCashSessionSummary(orgSlug: string, locationId: string, sessionId: string): Promise<CashSessionSummary>; // payments.view; expected so far, counts by method
```

Actions (`'use server'`, `ActionResult`, `orgSlug`/`locationId` bound server-side; no org id in FormData). Every mutation calls `requirePermission(orgId, perm)` first, validates with Zod, then `updateTag('bills:{locationId}')` and `updateTag('orders:{locationId}')`:

| Action | FormData fields | Maps to |
|---|---|---|
| `createBills` | `orderId`, `splitKind`, `splitCount?`, `assignments?` (JSON), `clientRef` | `create_bills` |
| `voidBillSet` | `billSetId`, `reason` | `void_bill_set` |
| `recordPayment` | `billId`, `method`, `amount` (integer string), `tendered?`, `methodLabel?`, `approvalCode?`, `clientRef` | `record_payment`. Success `data`: `{ paymentId, paymentStatus, outstanding, changeGiven, orderCompleted }` |
| `recordRefund` | `paymentId`, `amount`, `reason`, `clientRef` | `record_refund` |
| `openCashSession` | `openingFloat` | `open_cash_session` |
| `closeCashSession` | `sessionId`, `countedCash`, `note?` | `close_cash_session` |
| `recordBillPrint` | `billId` | `record_bill_print`; `data: { printCount, duplicate }` |

`clientRef` is created once per attempt and **reused on retry**; the POS must not mint a new one for a retry of the same payment. PostHog events (group = org, no PII, no amounts beyond the method): `bill_created`, `payment_recorded` (`method`), `refund_recorded`, `cash_session_opened`, `cash_session_closed`; added to `lib/posthog/events.ts`. Emails: none in M3 (receipts by email are later).

## Errors

New members of `ActionErrorCode` in `lib/auth/schemas.ts`, added by DAVIN: **`BILL_EXISTS`**, **`BILL_VOID`**, **`BILL_HAS_PAYMENTS`**, **`ORDER_NOT_BILLABLE`**, **`TAX_RATE_MISMATCH`**, **`INVALID_SPLIT`**, **`METHOD_NOT_ALLOWED`**, **`PAYMENT_EXCEEDS_OUTSTANDING`**, **`TENDERED_TOO_LOW`**, **`NO_OPEN_SESSION`**, **`SESSION_ALREADY_OPEN`**, **`SESSION_CLOSED`**, **`REFUND_EXCEEDS_PAID`**. Reused: `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `CLIENT_REF_CONFLICT`, `ORDER_CLOSED`.

| SQL | Code |
|---|---|
| `42501` | `FORBIDDEN` |
| P0001 with the name above | the same name; `PAYMENT_EXCEEDS_OUTSTANDING` returns `details.outstanding`, `BILL_EXISTS` returns `details.billSetId` |
| `22023` / check violations | `INVALID_INPUT` |

Each failing result is `{ ok: false, code, formError }` with a friendly `formError` (no ids, no SQL text). Everything is all-or-nothing.

## Changes required to orders.md (shipped with the bills implementation, MSC-T07; not part of #123)

1. `submit_order_round`, `void_order_item`, `apply_order_discount`, `remove_order_discount`: reject with `BILL_EXISTS` while an `active` `bill_sets` row exists for the order.
2. `cancel_order`: if the order has an `active` set with **no payments**, it voids the set (same transaction); if the set holds money (net paid > 0) it fails with `BILL_HAS_PAYMENTS`: a manager refunds first, then cancels (**Decided**, log 13). Cancel stays pre-`served` only.
3. `set_order_status(..., 'served')`: after the change, run the completion check from this contract.
4. orders.md says "Cash-first POS may call `completeOrder`". There is **no** `completeOrder` action: completion happens only through the check above, whichever of "served" and "fully paid" is last.
5. `order_counters.kind` gains `'bill'`; the Realtime topic list gains `location:{id}:payments`.
6. The `realtime.messages` policy for `location:{id}` must match the topic **exactly** (anchored pattern, see *Realtime*), never by prefix; if the orders implementation used a prefix test, it is fixed there. These six changes shipped here (migration `20261111180000_bills_rpcs.sql`), so #123 and its QA did not have to reopen. Parameter order note: Postgres needs defaulted parameters last, so `create_bills` and `record_payment` take `client_ref` before the optional ones; callers use named arguments, so only this text differs. Item 6 needed no change: the orders policy `can_receive_location_topic` already matches the topic with an anchored pattern.

## Worked examples (IDR; service 5%, PB1 10% on subtotal + service, half-up)

Order #42: Nasi Goreng 35.000 × 2 = **70.000**; Es Teh 8.000 × 3 = **24.000**; Sate Ayam 45.000 + Keju 5.000 = **50.000**; Kopi 12.000 × 1 = **12.000**. Order discount **10.500**.

**Unsplit bill.**

| Step | Amount |
|---|---|
| subtotal | 156.000 |
| − discount | 10.500 |
| net | 145.500 |
| service 5% (145.500 × 0,05 = 7.275) | 7.275 |
| tax base (net + service) | 152.775 |
| PB1 10% (15.277,5 → half-up) | 15.278 |
| **total** | **168.053** |

**3-way equal split** (every component through `allocate`): subtotal `allocate(156.000, 3)` = 52.000 each; discount `allocate(10.500, 3)` = 3.500 each; service `allocate(7.275, 3)` = 2.425 each; tax `allocate(15.278, 3)` = **5.093 / 5.093 / 5.092**. Share totals are derived: 52.000 − 3.500 + 2.425 + 5.093 = **56.018**; the same for share 2 = **56.018**; share 3: 52.000 − 3.500 + 2.425 + 5.092 = **56.017**. They sum to 56.018 + 56.018 + 56.017 = **168.053** (the unsplit total), and the taxes sum to 5.093 + 5.093 + 5.092 = **15.278**.

**Equal split where the old derivation broke** (service charge, no PB1): subtotal 5, service 10% = 1, tax 0%, total 6, n = 2. Components: subtotal 3 / 2, service 1 / 0, tax 0 / 0 → totals **4 / 2**, sum 6. (Allocating the total as 3 / 3 and deriving tax would have given a tax of −1 on share 1.)

**Partial cash payment with change** (share 1, bill total 56.018, session open): the customer hands over 50.000 and wants to pay 30.000 now → `record_payment(method cash, amount 30.000, tendered 50.000)`: `change_given` = **20.000**, `paid_total` 30.000, `outstanding` 26.018, status `partially_paid`. A second payment of 26.018 by `edc_card` (approval code `A1B2C3`) → `paid_total` 56.018, `outstanding` 0, status `paid`. A payment of 30.000 more would fail `PAYMENT_EXCEEDS_OUTSTANDING`. When shares 2 and 3 are also paid and the order is `served`, the order becomes `completed` and the table `needs_cleaning`.

**Refund.** The 26.018 card payment is refunded by 10.000 (reason "Wrong order"): `refunded_total` 10.000 < `paid_total` 56.018 → `partially_refunded`; `outstanding` stays 0; the order stays `completed`.

**Cash session.** Float **500.000**; cash payments in the session 30.000 (the 20.000 change is not counted); no cash refunds → `expected_cash` = **530.000**. The cashier counts 529.000 → `variance` = **−1.000**, so a `close_note` of at least 3 chars is required.

**By-item split** (bill A = the Nasi Goreng line, 70.000; bill B = the other three lines, 86.000): discount by weight, `allocateByWeights(10.500, [70.000, 86.000])` = exact 4.711,5 / 5.788,5 → floors 4.711 / 5.788, one leftover unit to the larger fraction (A) → **4.712 / 5.788**. Bill A: net 65.288, service 3.264, tax on 68.552 = 6.855, **total 75.407**. Bill B: net 80.212, service 4.011, tax on 84.223 = 8.422, **total 92.645**. Set total = 75.407 + 92.645 = **168.052**, one rupiah less than the unsplit 168.053 (the documented rounding drift; the bills' own figures are charged).

## Tests (REYKI, `supabase/tests/isolation/`)

Isolation (every table and view): a member of org B cannot read or write org A's `bill_sets`, `bills`, `bill_items`, `payments`, `refunds`, `cash_sessions`, `bill_events` or `bill_balances`; a location-scoped member cannot read another location's rows; direct `INSERT/UPDATE/DELETE` by `authenticated` fails on every table; `anon` cannot execute any RPC; each RPC rejects a caller lacking its permission (`payments.take`, `payments.refund`, `payments.view`, `bills.print`) with `FORBIDDEN`; a kitchen user cannot read bills; `bill_events` is hidden without `payments.refund` or `reports.view`: a **cashier with `payments.view` selects 0 rows** (no error) while still reading bills, payments and `bill_balances`, and a manager reads them; org B cannot join `location:{A}:payments`, a location-scoped member cannot join another location's topic, and the orders channel does not carry any bill event. **Topic matching:** a kitchen user (holds `kitchen.view`, no `payments.view`) joins `location:{A}` but is refused `location:{A}:payments`; a custom role with only `payments.view` joins `location:{A}:payments` but is refused `location:{A}`; `location:{A}:payments:x`, `location:{A}x`, `location:{A}:`, `location:{A}:PAYMENTS`, an uppercase-uuid form and a trailing-newline form are refused by **both** policies; a payment recorded at A delivers `payment.changed` on `location:{A}:payments` and nothing on `location:{A}`.

Behaviour:
- **Creation:** allowed for `accepted`/`preparing`/`ready`/`served`, `ORDER_NOT_BILLABLE` for `draft`, `placed`, `completed`, `cancelled` and for an order with no active items; the bill snapshots survive a later menu price edit and a voided order item; one active set per order (`BILL_EXISTS`); same `client_ref` and request replays, a different request is `BILL_EXISTS`; mixed `tax_rate_bps` gives `TAX_RATE_MISMATCH`; `bill_number` resets per location-local day and stays unique under concurrent creation.
- **Order locking:** with an active set, `submit_order_round`, `void_order_item`, `apply_order_discount` and `remove_order_discount` return `BILL_EXISTS`; after `void_bill_set` they work again; `void_bill_set` with any payment returns `BILL_HAS_PAYMENTS`.
- **Math:** SQL totals equal the TS `calculateBill` golden vectors above (168.053; 56.018/56.018/56.017; 75.407/92.645); `sum(bills.total) = bill_sets.total` for `none` and `equal` **property test** (Vitest on the TS helper and pgTAP on the SQL, same vectors) over generated subtotals 1–5.000, discounts 0..subtotal, service 0/5/10%, tax 0/10%, `taxOnServiceCharge` true/false and n ∈ {2,3,4,7,20}, **including tax 0% and service-only locations**: every component of every share is ≥ 0, `discount_i <= subtotal_i`, each component sums exactly to the set, shares differ by at most 3, and `total_i` equals the sum of its components; `by_item` rejects missing, duplicated, foreign or empty assignments (`INVALID_SPLIT`); `allocateByWeights` always sums to its amount (Vitest property test).
- **Payments:** amount above outstanding fails (`PAYMENT_EXCEEDS_OUTSTANDING`), also under two concurrent payments (the second sees the first); cash with `tendered < amount` fails; change equals `tendered − amount`; cash without an open session fails (`NO_OPEN_SESSION`); `doku` is `METHOD_NOT_ALLOWED`; `other` without a label fails; `approval_code` rejects anything that is not 4–12 alphanumerics; no card data column exists; replay with the same `client_ref` creates no second row; a different body with the same `client_ref` is `CLIENT_REF_CONFLICT`; a failed payment leaves nothing behind.
- **Derived status:** `bill_balances` returns unpaid → partially_paid → paid → partially_refunded → refunded for the worked example, and there is no column or path that writes the status; a refund never changes `outstanding` and never lets a further payment through.
- **Completion:** served + all bills paid completes the order and moves the table to `needs_cleaning` in the same transaction, in both orders of events (pay first then serve; serve first then pay); a split set completes only when every bill is paid; a zero-total bill completes immediately; a refund after completion changes nothing on the order.
- **Refunds:** `REFUND_EXCEEDS_PAID` across several partial refunds; cash refund needs an open session; reason required; `payments.refund` required; refund writes `audit_logs`.
- **Cash sessions:** a second open session at a location fails (`SESSION_ALREADY_OPEN`); expected = float + cash payments − cash refunds computed server-side; variance sign; a note is required when variance is not 0; closing twice is idempotent with the same figures and `SESSION_CLOSED` otherwise.
- **Print:** `record_bill_print` returns `duplicate = false` first and `true` afterwards; `print_count` never decreases; `taxId` is in the print data when the location has one and omitted otherwise; the payments block and `paymentStatus` are absent for a `bills.print`-only caller.
- **Waiter (`bills.print` only):** can read `bill_sets`/`bills`/`bill_items` and their totals, `create_bills` and `record_bill_print`; **cannot** `record_payment`, `record_refund`, `open_cash_session`, `close_cash_session` or `void_bill_set` (all `FORBIDDEN`); selects 0 rows from `payments`, `refunds`, `cash_sessions`, `bill_events` and `bill_balances`; cannot join `location:{A}:payments`; a role with neither `payments.view` nor `bills.print` (kitchen) reads no bill rows; the backfill gave the system `waiter`, `cashier` and `manager` roles of existing orgs `bills.print`.
- **Void after refund:** `void_bill_set` on a set with net paid > 0 is `BILL_HAS_PAYMENTS`; after the full refunds (net 0) a `payments.refund` holder can void it and a `payments.take`-only cashier cannot; a set on a `completed` order cannot be voided (`ORDER_CLOSED`).
- **Cancel:** `cancel_order` voids a set whose net paid is 0 and returns `BILL_HAS_PAYMENTS` while money is held.

## Decisions log

Proposed by DAVIN 2026-11-12 (all open to ALAN's review):

1. Bills can be created from `accepted` onward and lock the order until voided.
2. Discounts apply before service charge and tax; service charge first, then tax on net + service (location setting `tax_on_service_charge` respected); half-up rounding to a whole rupiah per step.
3. A bill set holds the snapshot; bills are the payable shares; `equal` shares allocate **every component** with `allocate` and derive the share total (review fix: allocating the total and deriving tax could go negative); `by_item` weights the discount with a new `allocateByWeights` and each bill rounds on its own (drift accepted).
4. Payment status is derived in a view, on gross payments; a refund never re-opens a bill.
5. Cash needs an open session; one open session per location; expected cash excludes change.
6. Order completion is evaluated, not requested: served + every bill paid, whichever comes last; there is no `completeOrder` action.
7. Bill signals use a separate `location:{id}:payments` private channel behind `payments.view`.
8. Cashiers can create and void unpaid bills, take payments and run cash sessions; refunds are manager/owner only (`payments.refund`).

9. **Decided by ALAN 2026-11-12 (kept as M3 limits, moved to the M7 backlog):** re-splitting after a partial payment is not possible (an unpaid set can be voided and recreated); one line is never split across bills (whole lines only); mixed tax rates in one order are refused with `TAX_RATE_MISMATCH`; one cash drawer (open session) per location; any `payments.take` holder may close a session, with a variance audited in `audit_logs` and a note required; receipts by email/WhatsApp and e-faktur are out of scope for M3. Snapshots never change: bills keep the service/tax settings of their creation, and an unpaid set can be voided and recreated to pick up new location settings.

10. **No cash rounding in M3** (user, 2026-11-12): the exact rupiah is charged. A per-location rounding setting is on the backlog.
11. **The order discount applies before service charge and PB1/PBJT**, so tax is on the discounted amount (user). This confirms decision 2.
12. **No tips in M3** (user). Later, as a separate non-taxable line (backlog).
13. **A bill that holds money cannot be voided** (user): a manager refunds first (reason + audit), then voids. Net paid over the set must be 0. The same rule applies to `cancel_order`.
14. **Waiters can view and print the pre-bill** (user), through a new narrow permission `bills.print`; no payments, refunds or sessions (DAVIN's choice over `payments.view`, documented above).
15. **Optional per-location NPWP** (`locations.tax_id`), printed when set (user). Follow-up task: DAVIN migration and ADIT settings field.

## Still open

None. The six product questions were answered on 2026-11-12 (log 10–15) and ALAN's M3 limits are in log 9.

**M7 backlog** (known limits, not blockers): re-splitting after a partial payment; splitting one line across bills; per-rate tax groups for mixed rates; multiple cash drawers per location; a variance threshold that needs a manager to close a session; cash rounding setting; tips as a non-taxable line; receipts by email/WhatsApp and e-faktur.

## Out of scope here

DOKU payments, notifications and reconciliation (M5), subscription billing, gateway refunds, loyalty and customer linking, QR guest bill requests (M4), reports (separate contract, built on the views above), ESC/POS printing.
