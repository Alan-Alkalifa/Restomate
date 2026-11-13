-- MSC-T04 (M3 §7): order RPCs, derived statuses, Realtime. Contract: docs/contracts/orders.md.
-- Error contract (all P0001 unless noted; the message is the code): FORBIDDEN (42501), INVALID_INPUT (22023),
-- ITEM_UNAVAILABLE (detail = JSON array of item ids), MODIFIER_INVALID (detail = group id), VARIANT_REQUIRED,
-- TABLE_NOT_FOUND, ORDER_CLOSED, ALREADY_VOID, ALREADY_REMOVED, INVALID_TRANSITION, DISCOUNT_EXCEEDS_SUBTOTAL,
-- CLIENT_REF_CONFLICT, PLAN_LIMIT:max_orders_per_month.

-- ---------------------------------------------------------------------------
-- Helpers (private: not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function private.next_counter(p_loc uuid, p_date date, p_kind text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.order_counters as c (location_id, business_date, kind, last_value)
  values (p_loc, p_date, p_kind, 1)
  on conflict (location_id, business_date, kind) do update set last_value = c.last_value + 1
  returning c.last_value;
$$;

create or replace function private.log_order_event(
  p_org uuid, p_loc uuid, p_order uuid, p_item uuid, p_ticket uuid, p_type text,
  p_from text, p_to text, p_payload jsonb, p_system boolean default false)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.order_events (organization_id, location_id, order_id, order_item_id, ticket_id, actor_id,
                                   event_type, from_status, to_status, payload)
  values (p_org, p_loc, p_order, p_item, p_ticket, case when p_system then null else (select auth.uid()) end,
          p_type, p_from, p_to, coalesce(p_payload, '{}'::jsonb));
$$;

-- subtotal = active lines, discount_total = active discounts. Raises before touching anything if it cannot hold.
create or replace function private.recompute_order_totals(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sub  bigint;
  v_disc bigint;
begin
  select coalesce(sum(i.line_total) filter (where i.status = 'active'), 0) into v_sub
  from public.order_items i where i.order_id = p_order;
  select coalesce(sum(d.amount) filter (where d.removed_at is null), 0) into v_disc
  from public.order_discounts d where d.order_id = p_order;
  if v_disc > v_sub then
    raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL' using errcode = 'P0001';
  end if;
  update public.orders o set subtotal = v_sub, discount_total = v_disc where o.id = p_order;
end;
$$;

create or replace function private.free_table_if_idle(p_org uuid, p_loc uuid, p_order uuid, p_table uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  if p_table is null then return; end if;
  update public.tables t set status = 'needs_cleaning' where t.id = p_table and t.status = 'occupied';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform private.log_order_event(p_org, p_loc, p_order, null, null, 'table_status_changed',
      'occupied', 'needs_cleaning', jsonb_build_object('table_id', p_table), true);
  end if;
end;
$$;

-- Derived order status from its tickets (contract: "No live tickets"). Walks one state at a time, one system
-- event per step. p_addon lets a `ready` order go back to `preparing` when a new round arrived.
create or replace function private.derive_order_status(p_order uuid, p_addon boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o         public.orders%rowtype;
  n_live    int;
  n_new     int;
  n_prog    int;
  v_target  text;
  v_rank    constant text[] := array['accepted', 'preparing', 'ready'];
  v_cur     int;
  v_tgt     int;
  v_next    text;
begin
  select * into o from public.orders x where x.id = p_order for update;
  if not found or o.status not in ('accepted', 'preparing', 'ready') then return; end if;

  select count(*), count(*) filter (where t.status = 'new'), count(*) filter (where t.status = 'in_progress')
    into n_live, n_new, n_prog
  from public.kitchen_tickets t
  where t.order_id = p_order and t.status in ('new', 'in_progress', 'ready')
    and exists (select 1 from public.kitchen_ticket_items i where i.ticket_id = t.id and i.status <> 'void');

  v_target := case
    when n_live = 0 then 'ready'
    when n_new = 0 and n_prog = 0 then 'ready'
    when n_prog > 0 or n_live > n_new then 'preparing'
    else 'accepted'
  end;
  v_cur := array_position(v_rank, o.status);
  v_tgt := array_position(v_rank, v_target);

  if v_tgt > v_cur then
    while v_cur < v_tgt loop
      v_next := v_rank[v_cur + 1];
      update public.orders x set status = v_next where x.id = p_order;
      perform private.log_order_event(o.organization_id, o.location_id, p_order, null, null,
        'order_status_changed', v_rank[v_cur], v_next, '{}'::jsonb, true);
      v_cur := v_cur + 1;
    end loop;
  elsif v_tgt < v_cur and o.status = 'ready' and p_addon then
    perform set_config('app.orders_addon', '1', true);
    update public.orders x set status = 'preparing' where x.id = p_order;
    perform set_config('app.orders_addon', '', true);
    perform private.log_order_event(o.organization_id, o.location_id, p_order, null, null,
      'order_status_changed', 'ready', 'preparing', jsonb_build_object('reason', 'add_on_round'), true);
  end if;
end;
$$;

-- Cancels an order that is not yet served. Voids every active line, bumps open tickets (system), frees the table.
create or replace function private.cancel_order_internal(p_order uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders x where x.id = p_order for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if o.status in ('served', 'completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;

  update public.order_items i
     set status = 'void', voided_at = now(), voided_by = p_actor, void_reason = p_reason
   where i.order_id = p_order and i.status = 'active';
  update public.kitchen_ticket_items ti set status = 'void'
   where ti.status <> 'void' and ti.ticket_id in (select t.id from public.kitchen_tickets t where t.order_id = p_order);
  perform set_config('app.orders_system', '1', true);
  update public.kitchen_tickets t set status = 'bumped', bumped_at = coalesce(t.bumped_at, now())
   where t.order_id = p_order and t.status <> 'bumped';
  perform set_config('app.orders_system', '', true);
  update public.order_discounts d
     set removed_at = now(), removed_by = p_actor, remove_reason = 'Order cancelled'
   where d.order_id = p_order and d.removed_at is null;

  update public.orders x
     set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now(), subtotal = 0, discount_total = 0
   where x.id = p_order;
  perform private.log_order_event(o.organization_id, o.location_id, p_order, null, null, 'order_cancelled',
    o.status, 'cancelled', jsonb_build_object('reason', p_reason));
  perform private.write_audit(o.organization_id, p_actor, 'order.cancelled', 'order', p_order::text,
    jsonb_build_object('location_id', o.location_id, 'order_number', o.order_number, 'reason', p_reason));
  perform private.free_table_if_idle(o.organization_id, o.location_id, p_order, o.table_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_order_round
-- ---------------------------------------------------------------------------
create or replace function public.submit_order_round(
  location_id   uuid,
  table_id      uuid,
  channel       text,
  lines         jsonb,
  client_ref    uuid,
  customer_name text default null,
  guest_count   integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_loc     uuid := submit_order_round.location_id;
  v_table   uuid := submit_order_round.table_id;
  v_channel text := submit_order_round.channel;
  v_lines   jsonb := submit_order_round.lines;
  v_ref     uuid := submit_order_round.client_ref;
  v_cname   text := nullif(btrim(submit_order_round.customer_name), '');
  v_gc      integer := submit_order_round.guest_count;
  v_uid     uuid := (select auth.uid());

  v_org     uuid;
  v_tz      text;
  v_cur     text;
  v_tax     integer;
  v_date    date;

  n         integer;
  v_el      jsonb;
  v_key     text;
  i         integer;
  j         integer;
  l_item    uuid[] := '{}';
  l_var     uuid[] := '{}';
  l_mods    uuid[][] := '{}';
  l_qty     integer[] := '{}';
  l_note    text[] := '{}';
  l_modlist uuid[];
  v_canon   text;
  v_hash    text;
  v_parts   text[] := '{}';
  v_modtxt  text;

  v_round   public.order_rounds%rowtype;
  v_order   public.orders%rowtype;
  v_tstatus text;
  v_new     boolean := false;

  v_bad     uuid[] := '{}';
  p_name    text; p_base bigint; p_over bigint; p_station uuid; p_ok boolean; p_cat boolean;
  p_vcount  integer; p_vname text; p_vdelta bigint; p_vok boolean;
  p_found   integer;
  g         record;
  p_selcnt  integer;
  v_unit    bigint; v_modtot bigint; v_line bigint;
  a_name    text[] := '{}'; a_vname text[] := '{}'; a_unit bigint[] := '{}'; a_modtot bigint[] := '{}';
  a_line    bigint[] := '{}'; a_station uuid[] := '{}';
  a_oi      uuid[] := '{}';

  v_round_no integer;
  v_round_id uuid;
  v_sum      bigint := 0;
  v_ticket   uuid;
  v_tickets  uuid[] := '{}';
  st         uuid;
  v_oi       uuid;
  m          record;
begin
  -- 1. authorize (unknown/inactive location and no permission look the same)
  select l.organization_id, l.timezone, l.currency, l.tax_rate_bps
    into v_org, v_tz, v_cur, v_tax
  from public.locations l where l.id = v_loc and l.is_active;
  if v_org is null
     or not public.has_permission(v_org, 'orders.create')
     or not public.has_permission(v_org, 'pos.use')
     or not public.has_location_access(v_loc) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. shape (no client price/total/org/order/status keys are ever read; unknown keys are rejected)
  if v_ref is null or v_lines is null or jsonb_typeof(v_lines) <> 'array'
     or jsonb_array_length(v_lines) not between 1 and 60
     or v_channel is null or v_channel not in ('dine_in', 'takeaway')
     or (v_gc is not null and v_gc not between 1 and 50)
     or (v_cname is not null and char_length(v_cname) > 60) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if v_channel = 'dine_in' and v_table is null then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_channel = 'takeaway' and v_table is not null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  n := jsonb_array_length(v_lines);
  begin
    for i in 0 .. n - 1 loop
      v_el := v_lines -> i;
      if jsonb_typeof(v_el) <> 'object' then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_el) loop
        if v_key not in ('item_id', 'variant_id', 'modifier_ids', 'quantity', 'note') then
          raise exception 'INVALID_INPUT' using errcode = '22023';
        end if;
      end loop;
      if jsonb_typeof(v_el -> 'item_id') <> 'string'
         or jsonb_typeof(v_el -> 'quantity') <> 'number'
         or (v_el ? 'variant_id' and jsonb_typeof(v_el -> 'variant_id') not in ('string', 'null'))
         or (v_el ? 'note' and jsonb_typeof(v_el -> 'note') not in ('string', 'null'))
         or (v_el ? 'modifier_ids' and jsonb_typeof(v_el -> 'modifier_ids') <> 'array') then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
      l_item := l_item || (v_el ->> 'item_id')::uuid;
      l_var  := l_var  || nullif(v_el ->> 'variant_id', '')::uuid;
      if (v_el ->> 'quantity')::numeric <> trunc((v_el ->> 'quantity')::numeric)
         or (v_el ->> 'quantity')::numeric not between 1 and 99 then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
      l_qty  := l_qty || (v_el ->> 'quantity')::integer;
      l_note := l_note || nullif(btrim(v_el ->> 'note'), '');
      if l_note[i + 1] is not null and char_length(l_note[i + 1]) > 200 then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
      if jsonb_typeof(v_el -> 'modifier_ids') = 'array' and jsonb_array_length(v_el -> 'modifier_ids') > 0 then
        select coalesce(array_agg(x::uuid order by x::uuid), '{}') into l_modlist
        from jsonb_array_elements_text(v_el -> 'modifier_ids') x;
        if (select count(distinct y) from unnest(l_modlist) y) <> cardinality(l_modlist) then
          raise exception 'INVALID_INPUT' using errcode = '22023';
        end if;
      else
        l_modlist := '{}';
      end if;
      -- one text per line keeps arrays rectangular: modifier lists are stored in a side jsonb below
      v_parts := v_parts || format('{"item_id":%s,"variant_id":%s,"modifier_ids":[%s],"quantity":%s,"note":%s}',
        to_json(l_item[i + 1])::text,
        coalesce(to_json(l_var[i + 1])::text, 'null'),
        coalesce((select string_agg(to_json(y)::text, ',' order by y) from unnest(l_modlist) y), ''),
        l_qty[i + 1],
        coalesce(to_json(l_note[i + 1])::text, 'null'));
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end;

  v_canon := format('{"channel":%s,"table_id":%s,"customer_name":%s,"guest_count":%s,"lines":[%s]}',
    to_json(v_channel)::text, coalesce(to_json(v_table)::text, 'null'),
    coalesce(to_json(v_cname)::text, 'null'), coalesce(v_gc::text, 'null'),
    array_to_string(v_parts, ','));
  v_hash := encode(extensions.digest(v_canon, 'sha256'), 'hex');

  -- 3. idempotency: serialise on (org, client_ref), then replay or conflict
  perform pg_advisory_xact_lock(hashtextextended('order_round:' || v_org::text || ':' || v_ref::text, 0));
  select * into v_round from public.order_rounds r where r.organization_id = v_org and r.client_ref = v_ref;
  if found then
    if v_round.request_hash <> v_hash or v_round.location_id <> v_loc then
      raise exception 'CLIENT_REF_CONFLICT' using errcode = 'P0001';
    end if;
    select * into v_order from public.orders o where o.id = v_round.order_id;
    return jsonb_build_object(
      'orderId', v_order.id, 'orderNumber', v_order.order_number, 'roundNo', v_round.round_no,
      'ticketIds', coalesce((select jsonb_agg(t.id order by t.ticket_number) from public.kitchen_tickets t
                              where t.round_id = v_round.id), '[]'::jsonb),
      'subtotal', v_order.subtotal, 'currency', v_order.currency, 'replayed', true);
  end if;

  -- 4. table + order
  v_date := (now() at time zone v_tz)::date;
  if v_channel = 'dine_in' then
    select t.status into v_tstatus from public.tables t
     where t.id = v_table and t.location_id = v_loc and t.is_active for update;
    if not found then
      raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
    end if;
    select * into v_order from public.orders o
     where o.table_id = v_table and o.status not in ('completed', 'cancelled') for update;
    if found then
      if v_order.status not in ('accepted', 'preparing', 'ready') then
        raise exception 'ORDER_CLOSED' using errcode = 'P0001';
      end if;
    else
      v_new := true;
      if v_tstatus = 'needs_cleaning' then
        raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'needs_cleaning -> occupied';
      end if;
    end if;
  else
    v_new := true;
  end if;

  -- 5. recompute every line from the database
  for i in 1 .. n loop
    select i2.name, i2.base_price, o.price_override, o.kitchen_station_id
      into p_name, p_base, p_over, p_station
    from public.menu_items i2
    join public.menu_categories c on c.id = i2.category_id and c.is_active
    left join public.location_menu_overrides o on o.item_id = i2.id and o.location_id = v_loc
    where i2.id = l_item[i] and i2.organization_id = v_org and i2.is_active and i2.is_published
      and coalesce(o.is_available, true)
      and (o.sold_out_until is null or o.sold_out_until <= now());
    if not found then
      v_bad := v_bad || l_item[i];
      a_name := a_name || null::text; a_vname := a_vname || null::text; a_unit := a_unit || null::bigint;
      a_modtot := a_modtot || null::bigint; a_line := a_line || null::bigint; a_station := a_station || null::uuid;
      continue;
    end if;
    -- an inactive station is treated as no station (the item skips the KDS)
    if p_station is not null and not exists (
         select 1 from public.kitchen_stations s where s.id = p_station and s.location_id = v_loc and s.is_active) then
      p_station := null;
    end if;

    select count(*) into p_vcount from public.item_variants v where v.item_id = l_item[i] and v.is_active;
    p_vname := null; p_vdelta := 0;
    if l_var[i] is null then
      if p_vcount > 0 then
        raise exception 'VARIANT_REQUIRED' using errcode = 'P0001';
      end if;
    else
      select v.name, v.price_delta into p_vname, p_vdelta
      from public.item_variants v
      where v.id = l_var[i] and v.item_id = l_item[i] and v.organization_id = v_org and v.is_active;
      if not found then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
    end if;
    v_unit := coalesce(p_over, p_base) + p_vdelta;
    if v_unit < 0 then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;

    -- modifiers of this line (re-read from the request: ids sorted, validated against the item's groups)
    select coalesce(array_agg(x::uuid), '{}') into l_modlist
    from jsonb_array_elements_text(coalesce(v_lines -> (i - 1) -> 'modifier_ids', '[]'::jsonb)) x;
    select count(*), coalesce(sum(m2.price_delta), 0) into p_found, v_modtot
    from public.modifiers m2
    join public.modifier_groups g2 on g2.id = m2.group_id and g2.is_active and g2.organization_id = v_org
    join public.menu_item_modifier_groups l2 on l2.group_id = g2.id and l2.item_id = l_item[i]
    where m2.id = any (l_modlist) and m2.is_active and m2.organization_id = v_org;
    if p_found <> cardinality(l_modlist) then
      raise exception 'MODIFIER_INVALID' using errcode = 'P0001';
    end if;
    for g in
      select g3.id, g3.min_select, g3.max_select
      from public.menu_item_modifier_groups l3
      join public.modifier_groups g3 on g3.id = l3.group_id and g3.is_active
      where l3.item_id = l_item[i]
        and exists (select 1 from public.modifiers m3 where m3.group_id = g3.id and m3.is_active)
    loop
      select count(*) into p_selcnt from public.modifiers m4
       where m4.group_id = g.id and m4.id = any (l_modlist) and m4.is_active;
      if p_selcnt < g.min_select or p_selcnt > g.max_select then
        raise exception 'MODIFIER_INVALID' using errcode = 'P0001', detail = g.id::text;
      end if;
    end loop;

    v_line := (v_unit + v_modtot) * l_qty[i];
    a_name := a_name || p_name; a_vname := a_vname || p_vname; a_unit := a_unit || v_unit;
    a_modtot := a_modtot || v_modtot; a_line := a_line || v_line; a_station := a_station || p_station;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001', detail = to_json(v_bad)::text;
  end if;

  -- 6. write
  if v_new then
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:max_orders_per_month:' || v_org::text, 0));
    perform private.plan_limit_check(v_org, 'max_orders_per_month',
      (select count(*) from public.orders o2
        where o2.organization_id = v_org and o2.created_at >= date_trunc('month', now())));
    insert into public.orders (organization_id, location_id, order_number, business_date, channel, status,
                               table_id, opened_by, customer_name, guest_count, currency)
    values (v_org, v_loc, private.next_counter(v_loc, v_date, 'order'), v_date, v_channel, 'placed',
            v_table, v_uid, v_cname, v_gc, v_cur)
    returning * into v_order;
    perform private.log_order_event(v_org, v_loc, v_order.id, null, null, 'order_status_changed',
      null, 'placed', jsonb_build_object('channel', v_channel));
    update public.orders o set status = 'accepted' where o.id = v_order.id;
    perform private.log_order_event(v_org, v_loc, v_order.id, null, null, 'order_status_changed',
      'placed', 'accepted', '{}'::jsonb, true);
    if v_table is not null and v_tstatus in ('available', 'reserved') then
      update public.tables t set status = 'occupied' where t.id = v_table;
      perform private.log_order_event(v_org, v_loc, v_order.id, null, null, 'table_status_changed',
        v_tstatus, 'occupied', jsonb_build_object('table_id', v_table), true);
    end if;
  end if;

  v_round_no := v_order.round_count + 1;
  insert into public.order_rounds (organization_id, location_id, order_id, round_no, client_ref, request_hash, created_by)
  values (v_org, v_loc, v_order.id, v_round_no, v_ref, v_hash, v_uid)
  returning id into v_round_id;

  for i in 1 .. n loop
    insert into public.order_items (organization_id, location_id, order_id, round_id, menu_item_id, variant_id,
                                    item_name, variant_name, unit_price, modifiers_total, quantity, line_total,
                                    tax_rate_bps, note, kitchen_station_id)
    values (v_org, v_loc, v_order.id, v_round_id, l_item[i], l_var[i], a_name[i], a_vname[i], a_unit[i], a_modtot[i],
            l_qty[i], a_line[i], v_tax, l_note[i], a_station[i])
    returning id into v_oi;
    a_oi := a_oi || v_oi;
    insert into public.order_item_modifiers (organization_id, location_id, order_item_id, modifier_id,
                                             modifier_group_id, name, price_delta)
    select v_org, v_loc, v_oi, m5.id, m5.group_id, m5.name, m5.price_delta
    from public.modifiers m5
    where m5.id in (select x::uuid from jsonb_array_elements_text(coalesce(v_lines -> (i - 1) -> 'modifier_ids', '[]'::jsonb)) x);
    v_sum := v_sum + a_line[i];
  end loop;

  -- one ticket per station, only for lines that have a station (station-less lines skip the KDS)
  for st in select distinct s from unnest(a_station) s where s is not null loop
    insert into public.kitchen_tickets (organization_id, location_id, order_id, round_id, kitchen_station_id,
                                        ticket_number, business_date)
    values (v_org, v_loc, v_order.id, v_round_id, st, private.next_counter(v_loc, v_date, 'ticket'), v_date)
    returning id into v_ticket;
    v_tickets := v_tickets || v_ticket;
    for i in 1 .. n loop
      if a_station[i] = st then
        select coalesce(string_agg(om.name, ', ' order by om.name), '') into v_modtxt
        from public.order_item_modifiers om where om.order_item_id = a_oi[i];
        insert into public.kitchen_ticket_items (organization_id, location_id, ticket_id, order_item_id, item_name,
                                                 variant_name, quantity, modifiers_text, note)
        values (v_org, v_loc, v_ticket, a_oi[i], a_name[i], a_vname[i], l_qty[i], v_modtxt, l_note[i]);
      end if;
    end loop;
  end loop;

  update public.orders o
     set subtotal = o.subtotal + v_sum, round_count = v_round_no
   where o.id = v_order.id
  returning * into v_order;
  perform private.log_order_event(v_org, v_loc, v_order.id, null, null, 'round_sent', null, null,
    jsonb_build_object('round_no', v_round_no, 'lines', n, 'tickets', cardinality(v_tickets)));
  perform private.derive_order_status(v_order.id, true);

  return jsonb_build_object(
    'orderId', v_order.id, 'orderNumber', v_order.order_number, 'roundNo', v_round_no,
    'ticketIds', to_jsonb(v_tickets), 'subtotal', v_order.subtotal, 'currency', v_order.currency,
    'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- void_order_item: orders.void, or the creator while the item's ticket is still `new`
-- ---------------------------------------------------------------------------
create or replace function public.void_order_item(item_id uuid, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item   uuid := void_order_item.item_id;
  v_reason text := btrim(void_order_item.reason);
  v_uid    uuid := (select auth.uid());
  i        public.order_items%rowtype;
  o        public.orders%rowtype;
  v_allow  boolean;
  v_tid    uuid;
  v_left   int;
begin
  select * into i from public.order_items x where x.id = v_item;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_allow := public.has_location_access(i.location_id) and (
    public.has_permission(i.organization_id, 'orders.void')
    or (public.has_permission(i.organization_id, 'orders.create')
        and exists (select 1 from public.order_rounds r where r.id = i.round_id and r.created_by = v_uid)
        and exists (select 1 from public.kitchen_ticket_items ti
                    join public.kitchen_tickets t on t.id = ti.ticket_id
                    where ti.order_item_id = i.id and t.status = 'new')));
  if not v_allow then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select * into o from public.orders x where x.id = i.order_id for update;
  if o.status in ('served', 'completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  select * into i from public.order_items x where x.id = v_item for update;
  if i.status = 'void' then
    raise exception 'ALREADY_VOID' using errcode = 'P0001';
  end if;

  update public.order_items x set status = 'void', voided_at = now(), voided_by = v_uid, void_reason = v_reason
   where x.id = v_item;
  update public.kitchen_ticket_items ti set status = 'void' where ti.order_item_id = v_item and ti.status <> 'void'
  returning ti.ticket_id into v_tid;
  perform private.recompute_order_totals(o.id);
  perform private.log_order_event(o.organization_id, o.location_id, o.id, v_item, v_tid, 'item_voided', null, null,
    jsonb_build_object('reason', v_reason, 'line_total', i.line_total));
  perform private.write_audit(o.organization_id, v_uid, 'order.item_voided', 'order_item', v_item::text,
    jsonb_build_object('order_id', o.id, 'location_id', o.location_id, 'reason', v_reason, 'line_total', i.line_total));

  if v_tid is not null and not exists (
       select 1 from public.kitchen_ticket_items ti where ti.ticket_id = v_tid and ti.status <> 'void') then
    perform set_config('app.orders_system', '1', true);
    update public.kitchen_tickets t set status = 'bumped', bumped_at = coalesce(t.bumped_at, now())
     where t.id = v_tid and t.status <> 'bumped';
    perform set_config('app.orders_system', '', true);
  end if;

  select count(*) into v_left from public.order_items x where x.order_id = o.id and x.status = 'active';
  if v_left = 0 then
    perform private.cancel_order_internal(o.id, v_reason, v_uid);
  else
    perform private.derive_order_status(o.id, false);
  end if;
  return jsonb_build_object('orderId', o.id, 'itemId', v_item);
end;
$$;

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
  o        public.orders%rowtype;
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
  perform private.cancel_order_internal(v_order, v_reason, (select auth.uid()));
  return jsonb_build_object('orderId', v_order);
end;
$$;

create or replace function public.apply_order_discount(order_id uuid, amount bigint, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := apply_order_discount.order_id;
  v_amount bigint := apply_order_discount.amount;
  v_reason text := btrim(apply_order_discount.reason);
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_id     uuid;
begin
  select * into o from public.orders x where x.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'pos.discount')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_amount is null or v_amount <= 0 or v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = v_order for update;
  if o.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if o.discount_total + v_amount > o.subtotal then
    raise exception 'DISCOUNT_EXCEEDS_SUBTOTAL' using errcode = 'P0001';
  end if;
  insert into public.order_discounts (organization_id, location_id, order_id, amount, reason, applied_by)
  values (o.organization_id, o.location_id, o.id, v_amount, v_reason, v_uid)
  returning id into v_id;
  perform private.recompute_order_totals(o.id);
  perform private.log_order_event(o.organization_id, o.location_id, o.id, null, null, 'discount_applied', null, null,
    jsonb_build_object('discount_id', v_id, 'amount', v_amount, 'reason', v_reason));
  perform private.write_audit(o.organization_id, v_uid, 'order.discount_applied', 'order', o.id::text,
    jsonb_build_object('location_id', o.location_id, 'discount_id', v_id, 'amount', v_amount, 'reason', v_reason));
  return jsonb_build_object('discountId', v_id, 'discountTotal', o.discount_total + v_amount);
end;
$$;

create or replace function public.remove_order_discount(discount_id uuid, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id     uuid := remove_order_discount.discount_id;
  v_reason text := btrim(remove_order_discount.reason);
  v_uid    uuid := (select auth.uid());
  d        public.order_discounts%rowtype;
  o        public.orders%rowtype;
begin
  select * into d from public.order_discounts x where x.id = v_id;
  if not found
     or not public.has_permission(d.organization_id, 'pos.discount')
     or not public.has_location_access(d.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = d.order_id for update;
  select * into d from public.order_discounts x where x.id = v_id for update;
  if d.removed_at is not null then
    raise exception 'ALREADY_REMOVED' using errcode = 'P0001';
  end if;
  if o.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  update public.order_discounts x set removed_at = now(), removed_by = v_uid, remove_reason = v_reason where x.id = v_id;
  perform private.recompute_order_totals(o.id);
  perform private.log_order_event(o.organization_id, o.location_id, o.id, null, null, 'discount_removed', null, null,
    jsonb_build_object('discount_id', v_id, 'amount', d.amount, 'reason', v_reason));
  perform private.write_audit(o.organization_id, v_uid, 'order.discount_removed', 'order', o.id::text,
    jsonb_build_object('location_id', o.location_id, 'discount_id', v_id, 'amount', d.amount, 'reason', v_reason));
  return jsonb_build_object('discountId', v_id, 'discountTotal', o.discount_total - d.amount);
end;
$$;

-- served (from ready) and accepted (from placed) are the only manual order transitions
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
  return jsonb_build_object('orderId', v_order, 'status', v_to);
end;
$$;

create or replace function public.update_kot_status(ticket_id uuid, to_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ticket uuid := update_kot_status.ticket_id;
  v_to     text := update_kot_status.to_status;
  v_uid    uuid := (select auth.uid());
  t        public.kitchen_tickets%rowtype;
begin
  select * into t from public.kitchen_tickets x where x.id = v_ticket;
  if not found
     or not public.has_permission(t.organization_id, 'kitchen.update')
     or not public.has_location_access(t.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_to is null or v_to not in ('in_progress', 'ready', 'bumped') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select * into t from public.kitchen_tickets x where x.id = v_ticket for update;
  if t.status = v_to then
    return jsonb_build_object('ticketId', v_ticket, 'status', t.status);
  end if;
  if not private.kot_transition_ok(t.status, v_to) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = t.status || ' -> ' || v_to;
  end if;
  update public.kitchen_tickets x
     set status = v_to, updated_by = v_uid,
         accepted_at = case when v_to = 'in_progress' then now() else x.accepted_at end,
         ready_at    = case when v_to = 'ready' then now() else x.ready_at end,
         bumped_at   = case when v_to = 'bumped' then now() else x.bumped_at end
   where x.id = v_ticket;
  perform private.log_order_event(t.organization_id, t.location_id, t.order_id, null, v_ticket, 'kot_status_changed',
    t.status, v_to, '{}'::jsonb);
  perform private.derive_order_status(t.order_id, false);
  return jsonb_build_object('ticketId', v_ticket, 'status', v_to);
end;
$$;

create or replace function public.set_kot_item_status(ticket_item_id uuid, to_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := set_kot_item_status.ticket_item_id;
  v_to text := set_kot_item_status.to_status;
  ti   public.kitchen_ticket_items%rowtype;
begin
  select * into ti from public.kitchen_ticket_items x where x.id = v_id;
  if not found
     or not public.has_permission(ti.organization_id, 'kitchen.update')
     or not public.has_location_access(ti.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_to is null or v_to not in ('pending', 'ready') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if ti.status = 'void' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'void -> ' || v_to;
  end if;
  update public.kitchen_ticket_items x set status = v_to where x.id = v_id;
  return jsonb_build_object('ticketItemId', v_id, 'status', v_to);
end;
$$;

create or replace function public.mark_table_clean(table_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_table uuid := mark_table_clean.table_id;
  t       record;
begin
  select x.organization_id, x.location_id, x.status into t
  from public.tables x where x.id = v_table and x.is_active;
  if not found
     or not public.has_permission(t.organization_id, 'orders.create')
     or not public.has_location_access(t.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not private.table_transition_ok(t.status, 'available') or t.status <> 'needs_cleaning' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = t.status || ' -> available';
  end if;
  update public.tables x set status = 'available' where x.id = v_table;
  -- no order is attached to a clean-up, so the trail goes to audit_logs
  perform private.write_audit(t.organization_id, (select auth.uid()), 'table.cleaned', 'table', v_table::text,
    jsonb_build_object('location_id', t.location_id));
  return jsonb_build_object('tableId', v_table, 'status', 'available');
end;
$$;

revoke execute on function
  public.submit_order_round(uuid, uuid, text, jsonb, uuid, text, integer),
  public.void_order_item(uuid, text), public.cancel_order(uuid, text),
  public.apply_order_discount(uuid, bigint, text), public.remove_order_discount(uuid, text),
  public.set_order_status(uuid, text), public.update_kot_status(uuid, text),
  public.set_kot_item_status(uuid, text), public.mark_table_clean(uuid)
  from public, anon, authenticated;
grant execute on function
  public.submit_order_round(uuid, uuid, text, jsonb, uuid, text, integer),
  public.void_order_item(uuid, text), public.cancel_order(uuid, text),
  public.apply_order_discount(uuid, bigint, text), public.remove_order_discount(uuid, text),
  public.set_order_status(uuid, text), public.update_kot_status(uuid, text),
  public.set_kot_item_status(uuid, text), public.mark_table_clean(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: private broadcast on location:{id}. Ids and statuses only (no names, notes, amounts, PII).
-- Emitted by triggers in the same transaction as the row change; a failure here never fails the write.
-- ---------------------------------------------------------------------------
create or replace function private.broadcast_location(p_loc uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'location:' || p_loc::text, true);
exception when others then
  null;
end;
$$;

create or replace function private.broadcast_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_location(new.location_id, 'order.changed', jsonb_build_object(
    'orderId', new.id, 'status', new.status, 'tableId', new.table_id, 'channel', new.channel,
    'orderNumber', new.order_number, 'roundCount', new.round_count, 'updatedAt', new.updated_at));
  return null;
end;
$$;
create trigger orders_broadcast after insert or update on public.orders
  for each row execute function private.broadcast_order_change();

create or replace function private.broadcast_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_location(new.location_id, 'ticket.changed', jsonb_build_object(
    'ticketId', new.id, 'orderId', new.order_id, 'stationId', new.kitchen_station_id,
    'status', new.status, 'updatedAt', new.updated_at));
  return null;
end;
$$;
create trigger kitchen_tickets_broadcast after insert or update on public.kitchen_tickets
  for each row execute function private.broadcast_ticket_change();

create or replace function private.broadcast_ticket_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_location(new.location_id, 'ticket_item.changed', jsonb_build_object(
    'ticketItemId', new.id, 'ticketId', new.ticket_id, 'status', new.status));
  return null;
end;
$$;
create trigger kitchen_ticket_items_broadcast after insert or update on public.kitchen_ticket_items
  for each row execute function private.broadcast_ticket_item_change();

create or replace function private.broadcast_table_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_location(new.location_id, 'table.changed', jsonb_build_object(
    'tableId', new.id, 'status', new.status, 'updatedAt', new.updated_at));
  return null;
end;
$$;
create trigger tables_status_broadcast after update of status on public.tables
  for each row when (old.status is distinct from new.status)
  execute function private.broadcast_table_change();

-- Who may join location:{id}: members with access to that location and orders.view or kitchen.view.
create or replace function public.can_receive_location_topic(topic text)
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
  if topic is null or topic !~ '^location:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_loc := substr(topic, 10)::uuid;
  select l.organization_id into v_org from public.locations l where l.id = v_loc;
  return v_org is not null
     and public.has_location_access(v_loc)
     and (public.has_permission(v_org, 'orders.view') or public.has_permission(v_org, 'kitchen.view'));
end;
$$;
revoke execute on function public.can_receive_location_topic(text) from public, anon, authenticated;
grant execute on function public.can_receive_location_topic(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists orders_location_receive on realtime.messages';
    execute $p$create policy orders_location_receive on realtime.messages
      for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.can_receive_location_topic((select realtime.topic())))$p$;
  end if;
end $$;
