-- MVM-T06 (M2 §6e): menu schema — kitchen stations, categories, items, variants, modifiers, location overrides.
--  * Same-org / same-location integrity is enforced by composite FKs, not by trusting the client.
--  * Money is bigint minor units (IDR: whole Rupiah). No numeric/float money anywhere.
--  * No client DELETE (no grant, no policy): soft delete via is_active = false.
--    Single exception: menu_item_modifier_groups is a pure link table (no history), so unlinking deletes the row.
--  * Menu is org-level (shared across locations); stations and overrides are per location.
--  * "Sold out today" is written only by set_item_sold_out() (clients have no column privilege on sold_out_until).
--  * Audit rows via AFTER triggers (private.write_audit, actor = auth.uid()); prices record from/to.
--  * get_public_menu() is the only anon read of the menu and returns a whitelist of fields.
-- Error contract: FORBIDDEN (42501) from the RPCs; duplicate active names surface as unique_violation (23505).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.kitchen_stations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  name             text not null,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kitchen_stations_name_len check (char_length(name) between 1 and 40),
  constraint kitchen_stations_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint kitchen_stations_id_location_unique unique (id, location_id)
);
create index kitchen_stations_organization_id_idx on public.kitchen_stations (organization_id);
create index kitchen_stations_location_id_idx on public.kitchen_stations (location_id);
create unique index kitchen_stations_location_name_active_key on public.kitchen_stations (location_id, lower(name)) where is_active;

create table public.menu_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  description      text,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint menu_categories_name_len check (char_length(name) between 1 and 60),
  constraint menu_categories_description_len check (description is null or char_length(description) <= 500),
  constraint menu_categories_id_org_unique unique (id, organization_id)
);
create index menu_categories_organization_id_idx on public.menu_categories (organization_id);
create unique index menu_categories_org_name_active_key on public.menu_categories (organization_id, lower(name)) where is_active;

create table public.menu_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  category_id      uuid not null,
  name             text not null,
  description      text,
  base_price       bigint not null,
  image_path       text,
  dietary_tags     text[] not null default '{}',
  is_published     boolean not null default false,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint menu_items_name_len check (char_length(name) between 1 and 80),
  constraint menu_items_description_len check (description is null or char_length(description) <= 500),
  constraint menu_items_price_nonneg check (base_price >= 0),
  constraint menu_items_image_path_format check (
    image_path is null or (image_path ~ '^[A-Za-z0-9/_.-]{1,255}$' and image_path !~ '\.\.' and image_path !~ '^/')),
  constraint menu_items_dietary_tags_valid check (
    dietary_tags <@ array['vegetarian', 'vegan', 'halal', 'spicy', 'contains_nuts', 'gluten_free']::text[]),
  constraint menu_items_category_org_fk foreign key (category_id, organization_id)
    references public.menu_categories (id, organization_id) on delete cascade,
  constraint menu_items_id_org_unique unique (id, organization_id)
);
create index menu_items_organization_id_idx on public.menu_items (organization_id);
create index menu_items_category_id_idx on public.menu_items (category_id);

create table public.item_variants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  item_id          uuid not null,
  name             text not null,
  price_delta      bigint not null default 0,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint item_variants_name_len check (char_length(name) between 1 and 40),
  -- price_delta may be negative; the final price >= 0 is enforced at order time (M3).
  constraint item_variants_item_org_fk foreign key (item_id, organization_id)
    references public.menu_items (id, organization_id) on delete cascade
);
create index item_variants_organization_id_idx on public.item_variants (organization_id);
create index item_variants_item_id_idx on public.item_variants (item_id);
create unique index item_variants_item_name_active_key on public.item_variants (item_id, lower(name)) where is_active;

create table public.modifier_groups (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  min_select       integer not null default 0,
  max_select       integer not null default 1,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint modifier_groups_name_len check (char_length(name) between 1 and 60),
  constraint modifier_groups_min_nonneg check (min_select >= 0),
  constraint modifier_groups_max_valid check (max_select >= 1 and max_select >= min_select),
  constraint modifier_groups_id_org_unique unique (id, organization_id)
);
create index modifier_groups_organization_id_idx on public.modifier_groups (organization_id);
create unique index modifier_groups_org_name_active_key on public.modifier_groups (organization_id, lower(name)) where is_active;

