-- MSC-T12 (M3 §7): table operations. Contract: docs/contracts/orders.md "Table operations" (MSC-T11, #136).
-- move_order_to_table, merge_tables / unmerge_table (a table group inside one order), assign_order_waiter,
-- list_assignable_waiters. Error contract (P0001 unless noted; the message is the code): FORBIDDEN (42501),
-- INVALID_INPUT (22023), ORDER_CHANGED (retryable: the order's tables changed while waiting for the lock), ORDER_NOT_MOVABLE, ORDER_HAS_GROUP, TABLE_NOT_AVAILABLE, TABLE_IN_GROUP, TABLE_NOT_IN_GROUP,
-- TABLE_NOT_FOUND, INVALID_ASSIGNEE, ORDER_CLOSED.
-- Lock order: tables (every table involved, sorted by id) -> orders -> order_tables -> bill_sets/bills -> cash_sessions.

-- ---------------------------------------------------------------------------
-- orders.waiter_id (defaults to the opener for dine-in orders; gates nothing in M3; never published on Realtime)
-- ---------------------------------------------------------------------------
alter table public.orders add column waiter_id uuid references auth.users (id) on delete set null;
create index orders_waiter_idx on public.orders (waiter_id) where waiter_id is not null;

create or replace function private.orders_default_waiter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.waiter_id is null and new.channel = 'dine_in' and new.opened_by is not null then
    new.waiter_id := new.opened_by;
  end if;
  return new;
end;
$$;
create trigger orders_default_waiter before insert on public.orders
  for each row execute function private.orders_default_waiter();

alter table public.order_events drop constraint order_events_type_valid;
alter table public.order_events add constraint order_events_type_valid check (event_type in
  ('round_sent', 'order_status_changed', 'item_voided', 'order_cancelled', 'discount_applied', 'discount_removed',
   'kot_status_changed', 'table_status_changed', 'order_moved', 'tables_merged', 'table_unmerged', 'waiter_assigned'));

-- ---------------------------------------------------------------------------
-- order_tables: the secondary tables of a party (append-and-release, nothing deleted)
-- ---------------------------------------------------------------------------
create table public.order_tables (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  order_id         uuid not null,
  table_id         uuid not null,
  added_by         uuid references auth.users (id) on delete set null,
  added_at         timestamptz not null default now(),
  released_at      timestamptz,
  released_by      uuid references auth.users (id) on delete set null,
  constraint order_tables_release_fields check (released_at is not null or released_by is null),
  constraint order_tables_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint order_tables_order_fk foreign key (order_id, location_id)
    references public.orders (id, location_id) on delete cascade,
  constraint order_tables_table_fk foreign key (table_id, location_id)
    references public.tables (id, location_id) on delete cascade
);
-- a table is a secondary table of at most one open party
create unique index order_tables_one_active_per_table_key on public.order_tables (table_id) where released_at is null;
create index order_tables_organization_id_idx on public.order_tables (organization_id);
create index order_tables_order_idx on public.order_tables (order_id);
create index order_tables_location_idx on public.order_tables (location_id);

-- Cross-exclusion: the two unique indexes (orders.table_id, order_tables.table_id) cannot see each other.
create or replace function private.order_tables_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary uuid;
begin
  select o.table_id into v_primary from public.orders o where o.id = new.order_id;
  if v_primary is not distinct from new.table_id then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if exists (select 1 from public.orders o
              where o.table_id = new.table_id and o.status not in ('completed', 'cancelled')) then
    raise exception 'TABLE_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger order_tables_guard before insert on public.order_tables
  for each row execute function private.order_tables_guard();

create or replace function private.orders_group_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.table_id is not null and exists (
       select 1 from public.order_tables ot
        where ot.table_id = new.table_id and ot.released_at is null and ot.order_id <> new.id) then
    raise exception 'TABLE_IN_GROUP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger orders_group_guard before insert or update of table_id on public.orders
  for each row execute function private.orders_group_guard();

alter table public.order_tables enable row level security;
create policy order_tables_select on public.order_tables
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
revoke all on public.order_tables from anon, authenticated;
grant select on public.order_tables to authenticated;

-- A table that is in use (primary of an open order, or an active secondary table) cannot be deactivated or deleted.
create or replace function private.tables_in_use_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (old.is_active and not new.is_active) then
    return new;
  end if;
  if exists (select 1 from public.orders o where o.table_id = old.id and o.status not in ('completed', 'cancelled'))
     or exists (select 1 from public.order_tables ot where ot.table_id = old.id and ot.released_at is null) then
    raise exception 'TABLE_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger tables_in_use_guard_update before update of is_active on public.tables
  for each row execute function private.tables_in_use_guard();
create trigger tables_in_use_guard_delete before delete on public.tables
  for each row execute function private.tables_in_use_guard();

-- ---------------------------------------------------------------------------
-- Changes to existing helpers
-- ---------------------------------------------------------------------------
-- Locks every table of an order (primary + active secondary), SORTED BY ID, before the order row. Replaces the bills
-- version that locked the primary table only.
create or replace function private.lock_tables(p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.tables t where t.id = any (p_ids) order by t.id for update;
end;
$$;

create or replace function private.lock_order_table(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(x.t order by x.t), '{}') into v_ids
  from (select o.table_id as t from public.orders o where o.id = p_order and o.table_id is not null
        union
        select ot.table_id from public.order_tables ot where ot.order_id = p_order and ot.released_at is null) x;
  perform private.lock_tables(v_ids);
end;
$$;

-- The sorted, distinct set of tables a table operation must hold: the order's primary table, its active secondary
-- tables and any extra tables the call touches. Read once BEFORE locking and again AFTER the order row is locked; if the
-- two differ (a concurrent move/merge/unmerge changed the order's tables in between) the call raises ORDER_CHANGED, so
-- an operation never updates a table it did not lock in id order.
create or replace function private.order_table_set(p_order uuid, p_extra uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.t order by x.t), '{}')
  from (select o.table_id as t from public.orders o where o.id = p_order and o.table_id is not null
        union
        select ot.table_id from public.order_tables ot where ot.order_id = p_order and ot.released_at is null
        union
        select e from unnest(coalesce(p_extra, '{}')) e where e is not null) x;
$$;

-- Frees the primary table AND every active secondary table (occupied -> needs_cleaning) and releases the group rows.
-- Called by cancel_order_internal and complete_order_if_paid.
create or replace function private.free_table_if_idle(p_org uuid, p_loc uuid, p_order uuid, p_table uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed int;
  g         record;
begin
  if p_table is null then return; end if;
  update public.tables t set status = 'needs_cleaning' where t.id = p_table and t.status = 'occupied';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform private.log_order_event(p_org, p_loc, p_order, null, null, 'table_status_changed',
      'occupied', 'needs_cleaning', jsonb_build_object('table_id', p_table), true);
  end if;
  for g in select ot.id, ot.table_id from public.order_tables ot
            where ot.order_id = p_order and ot.released_at is null order by ot.table_id loop
    update public.tables t set status = 'needs_cleaning' where t.id = g.table_id and t.status = 'occupied';
    get diagnostics v_changed = row_count;
    if v_changed > 0 then
      perform private.log_order_event(p_org, p_loc, p_order, null, null, 'table_status_changed',
        'occupied', 'needs_cleaning', jsonb_build_object('table_id', g.table_id), true);
    end if;
    update public.order_tables ot set released_at = now(), released_by = (select auth.uid()) where ot.id = g.id;
  end loop;
end;
$$;

-- Active members who can be assigned to tables at a location: orders.create (owners implicitly) + location access.
create or replace function private.assignable_waiters(p_loc uuid)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Staff')
  from public.locations l
  join public.organizations o on o.id = l.organization_id and o.status <> 'suspended'
  join public.organization_members m on m.organization_id = l.organization_id and m.status = 'active'
  join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
  left join public.profiles p on p.id = m.user_id
  where l.id = p_loc
    and (m.all_locations
         or (r.is_system and r.key = 'owner')
         or exists (select 1 from public.location_staff ls where ls.member_id = m.id and ls.location_id = l.id))
    and ((r.is_system and r.key = 'owner')
         or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = 'orders.create'));
$$;

-- ---------------------------------------------------------------------------
-- move_order_to_table
-- ---------------------------------------------------------------------------
create or replace function public.move_order_to_table(order_id uuid, to_table_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := move_order_to_table.order_id;
  v_to     uuid := move_order_to_table.to_table_id;
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_from   uuid;
  v_set    uuid[];
  t        public.tables%rowtype;
begin
  select * into o from public.orders x where x.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'orders.create')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_to is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if o.channel <> 'dine_in' or o.table_id is null then
    raise exception 'ORDER_NOT_MOVABLE' using errcode = 'P0001';
  end if;
  if o.table_id = v_to then
    return jsonb_build_object('orderId', v_order, 'fromTableId', o.table_id, 'toTableId', v_to);
  end if;

  -- lock both tables sorted by id (plus the group, which also blocks a racing merge), then the order; if the order's
  -- tables changed while we waited for the order lock, refuse (retryable) instead of touching an unlocked table
  v_set := private.order_table_set(v_order, array[v_to]);
  perform private.lock_tables(v_set);
  select * into o from public.orders x where x.id = v_order for update;
  if private.order_table_set(v_order, array[v_to]) is distinct from v_set then
    raise exception 'ORDER_CHANGED' using errcode = 'P0001';
  end if;
  v_from := o.table_id;
  if o.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_NOT_MOVABLE' using errcode = 'P0001';
  end if;
  if v_from = v_to then
    return jsonb_build_object('orderId', v_order, 'fromTableId', v_from, 'toTableId', v_to);
  end if;
  if exists (select 1 from public.order_tables ot where ot.order_id = v_order and ot.released_at is null) then
    raise exception 'ORDER_HAS_GROUP' using errcode = 'P0001';
  end if;

  select * into t from public.tables x where x.id = v_to and x.location_id = o.location_id and x.is_active;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if t.status <> 'available'
     or exists (select 1 from public.orders x where x.table_id = v_to and x.status not in ('completed', 'cancelled'))
     or exists (select 1 from public.order_tables ot where ot.table_id = v_to and ot.released_at is null) then
    raise exception 'TABLE_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.tables x set status = 'occupied' where x.id = v_to;
  update public.tables x set status = 'needs_cleaning' where x.id = v_from and x.status = 'occupied';
  update public.orders x set table_id = v_to where x.id = v_order;

  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'order_moved', null, null,
    jsonb_build_object('from_table_id', v_from, 'to_table_id', v_to));
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'table_status_changed',
    'available', 'occupied', jsonb_build_object('table_id', v_to));
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'table_status_changed',
    'occupied', 'needs_cleaning', jsonb_build_object('table_id', v_from));
  perform private.write_audit(o.organization_id, v_uid, 'order.moved', 'order', v_order::text,
    jsonb_build_object('location_id', o.location_id, 'from_table_id', v_from, 'to_table_id', v_to));
  return jsonb_build_object('orderId', v_order, 'fromTableId', v_from, 'toTableId', v_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_tables / unmerge_table
-- ---------------------------------------------------------------------------
create or replace function public.merge_tables(order_id uuid, table_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := merge_tables.order_id;
  v_ids    uuid[] := merge_tables.table_ids;
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_have   uuid[];
  v_set    uuid[];
  v_new    uuid[];
  x        uuid;
  t        public.tables%rowtype;
begin
  select * into o from public.orders y where y.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'orders.create')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_ids is null or cardinality(v_ids) not between 1 and 9
     or (select count(distinct u) from unnest(v_ids) u) <> cardinality(v_ids)
     or array_position(v_ids, null::uuid) is not null or o.table_id = any (v_ids) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if o.channel <> 'dine_in' or o.table_id is null then
    raise exception 'ORDER_NOT_MOVABLE' using errcode = 'P0001';
  end if;

  v_set := private.order_table_set(v_order, v_ids);
  perform private.lock_tables(v_set);
  select * into o from public.orders y where y.id = v_order for update;
  if private.order_table_set(v_order, v_ids) is distinct from v_set then
    raise exception 'ORDER_CHANGED' using errcode = 'P0001';
  end if;
  if o.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_NOT_MOVABLE' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(ot.table_id), '{}') into v_have
  from public.order_tables ot where ot.order_id = v_order and ot.released_at is null;
  v_new := array(select u from unnest(v_ids) u where u <> all (v_have));
  if cardinality(v_have) + cardinality(v_new) > 9 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  foreach x in array v_new loop
    select * into t from public.tables y where y.id = x and y.location_id = o.location_id and y.is_active;
    if not found then
      raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if t.status <> 'available'
       or exists (select 1 from public.orders y where y.table_id = x and y.status not in ('completed', 'cancelled'))
       or exists (select 1 from public.order_tables ot where ot.table_id = x and ot.released_at is null) then
      raise exception 'TABLE_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end loop;

  if cardinality(v_new) > 0 then
    foreach x in array v_new loop
      insert into public.order_tables (organization_id, location_id, order_id, table_id, added_by)
      values (o.organization_id, o.location_id, v_order, x, v_uid);
      update public.tables y set status = 'occupied' where y.id = x;
      perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'table_status_changed',
        'available', 'occupied', jsonb_build_object('table_id', x));
    end loop;
    update public.orders y set updated_at = now() where y.id = v_order;  -- signals clients (order.changed) to refetch the group
    perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'tables_merged', null, null,
      jsonb_build_object('table_ids', to_jsonb(v_new)));
    perform private.write_audit(o.organization_id, v_uid, 'order.tables_merged', 'order', v_order::text,
      jsonb_build_object('location_id', o.location_id, 'table_ids', to_jsonb(v_new)));
  end if;
  return jsonb_build_object('orderId', v_order, 'tableIds',
    to_jsonb(array(select ot.table_id from public.order_tables ot
                    where ot.order_id = v_order and ot.released_at is null order by ot.table_id)));
