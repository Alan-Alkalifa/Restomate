-- MSC-T07 (M3 §7): bills schema. Contract: docs/contracts/bills.md.
-- bill_sets (order snapshot + totals) -> bills (payable shares) -> bill_items; payments, refunds, cash_sessions,
-- bill_events, the bill_balances view, the bills.print permission, RLS (read only; writes only via the RPCs in the
-- next migration) and the private Realtime channel location:{id}:payments.

-- ---------------------------------------------------------------------------
-- Permission bills.print (view + print bills / pre-bills) and its defaults
-- ---------------------------------------------------------------------------
insert into public.permissions (key, category, description) values
  ('bills.print', 'payments', 'View and print bills and pre-bills')
on conflict (key) do nothing;

insert into public.default_role_permissions (role_key, permission_key) values
  ('manager', 'bills.print'), ('cashier', 'bills.print'), ('waiter', 'bills.print')
on conflict do nothing;

-- Backfill the system roles of existing organizations (the owner is implicit; custom roles get nothing).
insert into public.role_permissions (role_id, organization_id, permission_key)
select r.id, r.organization_id, 'bills.print'
from public.roles r
where r.is_system and r.key in ('manager', 'cashier', 'waiter')
on conflict do nothing;

-- Bill numbers come from the same locked daily counter as order and ticket numbers.
alter table public.order_counters drop constraint order_counters_kind_valid;
alter table public.order_counters add constraint order_counters_kind_valid check (kind in ('order', 'ticket', 'bill'));

-- ---------------------------------------------------------------------------
-- bill_sets
-- ---------------------------------------------------------------------------
create table public.bill_sets (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  location_id            uuid not null,
  order_id               uuid not null,
  split_kind             text not null,
  status                 text not null default 'active',
  currency               char(3) not null,
  tax_rate_bps           integer not null,
  service_charge_bps     integer not null,
  tax_on_service_charge  boolean not null,
  subtotal               bigint not null,
  discount_total         bigint not null,
  service_charge         bigint not null,
  tax                    bigint not null,
  total                  bigint not null,
  client_ref             uuid not null,
  request_hash           text not null,
  created_by             uuid references auth.users (id) on delete set null,
  voided_at              timestamptz,
  voided_by              uuid references auth.users (id) on delete set null,
  void_reason            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint bill_sets_split_valid check (split_kind in ('none', 'equal', 'by_item')),
  constraint bill_sets_status_valid check (status in ('active', 'void')),
  constraint bill_sets_rates_range check (tax_rate_bps between 0 and 10000 and service_charge_bps between 0 and 10000),
  constraint bill_sets_money_nonneg check (subtotal >= 0 and discount_total >= 0 and service_charge >= 0 and tax >= 0 and total >= 0),
  constraint bill_sets_discount_range check (discount_total <= subtotal),
  constraint bill_sets_total_sum check (total = subtotal - discount_total + service_charge + tax),
  constraint bill_sets_void_fields check (
    (status = 'void' and voided_at is not null and void_reason is not null and char_length(void_reason) between 3 and 200)
    or (status = 'active' and voided_at is null and voided_by is null and void_reason is null)),
  constraint bill_sets_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint bill_sets_order_fk foreign key (order_id, location_id)
    references public.orders (id, location_id) on delete cascade,
  constraint bill_sets_id_org_unique unique (id, organization_id),
  constraint bill_sets_id_location_unique unique (id, location_id),
  constraint bill_sets_client_ref_key unique (organization_id, client_ref)
);
create unique index bill_sets_one_active_per_order_key on public.bill_sets (order_id) where status = 'active';
create index bill_sets_organization_id_idx on public.bill_sets (organization_id);
create index bill_sets_location_id_idx on public.bill_sets (location_id);
create index bill_sets_order_id_idx on public.bill_sets (order_id);

