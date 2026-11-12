-- MSC-T07 (M3 §7): bill RPCs, money helpers, order hooks. Contract: docs/contracts/bills.md.
-- Error contract (all P0001 unless noted; the message is the code): FORBIDDEN (42501), INVALID_INPUT (22023),
-- BILL_EXISTS (detail = bill set id), BILL_VOID, BILL_HAS_PAYMENTS, ORDER_NOT_BILLABLE, ORDER_CLOSED,
-- TAX_RATE_MISMATCH, INVALID_SPLIT, METHOD_NOT_ALLOWED, PAYMENT_EXCEEDS_OUTSTANDING (detail = outstanding),
-- TENDERED_TOO_LOW, NO_OPEN_SESSION, SESSION_ALREADY_OPEN, SESSION_CLOSED, REFUND_EXCEEDS_PAID, CLIENT_REF_CONFLICT.
-- Lock order (to avoid deadlocks with submit_order_round): tables -> orders -> bill_sets/bills -> cash_sessions.

-- ---------------------------------------------------------------------------
-- Money helpers: SQL mirrors of lib/money.ts (calculateBill, allocate, allocateByWeights). Golden vectors in pgTAP.
-- ---------------------------------------------------------------------------
-- amount * bps / 10000, half-up, exact on integers (amount <= 1e12 and bps <= 1e4 keep the product inside bigint).
create or replace function private.apply_bps(p_amount bigint, p_bps integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select ((p_amount * p_bps::bigint) + 5000) / 10000;
$$;

-- Service charge first, then tax on net + service (or on net only). total = net + service + tax.
create or replace function private.calculate_bill(
  p_subtotal bigint, p_service_bps integer, p_tax_bps integer, p_tax_on_service boolean,
  out service_charge bigint, out tax bigint, out total bigint)
language plpgsql
immutable
set search_path = ''
as $$
begin
  service_charge := private.apply_bps(p_subtotal, p_service_bps);
  tax := private.apply_bps(case when p_tax_on_service then p_subtotal + service_charge else p_subtotal end, p_tax_bps);
  total := p_subtotal + service_charge + tax;
end;
$$;

-- Equal shares that always sum to the amount; the remainder goes one unit each to the first parts.
create or replace function private.allocate(p_amount bigint, p_parts integer)
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select (p_amount / p_parts) + case when g <= (p_amount % p_parts) then 1 else 0 end
    from generate_series(1, p_parts) g order by g);
$$;

-- Largest-remainder allocation by weights; ties go to the lower index. Always sums to p_amount.
create or replace function private.allocate_by_weights(p_amount bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n     integer := coalesce(array_length(p_weights, 1), 0);
  v_total numeric;
  v_out   bigint[];
  v_left  bigint;
  r       record;
begin
  if v_n = 0 or p_amount < 0 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select sum(w) into v_total from unnest(p_weights) w;
  if v_total = 0 then
    if p_amount = 0 then return array_fill(0::bigint, array[v_n]); end if;
    return private.allocate(p_amount, v_n);
  end if;
  v_out := array(select floor(p_amount::numeric * u.w / v_total)::bigint
                 from unnest(p_weights) with ordinality as u(w, ord) order by u.ord);
  v_left := p_amount - (select sum(x) from unnest(v_out) x);
  if v_left > 0 then
    for r in
      select u.ord as i
      from unnest(p_weights) with ordinality as u(w, ord)
      order by ((p_amount::numeric * u.w) - floor(p_amount::numeric * u.w / v_total) * v_total) desc, u.ord asc
      limit v_left
    loop
      v_out[r.i] := v_out[r.i] + 1;
    end loop;
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function private.log_bill_event(
  p_org uuid, p_loc uuid, p_set uuid, p_bill uuid, p_payment uuid, p_refund uuid, p_session uuid,
  p_type text, p_payload jsonb, p_system boolean default false)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.bill_events (organization_id, location_id, bill_set_id, bill_id, payment_id, refund_id,
                                  cash_session_id, actor_id, event_type, payload)
  values (p_org, p_loc, p_set, p_bill, p_payment, p_refund, p_session,
          case when p_system then null else (select auth.uid()) end, p_type, coalesce(p_payload, '{}'::jsonb));
$$;

-- Net money held by a bill set: payments received minus refunds.
create or replace function private.bill_set_net_paid(p_set uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(p.amount) from public.payments p
                    join public.bills b on b.id = p.bill_id where b.bill_set_id = p_set and p.status = 'succeeded'), 0)
       - coalesce((select sum(r.amount) from public.refunds r
                    join public.bills b on b.id = r.bill_id where b.bill_set_id = p_set), 0);
$$;

