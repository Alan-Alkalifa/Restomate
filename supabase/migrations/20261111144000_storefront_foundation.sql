-- MCS-T02 (M4 §8): storefront foundation. Contract: docs/contracts/storefront.md.
-- location_ordering_settings (one row per location, created with the location), location_hours (weekday minute
-- intervals, no overlaps), the rule "online pickup needs hours", the public reads get_public_location_info and
-- get_pickup_slots, and location ids in get_storefront. Guest submissions, requests and the guest RPCs are MCS-T03.
-- Error contract (P0001 unless noted; the message is the code): FORBIDDEN (42501), INVALID_INPUT (22023), HOURS_REQUIRED.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- location_ordering_settings
-- ---------------------------------------------------------------------------
create table public.location_ordering_settings (
  location_id                 uuid primary key,
  organization_id             uuid not null,
  qr_enabled                  boolean not null default true,
  online_enabled              boolean not null default false,
  accepting_orders            boolean not null default true,
  auto_accept_qr              boolean not null default false,
  auto_accept_online          boolean not null default false,
  pickup_lead_minutes         integer not null default 20,
  pickup_slot_minutes         integer not null default 15,
  pickup_max_orders_per_slot  integer,
  min_order_amount            bigint not null default 0,
  pending_ttl_minutes         integer not null default 15,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint los_lead_range check (pickup_lead_minutes between 5 and 240),
  constraint los_slot_range check (pickup_slot_minutes between 5 and 60),
  constraint los_capacity_range check (pickup_max_orders_per_slot is null or pickup_max_orders_per_slot between 1 and 200),
  constraint los_min_order_range check (min_order_amount between 0 and 1000000000000),
  constraint los_ttl_range check (pending_ttl_minutes between 5 and 60),
  constraint los_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade
);
create index los_organization_id_idx on public.location_ordering_settings (organization_id);
create trigger los_set_updated_at before update on public.location_ordering_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- location_hours: weekday minute intervals in the location's timezone (guest channels only)
-- ---------------------------------------------------------------------------
create table public.location_hours (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  day_of_week      smallint not null,
  opens_min        integer not null,
  closes_min       integer not null,
  created_at       timestamptz not null default now(),
  constraint lh_day_range check (day_of_week between 0 and 6),
  constraint lh_minutes_range check (opens_min between 0 and 1439 and closes_min between 1 and 1440 and opens_min < closes_min),
  constraint lh_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  -- intervals of one location never overlap on the same weekday (a boundary may touch: [10:00,14:00) and [14:00,18:00))
  constraint lh_no_overlap exclude using gist (
    location_id with =, day_of_week with =, int4range(opens_min, closes_min) with &&)
);
create index lh_organization_id_idx on public.location_hours (organization_id);
create index lh_location_idx on public.location_hours (location_id, day_of_week);