-- ---------------------------------------------------------------------------
-- bills (payable shares)
-- ---------------------------------------------------------------------------
create table public.bills (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  location_id       uuid not null,
  bill_set_id       uuid not null,
  order_id          uuid not null,
  bill_number       integer not null,
  business_date     date not null,
  share_no          integer not null,
  share_count       integer not null,
  subtotal          bigint not null,
  discount          bigint not null,
  service_charge    bigint not null,
  tax               bigint not null,
  total             bigint not null,
  print_count       integer not null default 0,
  last_printed_at   timestamptz,
  last_printed_by   uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bills_share_range check (share_count between 1 and 20 and share_no between 1 and share_count),
  constraint bills_money_nonneg check (subtotal >= 0 and discount >= 0 and service_charge >= 0 and tax >= 0 and total >= 0),
  constraint bills_discount_range check (discount <= subtotal),
  constraint bills_total_sum check (total = subtotal - discount + service_charge + tax),
  constraint bills_print_count_nonneg check (print_count >= 0),
  constraint bills_set_fk foreign key (bill_set_id, organization_id)
    references public.bill_sets (id, organization_id) on delete cascade,
  constraint bills_order_fk foreign key (order_id, location_id)
    references public.orders (id, location_id) on delete cascade,
  constraint bills_id_org_unique unique (id, organization_id),
  constraint bills_id_location_unique unique (id, location_id),
  constraint bills_number_day_key unique (location_id, business_date, bill_number),
  constraint bills_share_key unique (bill_set_id, share_no)
);
create index bills_organization_id_idx on public.bills (organization_id);
create index bills_set_idx on public.bills (bill_set_id);
create index bills_order_idx on public.bills (order_id);
create index bills_report_idx on public.bills (organization_id, location_id, business_date);

-- ---------------------------------------------------------------------------
-- bill_items (immutable snapshot lines)
-- ---------------------------------------------------------------------------
create table public.bill_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  bill_set_id      uuid not null,
  bill_id          uuid,
  order_item_id    uuid references public.order_items (id) on delete set null,
  item_name        text not null,
  variant_name     text,
  modifiers_text   text,
  quantity         integer not null,
  unit_price       bigint not null,
  modifiers_total  bigint not null,
  line_total       bigint not null,
  tax_rate_bps     integer not null,
  created_at       timestamptz not null default now(),
  constraint bill_items_qty_range check (quantity between 1 and 99),
  constraint bill_items_money_nonneg check (unit_price >= 0 and modifiers_total >= 0 and line_total >= 0),
  constraint bill_items_tax_range check (tax_rate_bps between 0 and 10000),
  constraint bill_items_set_fk foreign key (bill_set_id, organization_id)
    references public.bill_sets (id, organization_id) on delete cascade,
  constraint bill_items_bill_fk foreign key (bill_id, organization_id)
    references public.bills (id, organization_id) on delete cascade,
  constraint bill_items_set_order_item_key unique (bill_set_id, order_item_id)
);
create index bill_items_organization_id_idx on public.bill_items (organization_id);
create index bill_items_set_idx on public.bill_items (bill_set_id);
create index bill_items_bill_idx on public.bill_items (bill_id);

-- ---------------------------------------------------------------------------
-- cash_sessions (one open session per location)
-- ---------------------------------------------------------------------------
create table public.cash_sessions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  status           text not null default 'open',
  opening_float    bigint not null,
  opened_by        uuid references auth.users (id) on delete set null,
  opened_at        timestamptz not null default now(),
  closed_by        uuid references auth.users (id) on delete set null,
  closed_at        timestamptz,
  expected_cash    bigint,
  counted_cash     bigint,
  variance         bigint,          -- signed: counted - expected (negative = short). The one signed money column.
  close_note       text,
  constraint cash_sessions_status_valid check (status in ('open', 'closed')),
  constraint cash_sessions_float_range check (opening_float between 0 and 1000000000000),
  constraint cash_sessions_close_fields check (
    (status = 'open' and closed_at is null and closed_by is null and expected_cash is null
       and counted_cash is null and variance is null)
    or (status = 'closed' and closed_at is not null and expected_cash is not null
       and counted_cash is not null and variance is not null)),
  constraint cash_sessions_counted_range check (counted_cash is null or counted_cash >= 0),
  constraint cash_sessions_note_len check (close_note is null or char_length(close_note) <= 200),
  constraint cash_sessions_variance_note check (
    status = 'open' or variance = 0 or (close_note is not null and char_length(btrim(close_note)) >= 3)),
  constraint cash_sessions_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint cash_sessions_id_org_unique unique (id, organization_id),
  constraint cash_sessions_id_location_unique unique (id, location_id)
);
create unique index cash_sessions_one_open_per_location_key on public.cash_sessions (location_id) where status = 'open';
create index cash_sessions_organization_id_idx on public.cash_sessions (organization_id);
create index cash_sessions_report_idx on public.cash_sessions (organization_id, location_id, opened_at);