-- Served AND every bill of the active set paid in full (gross: a refund never un-pays) -> completed, table cleaned.
-- Whichever of "served" and "fully paid" comes last triggers it. Returns true when the order was completed.
create or replace function private.complete_order_if_paid(p_order uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o     public.orders%rowtype;
  v_set uuid;
begin
  select * into o from public.orders x where x.id = p_order for update;
  if not found or o.status <> 'served' then return false; end if;
  select s.id into v_set from public.bill_sets s where s.order_id = p_order and s.status = 'active';
  if v_set is null then return false; end if;
  if exists (select 1 from public.bills b where b.bill_set_id = v_set and private.bill_paid_total(b.id) < b.total) then
    return false;
  end if;
  update public.orders x set status = 'completed', completed_at = now() where x.id = p_order;
  perform private.log_order_event(o.organization_id, o.location_id, p_order, null, null, 'order_status_changed',
    'served', 'completed', jsonb_build_object('reason', 'bills_paid'), true);
  perform private.free_table_if_idle(o.organization_id, o.location_id, p_order, o.table_id);
  return true;
end;
$$;

create or replace function private.bill_set_result(p_set uuid, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'billSetId', s.id, 'orderId', s.order_id, 'splitKind', s.split_kind, 'currency', s.currency, 'replayed', p_replayed,
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'billNumber', b.bill_number, 'shareNo', b.share_no,
                                                            'shareCount', b.share_count, 'total', b.total) order by b.share_no)
                       from public.bills b where b.bill_set_id = s.id), '[]'::jsonb))
  from public.bill_sets s where s.id = p_set;
$$;

-- ---------------------------------------------------------------------------
-- Order hooks (contract "Changes required to orders.md" 1-5)
-- 1. While an active bill set exists the order is locked: rounds, item voids and discount changes -> BILL_EXISTS.
-- ---------------------------------------------------------------------------
create or replace function private.bill_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set uuid;
begin
  select s.id into v_set from public.bill_sets s where s.order_id = new.order_id and s.status = 'active';
  if v_set is not null then
    raise exception 'BILL_EXISTS' using errcode = 'P0001', detail = v_set::text;
  end if;
  return new;
end;
$$;
create trigger order_rounds_bill_lock before insert on public.order_rounds
  for each row execute function private.bill_lock_guard();
create trigger order_items_bill_lock before update of status on public.order_items
  for each row when (old.status = 'active' and new.status = 'void') execute function private.bill_lock_guard();
create trigger order_discounts_bill_lock_ins before insert on public.order_discounts
  for each row execute function private.bill_lock_guard();
create trigger order_discounts_bill_lock_upd before update of removed_at on public.order_discounts
  for each row when (old.removed_at is null and new.removed_at is not null) execute function private.bill_lock_guard();

-- 2. cancel_order: an active set with no money held is voided in the same transaction; money held -> BILL_HAS_PAYMENTS.
create or replace function public.cancel_order(order_id uuid, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := cancel_order.order_id;
  v_reason text := btrim(cancel_order.reason);
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_set    public.bill_sets%rowtype;
begin
  select * into o from public.orders x where x.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'orders.void')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = v_order for update;
  select * into v_set from public.bill_sets s where s.order_id = v_order and s.status = 'active' for update;
  if found then
    if private.bill_set_net_paid(v_set.id) > 0 then
      raise exception 'BILL_HAS_PAYMENTS' using errcode = 'P0001';
    end if;
    update public.bill_sets s
       set status = 'void', voided_at = now(), voided_by = v_uid, void_reason = left('Order cancelled: ' || v_reason, 200)
     where s.id = v_set.id;
    perform private.log_bill_event(o.organization_id, o.location_id, v_set.id, null, null, null, null, 'bill_voided',
      jsonb_build_object('reason', 'order_cancelled'));
    perform private.write_audit(o.organization_id, v_uid, 'bill.voided', 'bill_set', v_set.id::text,
      jsonb_build_object('location_id', o.location_id, 'order_id', v_order, 'reason', 'order_cancelled'));
  end if;
  perform private.cancel_order_internal(v_order, v_reason, v_uid);
  return jsonb_build_object('orderId', v_order);
end;
$$;