end;
$$;

create or replace function public.unmerge_table(order_id uuid, table_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := unmerge_table.order_id;
  v_table  uuid := unmerge_table.table_id;
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_set    uuid[];
  v_row    uuid;
begin
  select * into o from public.orders y where y.id = v_order;
  if not found
     or not public.has_permission(o.organization_id, 'orders.create')
     or not public.has_location_access(o.location_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_table is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  v_set := private.order_table_set(v_order, array[v_table]);
  perform private.lock_tables(v_set);
  select * into o from public.orders y where y.id = v_order for update;
  if private.order_table_set(v_order, array[v_table]) is distinct from v_set then
    raise exception 'ORDER_CHANGED' using errcode = 'P0001';
  end if;
  if o.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_NOT_MOVABLE' using errcode = 'P0001';
  end if;
  -- the primary table cannot be released (it is not a group row), and a table outside the group is refused
  select ot.id into v_row from public.order_tables ot
   where ot.order_id = v_order and ot.table_id = v_table and ot.released_at is null for update;
  if v_row is null then
    raise exception 'TABLE_NOT_IN_GROUP' using errcode = 'P0001';
  end if;
  update public.order_tables ot set released_at = now(), released_by = v_uid where ot.id = v_row;
  update public.tables y set status = 'needs_cleaning' where y.id = v_table and y.status = 'occupied';
  update public.orders y set updated_at = now() where y.id = v_order;
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'table_unmerged', null, null,
    jsonb_build_object('table_id', v_table));
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'table_status_changed',
    'occupied', 'needs_cleaning', jsonb_build_object('table_id', v_table));
  perform private.write_audit(o.organization_id, v_uid, 'order.table_unmerged', 'order', v_order::text,
    jsonb_build_object('location_id', o.location_id, 'table_id', v_table));
  return jsonb_build_object('orderId', v_order, 'tableId', v_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- assign_order_waiter / list_assignable_waiters
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_waiter(order_id uuid, waiter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order  uuid := assign_order_waiter.order_id;
  v_to     uuid := assign_order_waiter.waiter_id;
  v_uid    uuid := (select auth.uid());
  o        public.orders%rowtype;
  v_self   boolean;
begin
  select * into o from public.orders y where y.id = v_order;
  -- early, cheap refusal (an unknown order and a missing permission look the same); the exact permission is decided
  -- below, AFTER the order row is locked, because who the current waiter is can change while we wait for the lock
  if not found or not public.has_location_access(o.location_id)
     or not (public.has_permission(o.organization_id, 'orders.create') or public.has_permission(o.organization_id, 'tables.manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into o from public.orders y where y.id = v_order for update;
  -- taking a table or clearing your OWN assignment: orders.create. Anyone else's: tables.manage. Evaluated on the
  -- locked row, so a waiter cannot clear an assignment a manager has just changed.
  v_self := (v_to is not null and v_to = v_uid) or (v_to is null and o.waiter_id is not distinct from v_uid);
  if not public.has_permission(o.organization_id, case when v_self then 'orders.create' else 'tables.manage' end) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if o.status not in ('accepted', 'preparing', 'ready', 'served') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;
  if v_to is not null and not exists (select 1 from private.assignable_waiters(o.location_id) w where w.user_id = v_to) then
    raise exception 'INVALID_ASSIGNEE' using errcode = 'P0001';
  end if;
  if o.waiter_id is not distinct from v_to then
    return jsonb_build_object('orderId', v_order, 'waiterId', v_to);
  end if;
  update public.orders y set waiter_id = v_to where y.id = v_order;
  perform private.log_order_event(o.organization_id, o.location_id, v_order, null, null, 'waiter_assigned', null, null,
    jsonb_build_object('from_user_id', o.waiter_id, 'to_user_id', v_to));
  if not v_self then
    perform private.write_audit(o.organization_id, v_uid, 'order.waiter_assigned', 'order', v_order::text,
      jsonb_build_object('location_id', o.location_id, 'from_user_id', o.waiter_id, 'to_user_id', v_to));
  end if;
  return jsonb_build_object('orderId', v_order, 'waiterId', v_to);
end;
$$;

create or replace function public.list_assignable_waiters(location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc uuid := list_assignable_waiters.location_id;
  v_org uuid;
begin
  select l.organization_id into v_org from public.locations l where l.id = v_loc and l.is_active;
  if v_org is null
     or not public.has_permission(v_org, 'orders.view')
     or not public.has_location_access(v_loc) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId', w.user_id, 'displayName', w.display_name)
                                     order by w.display_name, w.user_id)
                   from private.assignable_waiters(v_loc) w), '[]'::jsonb);
end;
$$;

revoke execute on function
  public.move_order_to_table(uuid, uuid), public.merge_tables(uuid, uuid[]), public.unmerge_table(uuid, uuid),
  public.assign_order_waiter(uuid, uuid), public.list_assignable_waiters(uuid)
  from public, anon, authenticated;
grant execute on function
  public.move_order_to_table(uuid, uuid), public.merge_tables(uuid, uuid[]), public.unmerge_table(uuid, uuid),
  public.assign_order_waiter(uuid, uuid), public.list_assignable_waiters(uuid)
  to authenticated;