create table public.menu_item_modifier_groups (
  organization_id  uuid not null,
  item_id          uuid not null,
  group_id         uuid not null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  primary key (item_id, group_id),
  constraint mimg_item_org_fk foreign key (item_id, organization_id)
    references public.menu_items (id, organization_id) on delete cascade,
  constraint mimg_group_org_fk foreign key (group_id, organization_id)
    references public.modifier_groups (id, organization_id) on delete cascade
);
create index mimg_organization_id_idx on public.menu_item_modifier_groups (organization_id);
create index mimg_group_id_idx on public.menu_item_modifier_groups (group_id);

create table public.modifiers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  group_id         uuid not null,
  name             text not null,
  price_delta      bigint not null default 0,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint modifiers_name_len check (char_length(name) between 1 and 40),
  constraint modifiers_price_nonneg check (price_delta >= 0),
  constraint modifiers_group_org_fk foreign key (group_id, organization_id)
    references public.modifier_groups (id, organization_id) on delete cascade
);
create index modifiers_organization_id_idx on public.modifiers (organization_id);
create index modifiers_group_id_idx on public.modifiers (group_id);
create unique index modifiers_group_name_active_key on public.modifiers (group_id, lower(name)) where is_active;

create table public.location_menu_overrides (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  location_id         uuid not null,
  item_id             uuid not null,
  price_override      bigint,
  is_available        boolean not null default true,
  sold_out_until      timestamptz,
  kitchen_station_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lmo_price_nonneg check (price_override is null or price_override >= 0),
  constraint lmo_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint lmo_item_org_fk foreign key (item_id, organization_id)
    references public.menu_items (id, organization_id) on delete cascade,
  -- the station must live in the same location (MATCH SIMPLE: a null station is fine)
  constraint lmo_station_location_fk foreign key (kitchen_station_id, location_id)
    references public.kitchen_stations (id, location_id),
  constraint lmo_location_item_key unique (location_id, item_id)
);
create index lmo_organization_id_idx on public.location_menu_overrides (organization_id);
create index lmo_item_id_idx on public.location_menu_overrides (item_id);
create index lmo_station_id_idx on public.location_menu_overrides (kitchen_station_id);

create trigger kitchen_stations_set_updated_at before update on public.kitchen_stations
  for each row execute function private.set_updated_at();
create trigger menu_categories_set_updated_at before update on public.menu_categories
  for each row execute function private.set_updated_at();
create trigger menu_items_set_updated_at before update on public.menu_items
  for each row execute function private.set_updated_at();
create trigger item_variants_set_updated_at before update on public.item_variants
  for each row execute function private.set_updated_at();
create trigger modifier_groups_set_updated_at before update on public.modifier_groups
  for each row execute function private.set_updated_at();
create trigger modifiers_set_updated_at before update on public.modifiers
  for each row execute function private.set_updated_at();
create trigger lmo_set_updated_at before update on public.location_menu_overrides
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit. One generic trigger: <entity>.created / .updated / .deactivated / .reactivated, plus
-- .price_changed (from/to) and, for overrides, .availability_changed / .sold_out / .sold_out_cleared.
-- Metadata carries ids and names only.
-- ---------------------------------------------------------------------------
create or replace function private.audit_menu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_ent    text := tg_argv[0];
  v_new    jsonb := to_jsonb(new);
  v_old    jsonb;
  v_meta   jsonb;
  v_key    text;
  v_changed boolean := false;