-- 3. set_order_status(..., 'served') runs the completion check (paid first, served later).
create or replace function public.set_order_status(order_id uuid, to_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order uuid := set_order_status.order_id;
  v_to    text := set_order_status.to_status;
  o       public.orders%rowtype;
  v_done  boolean := false;
begin
  select * into o from public.orders x where x.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'orders.create')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = v_order for update;
  if v_to is null or v_to not in ('accepted', 'served') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if o.status = v_to then
    return jsonb_build_object('orderId', v_order, 'status', o.status);
  end if;
  if not private.order_transition_ok(o.status, v_to) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = o.status || ' -> ' || v_to;
  end if;
  update public.orders x
     set status = v_to, served_at = case when v_to = 'served' then now() else x.served_at end
   where x.id = v_order;
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'order_status_changed',
    o.status, v_to, '{}'::jsonb);
  if v_to = 'served' then
    v_done := private.complete_order_if_paid(v_order);
  end if;
  return jsonb_build_object('orderId', v_order, 'status', case when v_done then 'completed' else v_to end);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_bills
-- ---------------------------------------------------------------------------
create or replace function public.create_bills(
  order_id     uuid,
  client_ref   uuid,
  split_kind   text default 'none',
  split_count  integer default null,
  assignments  jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order   uuid := create_bills.order_id;
  v_ref     uuid := create_bills.client_ref;
  v_kind    text := create_bills.split_kind;
  v_count   integer := create_bills.split_count;
  v_assign  jsonb := create_bills.assignments;
  v_uid     uuid := (select auth.uid());

  o         public.orders%rowtype;
  v_tz      text;
  v_sc_bps  integer;
  v_tos     boolean;
  v_date    date;
  v_hash    text;
  v_canon   text;
  v_set_id  uuid;
  v_ex      public.bill_sets%rowtype;

  it_id     uuid[];
  it_line   bigint[];
  n_items   integer;
  v_rates   integer;
  v_rate    integer;
  v_sub     bigint;
  v_disc    bigint;
  v_net     bigint;

  v_n       integer;
  g_sub     bigint[] := '{}';
  g_disc    bigint[];
  g_sc      bigint[] := '{}';
  g_tax     bigint[] := '{}';
  g_tot     bigint[] := '{}';
  c         record;
  v_set_sc  bigint; v_set_tax bigint; v_set_total bigint;
  a_sub     bigint[]; a_disc bigint[]; a_sc bigint[]; a_tax bigint[];

  map_ids   uuid[] := '{}';
  map_grp   integer[] := '{}';
  grp       jsonb;
  el        jsonb;
  gi        integer;
  x         uuid;
  v_idx     integer;
  v_bill_ids uuid[] := '{}';
  v_bill_id uuid;
  v_num     integer;
  i         integer;
begin
  -- authorize (unknown order and missing permission look the same)
  select * into o from public.orders x where x.id = v_order;
  if not found
     or not public.has_location_access(o.location_id)
     or not (public.has_permission(o.organization_id, 'payments.take') or public.has_permission(o.organization_id, 'bills.print')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_ref is null or v_kind is null or v_kind not in ('none', 'equal', 'by_item') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if (v_kind = 'none' and (v_count is not null or v_assign is not null))
     or (v_kind = 'equal' and (v_count is null or v_count not between 2 and 20 or v_assign is not null))
     or (v_kind = 'by_item' and (v_count is not null or v_assign is null or jsonb_typeof(v_assign) <> 'array'
                                 or jsonb_array_length(v_assign) not between 2 and 20)) then
    raise exception 'INVALID_SPLIT' using errcode = 'P0001';
  end if;

  -- canonical request: fixed key order, ids sorted inside each group (group order is the bill order)
  if v_kind = 'by_item' then
    begin
      v_canon := (select string_agg(
          '[' || coalesce((select string_agg(to_json(y::uuid)::text, ',' order by y::uuid)
                           from jsonb_array_elements_text(e.g) y), '') || ']', ',' order by e.ord)
        from jsonb_array_elements(v_assign) with ordinality as e(g, ord));
    exception when others then
      raise exception 'INVALID_SPLIT' using errcode = 'P0001';
    end;
  end if;
  v_hash := encode(extensions.digest(format('{"order_id":%s,"split_kind":%s,"split_count":%s,"assignments":%s}',
    to_json(v_order)::text, to_json(v_kind)::text, coalesce(v_count::text, 'null'),
    case when v_kind = 'by_item' then '[' || coalesce(v_canon, '') || ']' else 'null' end), 'sha256'), 'hex');

  -- idempotency: serialise on (org, client_ref)
  perform pg_advisory_xact_lock(hashtextextended('bill_set:' || o.organization_id::text || ':' || v_ref::text, 0));
  select * into v_ex from public.bill_sets s where s.organization_id = o.organization_id and s.client_ref = v_ref;
  if found then
    if v_ex.request_hash <> v_hash then
      raise exception 'CLIENT_REF_CONFLICT' using errcode = 'P0001';
    end if;
    return private.bill_set_result(v_ex.id, true);
  end if;

  -- lock the order, then check it can be billed and has no active set
  select * into o from public.orders x where x.id = v_order for update;
  if o.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_NOT_BILLABLE' using errcode = 'P0001';
  end if;
  select s.id into v_set_id from public.bill_sets s where s.order_id = v_order and s.status = 'active';
  if v_set_id is not null then
    raise exception 'BILL_EXISTS' using errcode = 'P0001', detail = v_set_id::text;
  end if;

  select coalesce(array_agg(i2.id order by i2.created_at, i2.id), '{}'), coalesce(array_agg(i2.line_total order by i2.created_at, i2.id), '{}'),
         count(distinct i2.tax_rate_bps), min(i2.tax_rate_bps)
    into it_id, it_line, v_rates, v_rate
  from public.order_items i2 where i2.order_id = v_order and i2.status = 'active';
  n_items := coalesce(cardinality(it_id), 0);
  if n_items = 0 then
    raise exception 'ORDER_NOT_BILLABLE' using errcode = 'P0001';
  end if;
  if v_rates > 1 then
    raise exception 'TAX_RATE_MISMATCH' using errcode = 'P0001';
  end if;

  select l.timezone, l.service_charge_bps, l.tax_on_service_charge into v_tz, v_sc_bps, v_tos
  from public.locations l where l.id = o.location_id;
  v_date := (now() at time zone v_tz)::date;
  select sum(l2) into v_sub from unnest(it_line) l2;
  v_disc := o.discount_total;
  if v_disc > v_sub then
    raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL' using errcode = 'P0001';
  end if;
  v_net := v_sub - v_disc;

  -- totals per bill (g_*) and for the set
  if v_kind = 'none' then
    v_n := 1;
    select cb.service_charge, cb.tax, cb.total into v_set_sc, v_set_tax, v_set_total
    from private.calculate_bill(v_net, v_sc_bps, v_rate, v_tos) cb;
    a_sub := array[v_sub]; a_disc := array[v_disc]; a_sc := array[v_set_sc]; a_tax := array[v_set_tax];
  elsif v_kind = 'equal' then
    v_n := v_count;
    select cb.service_charge, cb.tax, cb.total into v_set_sc, v_set_tax, v_set_total
    from private.calculate_bill(v_net, v_sc_bps, v_rate, v_tos) cb;
    -- every component allocated; the share total is the derived sum (all components stay >= 0)
    a_sub := private.allocate(v_sub, v_n);  a_disc := private.allocate(v_disc, v_n);
    a_sc  := private.allocate(v_set_sc, v_n); a_tax  := private.allocate(v_set_tax, v_n);
  else
    v_n := jsonb_array_length(v_assign);
    begin
      gi := 0;
      for grp in select e.g from jsonb_array_elements(v_assign) with ordinality as e(g, ord) order by e.ord loop
        gi := gi + 1;
        if jsonb_typeof(grp) <> 'array' or jsonb_array_length(grp) = 0 then
          raise exception 'INVALID_SPLIT' using errcode = 'P0001';
        end if;
        for el in select * from jsonb_array_elements(grp) loop
          if jsonb_typeof(el) <> 'string' then
            raise exception 'INVALID_SPLIT' using errcode = 'P0001';
          end if;
          map_ids := map_ids || (el #>> '{}')::uuid;
          map_grp := map_grp || gi;
        end loop;
      end loop;
    exception when invalid_text_representation then
      raise exception 'INVALID_SPLIT' using errcode = 'P0001';
    end;
    -- every active item exactly once, nothing foreign
    if cardinality(map_ids) <> n_items
       or (select count(distinct m) from unnest(map_ids) m) <> n_items
       or exists (select 1 from unnest(map_ids) m where m <> all (it_id)) then
      raise exception 'INVALID_SPLIT' using errcode = 'P0001';
    end if;
    g_sub := array(select coalesce(sum(it_line[array_position(it_id, m.id)]), 0)::bigint
                   from generate_series(1, v_n) gs
                   left join unnest(map_ids, map_grp) as m(id, g) on m.g = gs group by gs order by gs);
    g_disc := private.allocate_by_weights(v_disc, g_sub);
    a_sub := g_sub; a_disc := g_disc; a_sc := '{}'; a_tax := '{}'; g_tot := '{}';
    v_set_sc := 0; v_set_tax := 0; v_set_total := 0;
    for i in 1 .. v_n loop
      select cb.service_charge, cb.tax, cb.total into c from private.calculate_bill(g_sub[i] - g_disc[i], v_sc_bps, v_rate, v_tos) cb;
      a_sc := a_sc || c.service_charge; a_tax := a_tax || c.tax;
      v_set_sc := v_set_sc + c.service_charge; v_set_tax := v_set_tax + c.tax;
    end loop;
    v_set_total := (v_sub - v_disc) + v_set_sc + v_set_tax;
  end if;

  insert into public.bill_sets (organization_id, location_id, order_id, split_kind, currency, tax_rate_bps,
      service_charge_bps, tax_on_service_charge, subtotal, discount_total, service_charge, tax, total,
      client_ref, request_hash, created_by)
  values (o.organization_id, o.location_id, v_order, v_kind, o.currency, v_rate, v_sc_bps, v_tos, v_sub, v_disc,
          v_set_sc, v_set_tax, v_set_total, v_ref, v_hash, v_uid)
  returning id into v_set_id;

  for i in 1 .. v_n loop
    v_num := private.next_counter(o.location_id, v_date, 'bill');
    insert into public.bills (organization_id, location_id, bill_set_id, order_id, bill_number, business_date,
        share_no, share_count, subtotal, discount, service_charge, tax, total)
    values (o.organization_id, o.location_id, v_set_id, v_order, v_num, v_date, i, v_n,
            a_sub[i], a_disc[i], a_sc[i], a_tax[i], a_sub[i] - a_disc[i] + a_sc[i] + a_tax[i])
    returning id into v_bill_id;
    v_bill_ids := v_bill_ids || v_bill_id;
  end loop;

  insert into public.bill_items (organization_id, location_id, bill_set_id, bill_id, order_item_id, item_name,
      variant_name, modifiers_text, quantity, unit_price, modifiers_total, line_total, tax_rate_bps)
  select o.organization_id, o.location_id, v_set_id,
         case v_kind when 'none' then v_bill_ids[1]
                     when 'by_item' then v_bill_ids[(select m.g from unnest(map_ids, map_grp) as m(id, g) where m.id = oi.id)]
                     else null end,
         oi.id, oi.item_name, oi.variant_name,
         (select string_agg(mm.name, ', ' order by mm.name) from public.order_item_modifiers mm where mm.order_item_id = oi.id),
         oi.quantity, oi.unit_price, oi.modifiers_total, oi.line_total, oi.tax_rate_bps
  from public.order_items oi where oi.order_id = v_order and oi.status = 'active';

  perform private.log_bill_event(o.organization_id, o.location_id, v_set_id, null, null, null, null, 'bill_created',
    jsonb_build_object('order_id', v_order, 'split_kind', v_kind, 'bills', v_n, 'total', v_set_total));

  -- a set that totals 0 is already paid
  perform private.complete_order_if_paid(v_order);
  return private.bill_set_result(v_set_id, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- void_bill_set
-- ---------------------------------------------------------------------------
create or replace function public.void_bill_set(bill_set_id uuid, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_set    uuid := void_bill_set.bill_set_id;
  v_reason text := btrim(void_bill_set.reason);
  v_uid    uuid := (select auth.uid());
  s        public.bill_sets%rowtype;
  o        public.orders%rowtype;
  v_hist   boolean;
begin
  select * into s from public.bill_sets x where x.id = v_set;
  if not found or not public.has_location_access(s.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_hist := exists (select 1 from public.payments p join public.bills b on b.id = p.bill_id where b.bill_set_id = v_set);
  if not public.has_permission(s.organization_id, case when v_hist then 'payments.refund' else 'payments.take' end) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = s.order_id for update;
  select * into s from public.bill_sets x where x.id = v_set for update;
  if s.status <> 'active' then
    raise exception 'BILL_VOID' using errcode = 'P0001';
  end if;
  if o.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if private.bill_set_net_paid(v_set) > 0 then
    raise exception 'BILL_HAS_PAYMENTS' using errcode = 'P0001';
  end if;
  update public.bill_sets x set status = 'void', voided_at = now(), voided_by = v_uid, void_reason = v_reason where x.id = v_set;
  perform private.log_bill_event(s.organization_id, s.location_id, v_set, null, null, null, null, 'bill_voided',
    jsonb_build_object('reason', v_reason));
  perform private.write_audit(s.organization_id, v_uid, 'bill.voided', 'bill_set', v_set::text,
    jsonb_build_object('location_id', s.location_id, 'order_id', s.order_id, 'reason', v_reason));
  return jsonb_build_object('billSetId', v_set, 'status', 'void');
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  bill_id        uuid,
  method         text,
  amount         bigint,
  client_ref     uuid,
  tendered       bigint default null,
  method_label   text default null,
  approval_code  text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bill    uuid := record_payment.bill_id;
  v_method  text := record_payment.method;
  v_amount  bigint := record_payment.amount;
  v_ref     uuid := record_payment.client_ref;
  v_tend    bigint := record_payment.tendered;
  v_label   text := nullif(btrim(record_payment.method_label), '');
  v_appr    text := nullif(btrim(record_payment.approval_code), '');
  v_uid     uuid := (select auth.uid());
  b         public.bills%rowtype;
  s         public.bill_sets%rowtype;
  o         public.orders%rowtype;
  v_hash    text;
  v_ex      public.payments%rowtype;
  v_paid    bigint;
  v_out     bigint;
  v_session uuid;
  v_change  bigint;
  v_pid     uuid;
  v_status  text;
  v_done    boolean := false;
begin
  select * into b from public.bills x where x.id = v_bill;
  if not found
     or not public.has_permission(b.organization_id, 'payments.take')
     or not public.has_location_access(b.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_ref is null or v_amount is null or v_amount <= 0 or v_method is null
     or (v_label is not null and char_length(v_label) not between 2 and 40) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'edc_card', 'other') then
    raise exception 'METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if (v_method = 'other' and v_label is null) or (v_method <> 'other' and v_label is not null)
     or (v_appr is not null and (v_method <> 'edc_card' or v_appr !~ '^[A-Za-z0-9]{4,12}$'))
     or (v_method <> 'cash' and v_tend is not null) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(format('{"bill_id":%s,"method":%s,"amount":%s,"tendered":%s,"method_label":%s,"approval_code":%s}',
    to_json(v_bill)::text, to_json(v_method)::text, v_amount, coalesce(v_tend::text, 'null'),
    coalesce(to_json(v_label)::text, 'null'), coalesce(to_json(v_appr)::text, 'null')), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('payment:' || b.organization_id::text || ':' || v_ref::text, 0));
  select * into v_ex from public.payments p where p.organization_id = b.organization_id and p.client_ref = v_ref;
  if found then
    if v_ex.request_hash <> v_hash then
      raise exception 'CLIENT_REF_CONFLICT' using errcode = 'P0001';
    end if;
    v_paid := private.bill_paid_total(v_bill);
    return jsonb_build_object('paymentId', v_ex.id, 'billId', v_bill,
      'paymentStatus', private.payment_status_of(b.total, v_paid, private.bill_refunded_total(v_bill)),
      'paidTotal', v_paid, 'outstanding', greatest(b.total - v_paid, 0), 'changeGiven', v_ex.change_given,
      'orderCompleted', (select x.status = 'completed' from public.orders x where x.id = b.order_id), 'replayed', true);
  end if;

  -- lock order -> bill (-> session)
  select * into o from public.orders x where x.id = b.order_id for update;
  select * into b from public.bills x where x.id = v_bill for update;
  select * into s from public.bill_sets x where x.id = b.bill_set_id;
  if s.status <> 'active' then
    raise exception 'BILL_VOID' using errcode = 'P0001';
  end if;

  v_paid := private.bill_paid_total(v_bill);
  v_out := greatest(b.total - v_paid, 0);
  if v_amount > v_out then
    raise exception 'PAYMENT_EXCEEDS_OUTSTANDING' using errcode = 'P0001', detail = v_out::text;
  end if;

  if v_method = 'cash' then
    if v_tend is null or v_tend < v_amount then
      raise exception 'TENDERED_TOO_LOW' using errcode = 'P0001';
    end if;
    select cs.id into v_session from public.cash_sessions cs
     where cs.location_id = b.location_id and cs.status = 'open' for share;
    if v_session is null then
      raise exception 'NO_OPEN_SESSION' using errcode = 'P0001';
    end if;
    v_change := v_tend - v_amount;
  end if;

  insert into public.payments (organization_id, location_id, bill_id, method, amount, tendered, change_given,
      method_label, approval_code, cash_session_id, client_ref, request_hash, received_by)
  values (b.organization_id, b.location_id, v_bill, v_method, v_amount, case when v_method = 'cash' then v_tend end,
          v_change, v_label, v_appr, v_session, v_ref, v_hash, v_uid)
  returning id into v_pid;
  perform private.log_bill_event(b.organization_id, b.location_id, b.bill_set_id, v_bill, v_pid, null, v_session,
    'payment_recorded', jsonb_build_object('method', v_method, 'amount', v_amount));

  v_paid := v_paid + v_amount;
  if v_paid >= b.total then
    perform private.log_bill_event(b.organization_id, b.location_id, b.bill_set_id, v_bill, null, null, null,
      'bill_paid', '{}'::jsonb, true);
    v_done := private.complete_order_if_paid(b.order_id);
  end if;
  v_status := private.payment_status_of(b.total, v_paid, private.bill_refunded_total(v_bill));
  return jsonb_build_object('paymentId', v_pid, 'billId', v_bill, 'paymentStatus', v_status, 'paidTotal', v_paid,
    'outstanding', greatest(b.total - v_paid, 0), 'changeGiven', v_change, 'orderCompleted', v_done, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_refund (recorded only; gateway refunds are M5)
-- ---------------------------------------------------------------------------
create or replace function public.record_refund(payment_id uuid, amount bigint, reason text, client_ref uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pay     uuid := record_refund.payment_id;
  v_amount  bigint := record_refund.amount;
  v_reason  text := btrim(record_refund.reason);
  v_ref     uuid := record_refund.client_ref;
  v_uid     uuid := (select auth.uid());
  p         public.payments%rowtype;
  b         public.bills%rowtype;
  v_hash    text;
  v_ex      public.refunds%rowtype;
  v_prev    bigint;
  v_session uuid;
  v_rid     uuid;
  v_refunded bigint;
begin
  select * into p from public.payments x where x.id = v_pay;
  if not found
     or not public.has_permission(p.organization_id, 'payments.refund')
     or not public.has_location_access(p.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_ref is null or v_amount is null or v_amount <= 0 or v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(format('{"payment_id":%s,"amount":%s,"reason":%s}',
    to_json(v_pay)::text, v_amount, to_json(v_reason)::text), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('refund:' || p.organization_id::text || ':' || v_ref::text, 0));
  select * into v_ex from public.refunds r where r.organization_id = p.organization_id and r.client_ref = v_ref;
  if found then
    if v_ex.request_hash <> v_hash then
      raise exception 'CLIENT_REF_CONFLICT' using errcode = 'P0001';
    end if;
    select * into b from public.bills x where x.id = v_ex.bill_id;
    v_refunded := private.bill_refunded_total(b.id);
    return jsonb_build_object('refundId', v_ex.id, 'billId', b.id,
      'paymentStatus', private.payment_status_of(b.total, private.bill_paid_total(b.id), v_refunded),
      'refundedTotal', v_refunded, 'replayed', true);
  end if;

  select * into b from public.bills x where x.id = p.bill_id;
  perform 1 from public.orders x where x.id = b.order_id for update;
  select * into b from public.bills x where x.id = p.bill_id for update;

  select coalesce(sum(r.amount), 0) into v_prev from public.refunds r where r.payment_id = v_pay;
  if v_amount > p.amount - v_prev then
    raise exception 'REFUND_EXCEEDS_PAID' using errcode = 'P0001';
  end if;
  if p.method = 'cash' then
    select cs.id into v_session from public.cash_sessions cs
     where cs.location_id = p.location_id and cs.status = 'open' for share;
    if v_session is null then
      raise exception 'NO_OPEN_SESSION' using errcode = 'P0001';
    end if;
  end if;

  insert into public.refunds (organization_id, location_id, payment_id, bill_id, amount, reason, cash_session_id,
      client_ref, request_hash, refunded_by)
  values (p.organization_id, p.location_id, v_pay, p.bill_id, v_amount, v_reason, v_session, v_ref, v_hash, v_uid)
  returning id into v_rid;
  perform private.log_bill_event(p.organization_id, p.location_id, b.bill_set_id, b.id, v_pay, v_rid, v_session,
    'refund_recorded', jsonb_build_object('method', p.method, 'amount', v_amount, 'reason', v_reason));
  perform private.write_audit(p.organization_id, v_uid, 'refund.recorded', 'refund', v_rid::text,
    jsonb_build_object('location_id', p.location_id, 'bill_id', b.id, 'payment_id', v_pay, 'method', p.method,
                       'amount', v_amount, 'reason', v_reason));
  v_refunded := private.bill_refunded_total(b.id);
  return jsonb_build_object('refundId', v_rid, 'billId', b.id,
    'paymentStatus', private.payment_status_of(b.total, private.bill_paid_total(b.id), v_refunded),
    'refundedTotal', v_refunded, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- cash sessions
-- ---------------------------------------------------------------------------
create or replace function public.open_cash_session(location_id uuid, opening_float bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_loc   uuid := open_cash_session.location_id;
  v_float bigint := open_cash_session.opening_float;
  v_uid   uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  select l.organization_id into v_org from public.locations l where l.id = v_loc and l.is_active;
  if v_org is null
     or not public.has_permission(v_org, 'payments.take')
     or not public.has_location_access(v_loc) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_float is null or v_float not between 0 and 1000000000000 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  begin
    insert into public.cash_sessions (organization_id, location_id, opening_float, opened_by)
    values (v_org, v_loc, v_float, v_uid) returning id into v_id;
  exception when unique_violation then
    raise exception 'SESSION_ALREADY_OPEN' using errcode = 'P0001';
  end;
  perform private.log_bill_event(v_org, v_loc, null, null, null, null, v_id, 'cash_session_opened',
    jsonb_build_object('opening_float', v_float));
  return jsonb_build_object('sessionId', v_id, 'status', 'open', 'openingFloat', v_float);
end;
$$;

create or replace function public.close_cash_session(session_id uuid, counted_cash bigint, note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      uuid := close_cash_session.session_id;
  v_counted bigint := close_cash_session.counted_cash;
  v_note    text := nullif(btrim(close_cash_session.note), '');
  v_uid     uuid := (select auth.uid());
  cs        public.cash_sessions%rowtype;
  v_exp     bigint;
  v_var     bigint;
begin
  select * into cs from public.cash_sessions x where x.id = v_id;
  if not found
     or not public.has_permission(cs.organization_id, 'payments.take')
     or not public.has_location_access(cs.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_counted is null or v_counted < 0 or v_counted > 1000000000000 or (v_note is not null and char_length(v_note) > 200) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into cs from public.cash_sessions x where x.id = v_id for update;
  if cs.status = 'closed' then
    if cs.counted_cash = v_counted then
      return jsonb_build_object('sessionId', v_id, 'status', 'closed', 'expectedCash', cs.expected_cash,
        'countedCash', cs.counted_cash, 'variance', cs.variance, 'replayed', true);
    end if;
    raise exception 'SESSION_CLOSED' using errcode = 'P0001';
  end if;

  v_exp := cs.opening_float
         + coalesce((select sum(p.amount) from public.payments p where p.cash_session_id = v_id and p.method = 'cash' and p.status = 'succeeded'), 0)
         - coalesce((select sum(r.amount) from public.refunds r where r.cash_session_id = v_id), 0);
  v_var := v_counted - v_exp;
  if v_var <> 0 and (v_note is null or char_length(v_note) < 3) then
    raise exception 'INVALID_INPUT' using errcode = '22023', detail = 'note';
  end if;
  update public.cash_sessions x
     set status = 'closed', closed_by = v_uid, closed_at = now(), expected_cash = v_exp, counted_cash = v_counted,
         variance = v_var, close_note = v_note
   where x.id = v_id;
  perform private.log_bill_event(cs.organization_id, cs.location_id, null, null, null, null, v_id, 'cash_session_closed',
    jsonb_build_object('expected_cash', v_exp, 'counted_cash', v_counted, 'variance', v_var));
  if v_var <> 0 then
    perform private.write_audit(cs.organization_id, v_uid, 'cash_session.variance', 'cash_session', v_id::text,
      jsonb_build_object('location_id', cs.location_id, 'expected_cash', v_exp, 'counted_cash', v_counted,
                         'variance', v_var, 'note', v_note));
  end if;
  return jsonb_build_object('sessionId', v_id, 'status', 'closed', 'expectedCash', v_exp, 'countedCash', v_counted,
    'variance', v_var, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_bill_print
-- ---------------------------------------------------------------------------
create or replace function public.record_bill_print(bill_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bill uuid := record_bill_print.bill_id;
  b      public.bills%rowtype;
  v_prev integer;
begin
  select * into b from public.bills x where x.id = v_bill;
  if not found
     or not public.has_permission(b.organization_id, 'bills.print')
     or not public.has_location_access(b.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select x.print_count into v_prev from public.bills x where x.id = v_bill for update;
  update public.bills x
     set print_count = x.print_count + 1, last_printed_at = now(), last_printed_by = (select auth.uid())
   where x.id = v_bill;
  perform private.log_bill_event(b.organization_id, b.location_id, b.bill_set_id, v_bill, null, null, null, 'bill_printed',
    jsonb_build_object('print_count', v_prev + 1));
  return jsonb_build_object('printCount', v_prev + 1, 'duplicate', v_prev >= 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: authenticated only (RPCs re-check every permission themselves).
-- ---------------------------------------------------------------------------
revoke execute on function
  public.create_bills(uuid, uuid, text, integer, jsonb), public.void_bill_set(uuid, text),
  public.record_payment(uuid, text, bigint, uuid, bigint, text, text), public.record_refund(uuid, bigint, text, uuid),
  public.open_cash_session(uuid, bigint), public.close_cash_session(uuid, bigint, text), public.record_bill_print(uuid),
  public.cancel_order(uuid, text), public.set_order_status(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.create_bills(uuid, uuid, text, integer, jsonb), public.void_bill_set(uuid, text),
  public.record_payment(uuid, text, bigint, uuid, bigint, text, text), public.record_refund(uuid, bigint, text, uuid),
  public.open_cash_session(uuid, bigint), public.close_cash_session(uuid, bigint, text), public.record_bill_print(uuid),
  public.cancel_order(uuid, text), public.set_order_status(uuid, text)
  to authenticated;
