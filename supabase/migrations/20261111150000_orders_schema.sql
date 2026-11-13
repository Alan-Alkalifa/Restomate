-- MSC-T04 (M3 §7): orders, order rounds/items/modifiers/discounts/events, counters, kitchen tickets.
-- Contract: docs/contracts/orders.md. Clients can only READ (RLS + column grants); every write goes through the
-- security-definer RPCs in the next migration. Error contract: see that file.

-- tables(id, location_id) is the FK target for orders.table_id
alter table public.tables add constraint tables_id_location_unique unique (id, location_id);

-- ---------------------------------------------------------------------------
-- order_counters: per (location, local business date, kind) gapless daily numbers; locked FOR UPDATE by upsert
-- ---------------------------------------------------------------------------
create table public.order_counters (
  location_id    uuid not null references public.locations (id) on delete cascade,
  business_date  date not null,
  kind           text not null,
  last_value     integer not null default 0,
  primary key (location_id, business_date, kind),
  constraint order_counters_kind_valid check (kind in ('order', 'ticket'))
);

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  order_number     integer not null,
  business_date    date not null,
  channel          text not null,
  status           text not null default 'placed',
  table_id         uuid,
  opened_by        uuid references auth.users (id) on delete set null,
  customer_name    text,
  guest_count      integer,
  round_count      integer not null default 0,
  currency         char(3) not null,
  subtotal         bigint not null default 0,
  discount_total   bigint not null default 0,
  cancel_reason    text,
  placed_at        timestamptz not null default now(),
  served_at        timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint orders_channel_valid check (channel in ('dine_in', 'takeaway', 'qr', 'online')),
  constraint orders_status_valid check (status in
    ('draft', 'placed', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled')),
  constraint orders_dine_in_table check (channel <> 'dine_in' or table_id is not null),
  constraint orders_takeaway_no_table check (channel <> 'takeaway' or table_id is null),
  constraint orders_customer_name_len check (customer_name is null or char_length(customer_name) between 1 and 60),
  constraint orders_guest_count_range check (guest_count is null or guest_count between 1 and 50),
  constraint orders_round_count_nonneg check (round_count >= 0),
  constraint orders_subtotal_nonneg check (subtotal >= 0),
  constraint orders_discount_range check (discount_total >= 0 and discount_total <= subtotal),
  constraint orders_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint orders_table_location_fk foreign key (table_id, location_id)
    references public.tables (id, location_id),
  constraint orders_id_org_unique unique (id, organization_id),
  constraint orders_id_location_unique unique (id, location_id),
  constraint orders_number_day_key unique (location_id, business_date, order_number)
);
create index orders_org_location_status_idx on public.orders (organization_id, location_id, status);
create index orders_org_location_created_idx on public.orders (organization_id, location_id, created_at);
create index orders_table_id_idx on public.orders (table_id);
-- one open order per table: also makes "cancel with a sibling open order" impossible
create unique index orders_one_open_per_table_key on public.orders (table_id)
  where table_id is not null and status not in ('completed', 'cancelled');

create table public.order_rounds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  order_id         uuid not null,
  round_no         integer not null,
  client_ref       uuid not null,
  request_hash     text not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint order_rounds_round_no_pos check (round_no >= 1),
  constraint order_rounds_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade,
  constraint order_rounds_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint order_rounds_order_round_key unique (order_id, round_no),
  constraint order_rounds_client_ref_key unique (organization_id, client_ref),
  constraint order_rounds_id_org_unique unique (id, organization_id)
);
create index order_rounds_order_id_idx on public.order_rounds (order_id);
create index order_rounds_location_id_idx on public.order_rounds (location_id);

-- kitchen_stations needs (id, location_id) unique: exists (kitchen_stations_id_location_unique)
create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  location_id         uuid not null,
  order_id            uuid not null,
  round_id            uuid not null,
  menu_item_id        uuid references public.menu_items (id) on delete set null,
  variant_id          uuid references public.item_variants (id) on delete set null,
  item_name           text not null,
  variant_name        text,
  unit_price          bigint not null,
  modifiers_total     bigint not null default 0,
  quantity            integer not null,
  line_total          bigint not null,
  tax_rate_bps        integer not null,
  note                text,
  kitchen_station_id  uuid,
  status              text not null default 'active',
  voided_at           timestamptz,
  voided_by           uuid references auth.users (id) on delete set null,
  void_reason         text,
  created_at          timestamptz not null default now(),
  constraint order_items_money_nonneg check (unit_price >= 0 and modifiers_total >= 0 and line_total >= 0),
  constraint order_items_quantity_range check (quantity between 1 and 99),
  constraint order_items_note_len check (note is null or char_length(note) <= 200),
  constraint order_items_tax_range check (tax_rate_bps between 0 and 10000),
  constraint order_items_status_valid check (status in ('active', 'void')),
  constraint order_items_void_fields check (
    (status = 'void') = (voided_at is not null and void_reason is not null)),
  constraint order_items_void_reason_len check (void_reason is null or char_length(void_reason) between 3 and 200),
  constraint order_items_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade,
  constraint order_items_round_fk foreign key (round_id, organization_id)
    references public.order_rounds (id, organization_id) on delete cascade,
  constraint order_items_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint order_items_station_fk foreign key (kitchen_station_id, location_id)
    references public.kitchen_stations (id, location_id),
  constraint order_items_id_org_unique unique (id, organization_id)
);
create index order_items_organization_id_idx on public.order_items (organization_id);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_round_id_idx on public.order_items (round_id);
create index order_items_location_id_idx on public.order_items (location_id);