begin
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'name', v_new -> 'name', 'location_id', v_new -> 'location_id', 'item_id', v_new -> 'item_id'));
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, v_actor, v_ent || '.created', v_ent, (v_new ->> 'id'), v_meta);
    if v_ent = 'menu_override' and (v_new ->> 'sold_out_until') is not null then
      perform private.write_audit(new.organization_id, v_actor, v_ent || '.sold_out', v_ent, (v_new ->> 'id'),
        v_meta || jsonb_build_object('until', v_new -> 'sold_out_until'));
    end if;
    return null;
  end if;
  v_old := to_jsonb(old);

  foreach v_key in array array['base_price', 'price_delta', 'price_override'] loop
    if v_new ? v_key and (v_new -> v_key) is distinct from (v_old -> v_key) then
      perform private.write_audit(new.organization_id, v_actor, v_ent || '.price_changed', v_ent, (v_new ->> 'id'),
        v_meta || jsonb_build_object('field', v_key, 'from', v_old -> v_key, 'to', v_new -> v_key));
    end if;
  end loop;

  if (v_old ->> 'is_active') = 'true' and (v_new ->> 'is_active') = 'false' then
    perform private.write_audit(new.organization_id, v_actor, v_ent || '.deactivated', v_ent, (v_new ->> 'id'), v_meta);
  elsif (v_old ->> 'is_active') = 'false' and (v_new ->> 'is_active') = 'true' then
    perform private.write_audit(new.organization_id, v_actor, v_ent || '.reactivated', v_ent, (v_new ->> 'id'), v_meta);
  end if;

  if v_ent = 'menu_override' then
    if v_new -> 'is_available' is distinct from v_old -> 'is_available' then
      perform private.write_audit(new.organization_id, v_actor, v_ent || '.availability_changed', v_ent, (v_new ->> 'id'),
        v_meta || jsonb_build_object('is_available', v_new -> 'is_available'));
    end if;
    if (v_old ->> 'sold_out_until') is null and (v_new ->> 'sold_out_until') is not null then
      perform private.write_audit(new.organization_id, v_actor, v_ent || '.sold_out', v_ent, (v_new ->> 'id'),
        v_meta || jsonb_build_object('until', v_new -> 'sold_out_until'));
    elsif (v_old ->> 'sold_out_until') is not null and (v_new ->> 'sold_out_until') is null then
      perform private.write_audit(new.organization_id, v_actor, v_ent || '.sold_out_cleared', v_ent, (v_new ->> 'id'), v_meta);
    end if;
    if v_new -> 'kitchen_station_id' is distinct from v_old -> 'kitchen_station_id' then
      v_changed := true;
    end if;
  else
    -- any other tracked column change (name, description, category, tags, publish flag, ...)
    for v_key in select k from jsonb_object_keys(v_new) k
                 where k not in ('updated_at', 'created_at', 'sort_order', 'is_active', 'base_price', 'price_delta', 'price_override')
    loop
      if (v_new -> v_key) is distinct from (v_old -> v_key) then v_changed := true; end if;
    end loop;
  end if;
  if v_changed then
    perform private.write_audit(new.organization_id, v_actor, v_ent || '.updated', v_ent, (v_new ->> 'id'), v_meta);
  end if;
  return null;
end;
$$;

create trigger kitchen_stations_audit after insert or update on public.kitchen_stations
  for each row execute function private.audit_menu('kitchen_station');
create trigger menu_categories_audit after insert or update on public.menu_categories
  for each row execute function private.audit_menu('menu_category');
create trigger menu_items_audit after insert or update on public.menu_items
  for each row execute function private.audit_menu('menu_item');
create trigger item_variants_audit after insert or update on public.item_variants
  for each row execute function private.audit_menu('item_variant');
create trigger modifier_groups_audit after insert or update on public.modifier_groups
  for each row execute function private.audit_menu('modifier_group');
create trigger modifiers_audit after insert or update on public.modifiers
  for each row execute function private.audit_menu('modifier');
create trigger lmo_audit after insert or update on public.location_menu_overrides
  for each row execute function private.audit_menu('menu_override');

-- ---------------------------------------------------------------------------
-- RLS + privileges
-- ---------------------------------------------------------------------------
alter table public.kitchen_stations        enable row level security;
alter table public.menu_categories         enable row level security;
alter table public.menu_items              enable row level security;
alter table public.item_variants           enable row level security;
alter table public.modifier_groups         enable row level security;
alter table public.menu_item_modifier_groups enable row level security;
alter table public.modifiers               enable row level security;
alter table public.location_menu_overrides enable row level security;