-- ---------------------------------------------------------------------------
-- payments (append-only)
-- ---------------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  location_id         uuid not null,
  bill_id             uuid not null,
  method              text not null,
  status              text not null default 'succeeded',
  amount              bigint not null,
  tendered            bigint,
  change_given        bigint,
  method_label        text,
  approval_code       text,
  cash_session_id     uuid,
  invoice_number      text,            -- M5 (DOKU); null in M3
  gateway_session_id  text,            -- M5; null in M3
  expires_at          timestamptz,     -- M5; null in M3
  client_ref          uuid not null,
  request_hash        text not null,
  received_by         uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint payments_method_valid check (method in ('cash', 'edc_card', 'other', 'doku')),
  constraint payments_status_valid check (status in ('succeeded', 'pending', 'failed', 'expired')),
  constraint payments_amount_pos check (amount > 0),
  constraint payments_cash_fields check (
    (method = 'cash' and tendered is not null and tendered >= amount and change_given = tendered - amount
       and cash_session_id is not null)
    or (method <> 'cash' and tendered is null and change_given is null and cash_session_id is null)),
  constraint payments_label_rule check (
    (method = 'other' and method_label is not null and char_length(method_label) between 2 and 40)
    or (method <> 'other' and method_label is null)),
  constraint payments_approval_rule check (
    approval_code is null or (method = 'edc_card' and approval_code ~ '^[A-Za-z0-9]{4,12}$')),
  constraint payments_bill_fk foreign key (bill_id, location_id)
    references public.bills (id, location_id) on delete cascade,
  constraint payments_org_fk foreign key (bill_id, organization_id)
    references public.bills (id, organization_id) on delete cascade,
  constraint payments_session_fk foreign key (cash_session_id, location_id)
    references public.cash_sessions (id, location_id),
  constraint payments_id_org_unique unique (id, organization_id),
  constraint payments_client_ref_key unique (organization_id, client_ref)
);
create unique index payments_invoice_number_key on public.payments (organization_id, invoice_number)
  where invoice_number is not null;
create index payments_organization_id_idx on public.payments (organization_id);
create index payments_bill_idx on public.payments (bill_id);
create index payments_session_idx on public.payments (cash_session_id);
create index payments_report_idx on public.payments (organization_id, location_id, created_at);

-- ---------------------------------------------------------------------------
-- refunds (append-only, recorded only)
-- ---------------------------------------------------------------------------
create table public.refunds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  payment_id       uuid not null,
  bill_id          uuid not null,
  amount           bigint not null,
  reason           text not null,
  kind             text not null default 'manual',
  cash_session_id  uuid,
  client_ref       uuid not null,
  request_hash     text not null,
  refunded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint refunds_amount_pos check (amount > 0),
  constraint refunds_reason_len check (char_length(reason) between 3 and 200),
  constraint refunds_kind_valid check (kind in ('manual')),
  constraint refunds_payment_fk foreign key (payment_id, organization_id)
    references public.payments (id, organization_id) on delete cascade,
  constraint refunds_bill_fk foreign key (bill_id, location_id)
    references public.bills (id, location_id) on delete cascade,
  constraint refunds_session_fk foreign key (cash_session_id, location_id)
    references public.cash_sessions (id, location_id),
  constraint refunds_client_ref_key unique (organization_id, client_ref)
);
create index refunds_organization_id_idx on public.refunds (organization_id);
create index refunds_payment_idx on public.refunds (payment_id);
create index refunds_bill_idx on public.refunds (bill_id);
create index refunds_report_idx on public.refunds (organization_id, location_id, created_at);

-- ---------------------------------------------------------------------------
-- bill_events (append-only audit trail)
-- ---------------------------------------------------------------------------
create table public.bill_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  location_id      uuid not null,
  bill_set_id      uuid,
  bill_id          uuid,
  payment_id       uuid,
  refund_id        uuid,
  cash_session_id  uuid,
  actor_id         uuid,
  event_type       text not null,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint bill_events_type_valid check (event_type in
    ('bill_created', 'bill_voided', 'payment_recorded', 'refund_recorded', 'bill_paid', 'bill_printed',
     'cash_session_opened', 'cash_session_closed')),
  constraint bill_events_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade
);
create index bill_events_organization_id_idx on public.bill_events (organization_id);
create index bill_events_set_created_idx on public.bill_events (bill_set_id, created_at);
create index bill_events_location_id_idx on public.bill_events (location_id);

-- Append-only: payments, refunds, bill_items and bill_events are never updated (cascade deletes still work).
create or replace function private.bills_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;
create trigger payments_no_update before update on public.payments
  for each row execute function private.bills_append_only();
create trigger refunds_no_update before update on public.refunds
  for each row execute function private.bills_append_only();
create trigger bill_items_no_update before update on public.bill_items
  for each row execute function private.bills_append_only();
create trigger bill_events_no_update before update on public.bill_events
  for each row execute function private.bills_append_only();