create table public.order_item_modifiers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  location_id        uuid not null,
  order_item_id      uuid not null,
  modifier_id        uuid references public.modifiers (id) on delete set null,
  modifier_group_id  uuid references public.modifier_groups (id) on delete set null,
  name               text not null,
  price_delta        bigint not null default 0,
  constraint order_item_modifiers_price_nonneg check (price_delta >= 0),
  constraint order_item_modifiers_item_fk foreign key (order_item_id, organization_id)
    references public.order_items (id, organization_id) on delete cascade
);
create index order_item_modifiers_organization_id_idx on public.order_item_modifiers (organization_id);
create index order_item_modifiers_item_idx on public.order_item_modifiers (order_item_id);
create index order_item_modifiers_location_idx on public.order_item_modifiers (location_id);

create table public.order_discounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  order_id         uuid not null,
  amount           bigint not null,
  reason           text not null,
  applied_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references auth.users (id) on delete set null,
  remove_reason    text,
  constraint order_discounts_amount_pos check (amount > 0),
  constraint order_discounts_reason_len check (char_length(reason) between 3 and 200),
  constraint order_discounts_remove_fields check ((removed_at is null) = (remove_reason is null)),
  constraint order_discounts_remove_reason_len check (remove_reason is null or char_length(remove_reason) between 3 and 200),
  constraint order_discounts_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade
);
create index order_discounts_organization_id_idx on public.order_discounts (organization_id);
create index order_discounts_order_id_idx on public.order_discounts (order_id);
create index order_discounts_location_id_idx on public.order_discounts (location_id);

create table public.kitchen_tickets (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  location_id         uuid not null,
  order_id            uuid not null,
  round_id            uuid not null,
  kitchen_station_id  uuid not null,
  ticket_number       integer not null,
  business_date       date not null,
  status              text not null default 'new',
  accepted_at         timestamptz,
  ready_at            timestamptz,
  bumped_at           timestamptz,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint kitchen_tickets_status_valid check (status in ('new', 'in_progress', 'ready', 'bumped')),
  constraint kitchen_tickets_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade,
  constraint kitchen_tickets_round_fk foreign key (round_id, organization_id)
    references public.order_rounds (id, organization_id) on delete cascade,
  constraint kitchen_tickets_station_fk foreign key (kitchen_station_id, location_id)
    references public.kitchen_stations (id, location_id),
  constraint kitchen_tickets_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint kitchen_tickets_round_station_key unique (round_id, kitchen_station_id),
  constraint kitchen_tickets_number_day_key unique (location_id, business_date, ticket_number),
  constraint kitchen_tickets_id_org_unique unique (id, organization_id)
);
create index kitchen_tickets_organization_id_idx on public.kitchen_tickets (organization_id);
create index kitchen_tickets_location_status_created_idx on public.kitchen_tickets (location_id, status, created_at);
create index kitchen_tickets_order_id_idx on public.kitchen_tickets (order_id);

create table public.kitchen_ticket_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  ticket_id        uuid not null,
  order_item_id    uuid not null,
  item_name        text not null,
  variant_name     text,
  quantity         integer not null,
  modifiers_text   text not null default '',
  note             text,
  status           text not null default 'pending',
  constraint kitchen_ticket_items_status_valid check (status in ('pending', 'ready', 'void')),
  constraint kitchen_ticket_items_ticket_fk foreign key (ticket_id, organization_id)
    references public.kitchen_tickets (id, organization_id) on delete cascade,
  constraint kitchen_ticket_items_order_item_fk foreign key (order_item_id, organization_id)
    references public.order_items (id, organization_id) on delete cascade,
  constraint kitchen_ticket_items_ticket_item_key unique (ticket_id, order_item_id)
);
create index kitchen_ticket_items_organization_id_idx on public.kitchen_ticket_items (organization_id);
create index kitchen_ticket_items_ticket_id_idx on public.kitchen_ticket_items (ticket_id);
create index kitchen_ticket_items_order_item_idx on public.kitchen_ticket_items (order_item_id);
create index kitchen_ticket_items_location_idx on public.kitchen_ticket_items (location_id);