-- A default settings row for every new location, and one for every existing location.
create or replace function private.locations_default_ordering_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.location_ordering_settings (location_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (location_id) do nothing;
  return new;
end;
$$;
create trigger locations_default_ordering_settings after insert on public.locations
  for each row execute function private.locations_default_ordering_settings();

insert into public.location_ordering_settings (location_id, organization_id)
select l.id, l.organization_id from public.locations l
on conflict (location_id) do nothing;

-- ---------------------------------------------------------------------------
-- Online pickup needs hours (the settings action validates first and gives a field error; these are the backstops)
-- ---------------------------------------------------------------------------
create or replace function private.los_online_requires_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.online_enabled and not exists (select 1 from public.location_hours h where h.location_id = new.location_id) then
    raise exception 'HOURS_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger los_online_requires_hours before insert or update of online_enabled on public.location_ordering_settings
  for each row execute function private.los_online_requires_hours();

-- Deleting the LAST hours row of an online-enabled location is refused. save_location_hours replaces the whole list
-- and sets app.hours_replace for its own transaction (it checks the final list itself). A cascade from a deleted
-- location is not blocked: the location row is already gone when the cascade runs.
create or replace function private.lh_keep_hours_for_online()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.hours_replace', true), '') = '1' then
    return old;
  end if;
  if exists (select 1 from public.locations l where l.id = old.location_id)
     and exists (select 1 from public.location_ordering_settings s where s.location_id = old.location_id and s.online_enabled)
     and not exists (select 1 from public.location_hours h where h.location_id = old.location_id and h.id <> old.id) then
    raise exception 'HOURS_REQUIRED' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger lh_keep_hours_for_online before delete on public.location_hours
  for each row execute function private.lh_keep_hours_for_online();

-- ---------------------------------------------------------------------------
-- RLS + privileges
--   settings: members with location access read; locations.manage updates (column grants); no insert/delete grant
--   hours:    members with location access read; writes only through save_location_hours (locations.manage)
-- ---------------------------------------------------------------------------
alter table public.location_ordering_settings enable row level security;
alter table public.location_hours enable row level security;

create policy los_select on public.location_ordering_settings
  for select to authenticated using (public.has_location_access(location_id));
create policy los_update on public.location_ordering_settings
  for update to authenticated
  using (public.has_permission(organization_id, 'locations.manage') and public.has_location_access(location_id))
  with check (public.has_permission(organization_id, 'locations.manage') and public.has_location_access(location_id));
create policy lh_select on public.location_hours
  for select to authenticated using (public.has_location_access(location_id));

revoke all on public.location_ordering_settings, public.location_hours from anon, authenticated;
grant select on public.location_ordering_settings, public.location_hours to authenticated;
grant update (qr_enabled, online_enabled, accepting_orders, auto_accept_qr, auto_accept_online, pickup_lead_minutes,
              pickup_slot_minutes, pickup_max_orders_per_slot, min_order_amount, pending_ttl_minutes)
  on public.location_ordering_settings to authenticated;

-- ---------------------------------------------------------------------------
-- save_location_hours(location_id, intervals): replace the whole list atomically
--   intervals = [{ "day": 0..6, "opensMin": 0..1439, "closesMin": 1..1440 }], at most 28, no overlaps
-- ---------------------------------------------------------------------------
create or replace function public.save_location_hours(location_id uuid, intervals jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_loc   uuid := save_location_hours.location_id;
  v_iv    jsonb := save_location_hours.intervals;
  v_org   uuid;
  el      jsonb;
  v_key   text;
  n       integer;
begin
  select l.organization_id into v_org from public.locations l where l.id = v_loc;
  if v_org is null
     or not public.has_permission(v_org, 'locations.manage')
     or not public.has_location_access(v_loc) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_iv is null or jsonb_typeof(v_iv) <> 'array' or jsonb_array_length(v_iv) > 28 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  n := jsonb_array_length(v_iv);
  for el in select * from jsonb_array_elements(v_iv) loop
    if jsonb_typeof(el) <> 'object' then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(el) loop
      if v_key not in ('day', 'opensMin', 'closesMin') then
        raise exception 'INVALID_INPUT' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(el -> 'day') <> 'number' or jsonb_typeof(el -> 'opensMin') <> 'number' or jsonb_typeof(el -> 'closesMin') <> 'number'
       or (el ->> 'day') !~ '^[0-6]$' or (el ->> 'opensMin') !~ '^\d{1,4}$' or (el ->> 'closesMin') !~ '^\d{1,4}$'
       or (el ->> 'opensMin')::int > 1439 or (el ->> 'closesMin')::int not between 1 and 1440
       or (el ->> 'opensMin')::int >= (el ->> 'closesMin')::int then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
  end loop;
  if n = 0 and exists (select 1 from public.location_ordering_settings s where s.location_id = v_loc and s.online_enabled) then
    raise exception 'HOURS_REQUIRED' using errcode = 'P0001';
  end if;

  perform set_config('app.hours_replace', '1', true);
  delete from public.location_hours h where h.location_id = v_loc;
  begin
    insert into public.location_hours (organization_id, location_id, day_of_week, opens_min, closes_min)
    select v_org, v_loc, (e ->> 'day')::smallint, (e ->> 'opensMin')::int, (e ->> 'closesMin')::int
    from jsonb_array_elements(v_iv) e;
  exception when exclusion_violation then
    perform set_config('app.hours_replace', '', true);
    raise exception 'INVALID_INPUT' using errcode = '22023', detail = 'overlap';
  end;
  perform set_config('app.hours_replace', '', true);
  perform private.write_audit(v_org, (select auth.uid()), 'location.hours_saved', 'location', v_loc::text,
    jsonb_build_object('intervals', n));
  return jsonb_build_object('locationId', v_loc, 'count', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Time logic, parameterised by the instant so it is testable (the public functions pass now())
-- ---------------------------------------------------------------------------
create or replace function private.org_has_feature(p_org uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s join public.packages p on p.id = s.package_id
    where s.organization_id = p_org and s.status in ('trialing', 'active', 'past_due') and p_feature = any (p.features));
$$;

-- Open at this instant in the location's timezone? A location with NO hours rows is open (QR is not hour-limited).
create or replace function private.location_open_at(p_loc uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_local timestamp;
  v_dow   integer;
  v_min   integer;
begin
  select l.timezone into v_tz from public.locations l where l.id = p_loc;
  if v_tz is null then return false; end if;
  if not exists (select 1 from public.location_hours h where h.location_id = p_loc) then return true; end if;
  v_local := p_at at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  return exists (select 1 from public.location_hours h
                  where h.location_id = p_loc and h.day_of_week = v_dow and h.opens_min <= v_min and v_min < h.closes_min);
end;
$$;

-- Up to 24 upcoming pickup times TODAY (location-local day), on the slot grid, at least the lead time away and inside
-- an hours interval. Empty when online ordering is off or the location has no hours.
create or replace function private.pickup_slots_at(p_loc uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_s     public.location_ordering_settings%rowtype;
  v_date  date;
  v_out   jsonb;
begin
  select l.timezone into v_tz from public.locations l where l.id = p_loc and l.is_active;
  select * into v_s from public.location_ordering_settings s where s.location_id = p_loc;
  if v_tz is null or not found or not v_s.online_enabled
     or not exists (select 1 from public.location_hours h where h.location_id = p_loc) then
    return '[]'::jsonb;
  end if;
  v_date := (p_now at time zone v_tz)::date;
  select coalesce(jsonb_agg(to_char(q.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') order by q.ts), '[]'::jsonb)
  into v_out
  from (
    select c.ts
    from (
      select ((v_date + (m * interval '1 minute')) at time zone v_tz) as ts, m
      from generate_series(0, 1439, v_s.pickup_slot_minutes) m
    ) c
    where c.ts >= p_now + (v_s.pickup_lead_minutes * interval '1 minute')
      and exists (select 1 from public.location_hours h
                   where h.location_id = p_loc
                     and h.day_of_week = extract(dow from v_date)::int
                     and h.opens_min <= c.m and c.m < h.closes_min)
    order by c.ts
    limit 24
  ) q;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public reads (anon). Whitelisted fields only; null for anything not public.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_location_info(org_slug text, location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug  text := lower(btrim(get_public_location_info.org_slug));
  v_loc   uuid := get_public_location_info.location_id;
  l       public.locations%rowtype;
  v_org   public.organizations%rowtype;
  s       public.location_ordering_settings%rowtype;
  v_has_hours boolean;
  v_feature   boolean;
begin
  select o.* into v_org from public.organizations o where o.slug = v_slug and o.status = 'active';
  if not found then return null; end if;
  select x.* into l from public.locations x where x.id = v_loc and x.organization_id = v_org.id and x.is_active;
  if not found then return null; end if;
  select * into s from public.location_ordering_settings z where z.location_id = v_loc;
  v_has_hours := exists (select 1 from public.location_hours h where h.location_id = v_loc);
  v_feature := private.org_has_feature(v_org.id, 'qr_ordering');

  return jsonb_build_object(
    'name', l.name, 'currency', l.currency, 'timezone', l.timezone,
    'address', l.address, 'city', l.city, 'phone', l.phone,
    'taxRateBps', l.tax_rate_bps, 'serviceChargeBps', l.service_charge_bps, 'taxOnServiceCharge', l.tax_on_service_charge,
    'hours', coalesce((select jsonb_agg(jsonb_build_object(
        'day', h.day_of_week,
        'opens', lpad((h.opens_min / 60)::text, 2, '0') || ':' || lpad((h.opens_min % 60)::text, 2, '0'),
        'closes', lpad((h.closes_min / 60)::text, 2, '0') || ':' || lpad((h.closes_min % 60)::text, 2, '0'))
        order by h.day_of_week, h.opens_min)
      from public.location_hours h where h.location_id = v_loc), '[]'::jsonb),
    'openNow', private.location_open_at(v_loc, now()),
    'ordering', jsonb_build_object(
      'qr', v_feature and coalesce(s.qr_enabled, false),
      'online', v_feature and coalesce(s.online_enabled, false) and v_has_hours,
      'accepting', coalesce(s.accepting_orders, false)),
    'minOrderAmount', coalesce(s.min_order_amount, 0),
    'pickup', jsonb_build_object(
      'leadMinutes', coalesce(s.pickup_lead_minutes, 20), 'slotMinutes', coalesce(s.pickup_slot_minutes, 15)));
end;
$$;

create or replace function public.get_pickup_slots(org_slug text, location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(get_pickup_slots.org_slug));
  v_loc  uuid := get_pickup_slots.location_id;
  v_org  uuid;
begin
  select o.id into v_org from public.organizations o where o.slug = v_slug and o.status = 'active';
  if v_org is null
     or not exists (select 1 from public.locations x where x.id = v_loc and x.organization_id = v_org and x.is_active)
     or not private.org_has_feature(v_org, 'qr_ordering') then
    return '[]'::jsonb;
  end if;
  return private.pickup_slots_at(v_loc, now());
end;
$$;

-- get_storefront now includes each active location's id (the menu and ordering calls need it; ids are already public)
create or replace function public.get_storefront(slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(trim(coalesce(get_storefront.slug, '')));
  v_org  public.organizations%rowtype;
begin
  select o.* into v_org from public.organizations o where o.slug = v_slug;
  if not found then
    return null;
  end if;
  if v_org.status <> 'active' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  return jsonb_build_object(
    'status', 'active',
    'name', v_org.name,
    'slug', v_org.slug,
    'branding', coalesce((
      select jsonb_build_object(
        'logo_url', b.logo_url,
        'primary_color', b.primary_color,
        'secondary_color', b.secondary_color,
        'font', b.font,
        'theme', b.theme)
      from public.org_branding b where b.organization_id = v_org.id
    ), '{}'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'address', l.address, 'city', l.city,
        'phone', l.phone, 'timezone', l.timezone) order by l.name)
      from public.locations l
      where l.organization_id = v_org.id and l.is_active
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.save_location_hours(uuid, jsonb), public.get_public_location_info(text, uuid),
  public.get_pickup_slots(text, uuid) from public, anon, authenticated;
grant execute on function public.save_location_hours(uuid, jsonb) to authenticated;
grant execute on function public.get_public_location_info(text, uuid), public.get_pickup_slots(text, uuid) to anon, authenticated;
-- get_storefront keeps its existing grants (create or replace preserves them)

-- The private helpers are not callable by clients (they also have no USAGE on the private schema); say so explicitly,
-- like the other private functions, so a later grant on the schema cannot expose them by accident.
revoke execute on function private.org_has_feature(uuid, text), private.location_open_at(uuid, timestamptz),
  private.pickup_slots_at(uuid, timestamptz), private.locations_default_ordering_settings(),
  private.los_online_requires_hours(), private.lh_keep_hours_for_online() from public, anon, authenticated;