-- Org-level menu tables: any active org member reads; menu.manage writes.
do $$
declare t text;
begin
  foreach t in array array['menu_categories', 'menu_items', 'item_variants', 'modifier_groups', 'modifiers'] loop
    execute format($f$create policy %1$s_select on public.%1$s for select to authenticated
      using (public.is_org_member(organization_id) or public.is_platform_admin())$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.has_permission(organization_id, 'menu.manage'))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated
      using (public.has_permission(organization_id, 'menu.manage'))
      with check (public.has_permission(organization_id, 'menu.manage'))$f$, t);
  end loop;
end $$;

create policy mimg_select on public.menu_item_modifier_groups for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy mimg_insert on public.menu_item_modifier_groups for insert to authenticated
  with check (public.has_permission(organization_id, 'menu.manage'));
create policy mimg_update on public.menu_item_modifier_groups for update to authenticated
  using (public.has_permission(organization_id, 'menu.manage'))
  with check (public.has_permission(organization_id, 'menu.manage'));
create policy mimg_delete on public.menu_item_modifier_groups for delete to authenticated
  using (public.has_permission(organization_id, 'menu.manage'));

-- Per-location tables: location access to read; menu.manage + location access to write.
create policy kitchen_stations_select on public.kitchen_stations for select to authenticated
  using (public.has_location_access(location_id) or public.is_platform_admin());
create policy kitchen_stations_insert on public.kitchen_stations for insert to authenticated
  with check (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id));
create policy kitchen_stations_update on public.kitchen_stations for update to authenticated
  using (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id))
  with check (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id));

create policy lmo_select on public.location_menu_overrides for select to authenticated
  using (public.has_location_access(location_id) or public.is_platform_admin());
create policy lmo_insert on public.location_menu_overrides for insert to authenticated
  with check (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id));
create policy lmo_update on public.location_menu_overrides for update to authenticated
  using (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id))
  with check (public.has_permission(organization_id, 'menu.manage') and public.has_location_access(location_id));

-- Column grants: organization_id / location_id / item_id are insert-only; sold_out_until is never client-writable.
grant select on public.kitchen_stations, public.menu_categories, public.menu_items, public.item_variants,
  public.modifier_groups, public.menu_item_modifier_groups, public.modifiers, public.location_menu_overrides to authenticated;

grant insert (organization_id, location_id, name, sort_order, is_active) on public.kitchen_stations to authenticated;
grant update (name, sort_order, is_active) on public.kitchen_stations to authenticated;

grant insert (organization_id, name, description, sort_order, is_active) on public.menu_categories to authenticated;
grant update (name, description, sort_order, is_active) on public.menu_categories to authenticated;

grant insert (organization_id, category_id, name, description, base_price, image_path, dietary_tags, is_published, sort_order, is_active)
  on public.menu_items to authenticated;
grant update (category_id, name, description, base_price, image_path, dietary_tags, is_published, sort_order, is_active)
  on public.menu_items to authenticated;

grant insert (organization_id, item_id, name, price_delta, sort_order, is_active) on public.item_variants to authenticated;
grant update (name, price_delta, sort_order, is_active) on public.item_variants to authenticated;

grant insert (organization_id, name, min_select, max_select, sort_order, is_active) on public.modifier_groups to authenticated;
grant update (name, min_select, max_select, sort_order, is_active) on public.modifier_groups to authenticated;

grant insert (organization_id, item_id, group_id, sort_order) on public.menu_item_modifier_groups to authenticated;
grant update (sort_order) on public.menu_item_modifier_groups to authenticated;
grant delete on public.menu_item_modifier_groups to authenticated;

grant insert (organization_id, group_id, name, price_delta, sort_order, is_active) on public.modifiers to authenticated;
grant update (name, price_delta, sort_order, is_active) on public.modifiers to authenticated;

grant insert (organization_id, location_id, item_id, price_override, is_available, kitchen_station_id)
  on public.location_menu_overrides to authenticated;
grant update (price_override, is_available, kitchen_station_id) on public.location_menu_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: set_item_sold_out(location_id, item_id, sold_out) -> sold_out_until (null when cleared)
-- Allowed for menu.manage OR orders.create (cashier/waiter) with access to the location. Sets the end of the
-- day in the LOCATION's timezone. Unknown ids and no-permission look the same (no existence oracle).
-- ---------------------------------------------------------------------------
create or replace function public.set_item_sold_out(location_id uuid, item_id uuid, sold_out boolean)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_loc   uuid := set_item_sold_out.location_id;
  v_item  uuid := set_item_sold_out.item_id;
  v_org   uuid;
  v_tz    text;
  v_until timestamptz;