create trigger bill_sets_set_updated_at before update on public.bill_sets
  for each row execute function private.set_updated_at();
create trigger bills_set_updated_at before update on public.bills
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Derived payment status. ONE definition, used by the view and by the RPCs. Never stored, never set by hand.
-- ---------------------------------------------------------------------------
create or replace function private.payment_status_of(p_total bigint, p_paid bigint, p_refunded bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_refunded > 0 and p_refunded = p_paid then 'refunded'
    when p_refunded > 0 then 'partially_refunded'
    when p_paid = 0 and p_total > 0 then 'unpaid'
    when p_paid < p_total then 'partially_paid'
    else 'paid'
  end;
$$;

create or replace function private.bill_paid_total(p_bill uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)::bigint
  from public.payments p where p.bill_id = p_bill;
$$;

create or replace function private.bill_refunded_total(p_bill uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount), 0)::bigint from public.refunds r where r.bill_id = p_bill;
$$;

-- One row per bill, RLS-filtered through the caller (security_invoker) AND hidden without payments.view, so a
-- bills.print-only user (waiter) gets no rows rather than a misleading paid_total of 0.
create view public.bill_balances with (security_invoker = true) as
select b.id as bill_id, b.organization_id, b.location_id, b.bill_set_id, b.order_id, b.total,
       pt.paid_total, rt.refunded_total,
       greatest(b.total - pt.paid_total, 0)::bigint as outstanding,
       private.payment_status_of(b.total, pt.paid_total, rt.refunded_total) as payment_status
from public.bills b
cross join lateral (select coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)::bigint as paid_total
                    from public.payments p where p.bill_id = b.id) pt
cross join lateral (select coalesce(sum(r.amount), 0)::bigint as refunded_total
                    from public.refunds r where r.bill_id = b.id) rt
where public.has_permission(b.organization_id, 'payments.view');

-- ---------------------------------------------------------------------------
-- RLS + privileges: read only. No INSERT/UPDATE/DELETE grant and no write policy for anyone.
-- ---------------------------------------------------------------------------
alter table public.bill_sets      enable row level security;
alter table public.bills          enable row level security;
alter table public.bill_items     enable row level security;
alter table public.payments       enable row level security;
alter table public.refunds        enable row level security;
alter table public.cash_sessions  enable row level security;
alter table public.bill_events    enable row level security;

create policy bill_sets_select on public.bill_sets
  for select to authenticated
  using ((public.has_permission(organization_id, 'payments.view') or public.has_permission(organization_id, 'bills.print'))
         and public.has_location_access(location_id));
create policy bills_select on public.bills
  for select to authenticated
  using ((public.has_permission(organization_id, 'payments.view') or public.has_permission(organization_id, 'bills.print'))
         and public.has_location_access(location_id));
create policy bill_items_select on public.bill_items
  for select to authenticated
  using ((public.has_permission(organization_id, 'payments.view') or public.has_permission(organization_id, 'bills.print'))
         and public.has_location_access(location_id));
create policy payments_select on public.payments
  for select to authenticated
  using (public.has_permission(organization_id, 'payments.view') and public.has_location_access(location_id));
create policy refunds_select on public.refunds
  for select to authenticated
  using (public.has_permission(organization_id, 'payments.view') and public.has_location_access(location_id));
create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (public.has_permission(organization_id, 'payments.view') and public.has_location_access(location_id));
create policy bill_events_select on public.bill_events
  for select to authenticated
  using (public.has_permission(organization_id, 'payments.view')
         and (public.has_permission(organization_id, 'payments.refund') or public.has_permission(organization_id, 'reports.view'))
         and public.has_location_access(location_id));

revoke all on public.bill_sets, public.bills, public.bill_items, public.payments, public.refunds,
  public.cash_sessions, public.bill_events, public.bill_balances from anon, authenticated;
grant select on public.bills, public.bill_items, public.cash_sessions, public.bill_events,
  public.bill_balances to authenticated;
-- request_hash / client_ref are internal on bill_sets
grant select (id, organization_id, location_id, order_id, split_kind, status, currency, tax_rate_bps, service_charge_bps,
              tax_on_service_charge, subtotal, discount_total, service_charge, tax, total, created_by, voided_at,
              voided_by, void_reason, created_at, updated_at)
  on public.bill_sets to authenticated;
-- request_hash is internal on the idempotent tables
grant select (id, organization_id, location_id, bill_id, method, status, amount, tendered, change_given, method_label,
              approval_code, cash_session_id, invoice_number, gateway_session_id, expires_at, client_ref, received_by, created_at)
  on public.payments to authenticated;