create table public.order_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  location_id      uuid not null,
  order_id         uuid not null,
  order_item_id    uuid,
  ticket_id        uuid,
  actor_id         uuid,
  event_type       text not null,
  from_status      text,
  to_status        text,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint order_events_type_valid check (event_type in
    ('round_sent', 'order_status_changed', 'item_voided', 'order_cancelled', 'discount_applied',
     'discount_removed', 'kot_status_changed', 'table_status_changed')),
  constraint order_events_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade
);
create index order_events_organization_id_idx on public.order_events (organization_id);
create index order_events_order_created_idx on public.order_events (order_id, created_at);
create index order_events_location_id_idx on public.order_events (location_id);

create trigger orders_set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();
create trigger kitchen_tickets_set_updated_at before update on public.kitchen_tickets
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transition tables (SQL mirror of lib/orders/transitions.ts; pgTAP walks the matrix)
-- ---------------------------------------------------------------------------
create or replace function private.order_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'draft'     then p_to in ('placed', 'cancelled')
    when 'placed'    then p_to in ('accepted', 'cancelled')
    when 'accepted'  then p_to in ('preparing', 'cancelled')
    when 'preparing' then p_to in ('ready', 'cancelled')
    when 'ready'     then p_to in ('served', 'cancelled')
    when 'served'    then p_to in ('completed')
    else false
  end;
$$;

create or replace function private.kot_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'new'         then p_to = 'in_progress'
    when 'in_progress' then p_to = 'ready'
    when 'ready'       then p_to = 'bumped'
    else false
  end;
$$;

create or replace function private.table_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'available'      then p_to = 'reserved' or p_to = 'occupied'
    when 'reserved'       then p_to = 'occupied'
    when 'occupied'       then p_to = 'needs_cleaning'
    when 'needs_cleaning' then p_to = 'available'
    else false
  end;
$$;

-- The guards reject any status change the tables above reject. Two narrow, session-local exceptions that only the
-- RPCs set (set_config(..., true)): add-on rounds (ready -> preparing) and system closes (any ticket -> bumped).
create or replace function private.orders_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not private.order_transition_ok(old.status, new.status)
     and not (old.status = 'ready' and new.status = 'preparing'
              and coalesce(current_setting('app.orders_addon', true), '') = '1') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end;
$$;
create trigger orders_status_guard before update of status on public.orders
  for each row execute function private.orders_status_guard();

create or replace function private.kitchen_tickets_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not private.kot_transition_ok(old.status, new.status)
     and not (new.status = 'bumped' and old.status <> 'bumped'
              and coalesce(current_setting('app.orders_system', true), '') = '1') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end;
$$;
create trigger kitchen_tickets_status_guard before update of status on public.kitchen_tickets
  for each row execute function private.kitchen_tickets_status_guard();

-- Append-only audit trail: nobody updates or deletes events (cascade from orders still works for tenant deletion).
create or replace function private.order_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_events is append-only' using errcode = 'P0001';
end;
$$;
create trigger order_events_no_update before update on public.order_events
  for each row execute function private.order_events_immutable();

-- ---------------------------------------------------------------------------
-- RLS + privileges: read only. No INSERT/UPDATE/DELETE grant and no write policy for anyone.
-- ---------------------------------------------------------------------------
alter table public.order_counters       enable row level security;
alter table public.orders               enable row level security;
alter table public.order_rounds         enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_discounts      enable row level security;
alter table public.order_events         enable row level security;
alter table public.kitchen_tickets      enable row level security;
alter table public.kitchen_ticket_items enable row level security;
-- order_counters: explicit deny policy and no grant: reachable only through the definer RPCs.
create policy order_counters_deny on public.order_counters for all to authenticated using (false) with check (false);

create policy orders_select on public.orders
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
create policy order_rounds_select on public.order_rounds
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
create policy order_items_select on public.order_items
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
create policy order_item_modifiers_select on public.order_item_modifiers
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
create policy order_discounts_select on public.order_discounts
  for select to authenticated
  using (public.has_permission(organization_id, 'orders.view') and public.has_location_access(location_id));
create policy order_events_select on public.order_events
  for select to authenticated
  using ((public.has_permission(organization_id, 'orders.void') or public.has_permission(organization_id, 'reports.view'))
         and public.has_location_access(location_id));
create policy kitchen_tickets_select on public.kitchen_tickets
  for select to authenticated
  using (public.has_permission(organization_id, 'kitchen.view') and public.has_location_access(location_id));
create policy kitchen_ticket_items_select on public.kitchen_ticket_items
  for select to authenticated
  using (public.has_permission(organization_id, 'kitchen.view') and public.has_location_access(location_id));

grant select on public.orders, public.order_items, public.order_item_modifiers, public.order_discounts,
  public.order_events, public.kitchen_tickets, public.kitchen_ticket_items to authenticated;
-- request_hash is internal
grant select (id, organization_id, location_id, order_id, round_no, client_ref, created_by, created_at)
  on public.order_rounds to authenticated;