begin
  select l.organization_id, l.timezone into v_org, v_tz
  from public.locations l where l.id = v_loc and l.is_active;
  if v_org is null
     or not (public.has_permission(v_org, 'menu.manage') or public.has_permission(v_org, 'orders.create'))
     or not public.has_location_access(v_loc)
     or not exists (select 1 from public.menu_items i where i.id = v_item and i.organization_id = v_org and i.is_active) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if sold_out is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if sold_out then
    -- start of the next local day, as an instant
    v_until := (((now() at time zone v_tz)::date + 1)::timestamp) at time zone v_tz;
    insert into public.location_menu_overrides as o (organization_id, location_id, item_id, sold_out_until)
    values (v_org, v_loc, v_item, v_until)
    on conflict on constraint lmo_location_item_key do update set sold_out_until = excluded.sold_out_until;
    return v_until;
  end if;

  update public.location_menu_overrides o set sold_out_until = null
  where o.location_id = v_loc and o.item_id = v_item;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_public_menu(org_slug, location_id) -> jsonb (anon). Whitelisted fields only.
-- Returns null for unknown slug, suspended/non-active org, inactive location, or a location of another org.
-- Only published, active items that are available right now (not switched off, not sold out) appear,
-- with the effective price (override or base) and the active variants / modifier groups.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_menu(org_slug text, location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(get_public_menu.org_slug));
  v_loc  uuid := get_public_menu.location_id;
  v_org  uuid;
  v_cur  text;
  v_out  jsonb;
begin
  select o.id, l.currency into v_org, v_cur
  from public.organizations o
  join public.locations l on l.organization_id = o.id and l.id = v_loc and l.is_active
  where o.slug = v_slug and o.status = 'active';
  if v_org is null then
    return null;
  end if;

  select jsonb_build_object(
    'currency', v_cur,
    'categories', coalesce(jsonb_agg(cat.obj order by cat.sort_order, cat.name), '[]'::jsonb))
  into v_out
  from (
    select c.sort_order, c.name,
      jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'items', items.arr) as obj
    from public.menu_categories c
    cross join lateral (
      select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'description', i.description,
          'price', coalesce(o.price_override, i.base_price),
          'image_path', i.image_path,
          'dietary_tags', to_jsonb(i.dietary_tags),
          'variants', coalesce((
            select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_delta', v.price_delta)
                             order by v.sort_order, v.name)
            from public.item_variants v where v.item_id = i.id and v.is_active), '[]'::jsonb),
          'modifier_groups', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'min_select', g.min_select, 'max_select', g.max_select,
                'modifiers', (select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price_delta', m.price_delta)
                                               order by m.sort_order, m.name)
                              from public.modifiers m where m.group_id = g.id and m.is_active))
              order by l.sort_order, g.sort_order, g.name)
            from public.menu_item_modifier_groups l
            join public.modifier_groups g on g.id = l.group_id and g.is_active
            where l.item_id = i.id
              and exists (select 1 from public.modifiers m2 where m2.group_id = g.id and m2.is_active)), '[]'::jsonb)
        ) order by i.sort_order, i.name) as arr
      from public.menu_items i
      left join public.location_menu_overrides o on o.item_id = i.id and o.location_id = v_loc
      where i.category_id = c.id and i.organization_id = v_org and i.is_active and i.is_published
        and coalesce(o.is_available, true)
        and (o.sold_out_until is null or o.sold_out_until <= now())
    ) items
    where c.organization_id = v_org and c.is_active and items.arr is not null
  ) cat;
  return v_out;
end;
$$;

revoke execute on function public.set_item_sold_out(uuid, uuid, boolean), public.get_public_menu(text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_item_sold_out(uuid, uuid, boolean) to authenticated;
grant execute on function public.get_public_menu(text, uuid) to anon, authenticated;
-- private.* functions stay uncallable by clients (default privileges revoke execute).