grant select (id, organization_id, location_id, payment_id, bill_id, amount, reason, kind, cash_session_id, client_ref,
              refunded_by, created_at)
  on public.refunds to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: private broadcast on location:{id}:payments (payments.view). Ids and statuses only.
-- The topic is matched EXACTLY (anchored pattern, canonical lowercase uuid), never by prefix, so it cannot be
-- confused with the orders topic location:{id}, and vice versa.
-- ---------------------------------------------------------------------------
create or replace function private.broadcast_payments(p_loc uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'location:' || p_loc::text || ':payments', true);
exception when others then
  null;
end;
$$;

create or replace function private.broadcast_bill_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_payments(new.location_id, 'bill.changed', jsonb_build_object(
    'billId', new.id, 'billSetId', new.bill_set_id, 'orderId', new.order_id,
    'paymentStatus', private.payment_status_of(new.total, private.bill_paid_total(new.id), private.bill_refunded_total(new.id)),
    'updatedAt', new.updated_at));
  return null;
end;
$$;
create trigger bills_broadcast after insert or update on public.bills
  for each row execute function private.broadcast_bill_change();

-- A void changes the set, not the bills: tell the bills of the set.
create or replace function private.broadcast_bill_set_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  for b in select x.id, x.total from public.bills x where x.bill_set_id = new.id loop
    perform private.broadcast_payments(new.location_id, 'bill.changed', jsonb_build_object(
      'billId', b.id, 'billSetId', new.id, 'orderId', new.order_id,
      'paymentStatus', private.payment_status_of(b.total, private.bill_paid_total(b.id), private.bill_refunded_total(b.id)),
      'updatedAt', new.updated_at));
  end loop;
  return null;
end;
$$;
create trigger bill_sets_broadcast after update of status on public.bill_sets
  for each row when (old.status is distinct from new.status)
  execute function private.broadcast_bill_set_change();

create or replace function private.broadcast_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bills%rowtype;
begin
  perform private.broadcast_payments(new.location_id, 'payment.changed', jsonb_build_object(
    'paymentId', new.id, 'billId', new.bill_id, 'updatedAt', new.created_at));
  select * into b from public.bills x where x.id = new.bill_id;
  if found then
    perform private.broadcast_payments(new.location_id, 'bill.changed', jsonb_build_object(
      'billId', b.id, 'billSetId', b.bill_set_id, 'orderId', b.order_id,
      'paymentStatus', private.payment_status_of(b.total, private.bill_paid_total(b.id), private.bill_refunded_total(b.id)),
      'updatedAt', new.created_at));
  end if;
  return null;
end;
$$;
create trigger payments_broadcast after insert on public.payments
  for each row execute function private.broadcast_payment_change();
create or replace function private.broadcast_refund_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bills%rowtype;
begin
  select * into b from public.bills x where x.id = new.bill_id;
  if found then
    perform private.broadcast_payments(new.location_id, 'bill.changed', jsonb_build_object(
      'billId', b.id, 'billSetId', b.bill_set_id, 'orderId', b.order_id,
      'paymentStatus', private.payment_status_of(b.total, private.bill_paid_total(b.id), private.bill_refunded_total(b.id)),
      'updatedAt', new.created_at));
  end if;
  return null;
end;
$$;
create trigger refunds_broadcast after insert on public.refunds
  for each row execute function private.broadcast_refund_change();

create or replace function private.broadcast_cash_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_payments(new.location_id, 'cash_session.changed', jsonb_build_object(
    'sessionId', new.id, 'status', new.status, 'updatedAt', coalesce(new.closed_at, new.opened_at)));
  return null;
end;
$$;
create trigger cash_sessions_broadcast after insert or update on public.cash_sessions
  for each row execute function private.broadcast_cash_session_change();

-- Who may join location:{id}:payments: members with access to that location and payments.view.
create or replace function public.can_receive_payments_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc uuid;
  v_org uuid;
begin
  if topic is null
     or topic !~ '^location:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:payments$' then
    return false;
  end if;
  v_loc := substr(topic, 10, 36)::uuid;
  select l.organization_id into v_org from public.locations l where l.id = v_loc;
  return v_org is not null
     and public.has_location_access(v_loc)
     and public.has_permission(v_org, 'payments.view');
end;
$$;
revoke execute on function public.can_receive_payments_topic(text) from public, anon, authenticated;
grant execute on function public.can_receive_payments_topic(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists payments_location_receive on realtime.messages';
    execute $p$create policy payments_location_receive on realtime.messages
      for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.can_receive_payments_topic((select realtime.topic())))$p$;
  end if;
end $$;
