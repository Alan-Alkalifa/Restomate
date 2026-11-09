-- MVM-T01 (M2 §6a): venue schema — areas, tables, QR tokens.
--  * Same-org / same-location integrity is enforced by composite FKs, not by trusting the client.
--  * qr_token is generated server-side only (BEFORE INSERT trigger / rotate RPC); clients have no column privilege on it.
--  * No client DELETE (no grant, no policy): soft delete via is_active = false.
--  * Package limit max_tables: counts ACTIVE tables per org; (re)activating a table is checked too.
--  * Audit rows via AFTER triggers (private.write_audit, actor = auth.uid()). Token values are never logged.
-- Error contract: PLAN_LIMIT:max_tables, AREA_NOT_EMPTY (P0001); FORBIDDEN (42501) from the RPCs;
-- duplicate active names/labels surface as unique_violation (23505).

-- locations needs (id, organization_id) unique already (locations_id_org_unique).

create table public.areas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  name             text not null,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint areas_name_len check (char_length(name) between 1 and 60),
  constraint areas_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  constraint areas_id_location_unique unique (id, location_id)
);
create index areas_organization_id_idx on public.areas (organization_id);
create index areas_location_id_idx on public.areas (location_id);
create unique index areas_location_name_active_key on public.areas (location_id, lower(name)) where is_active;

create table public.tables (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  location_id      uuid not null,
  area_id          uuid not null,
  label            text not null,
  capacity         integer not null,
  status           text not null default 'available',
  pos_x            integer,
  pos_y            integer,
  shape            text not null default 'square',
  is_active        boolean not null default true,
  qr_token         text not null,
  qr_rotated_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tables_label_len check (char_length(label) between 1 and 20),
  constraint tables_capacity_range check (capacity between 1 and 50),
  constraint tables_status_valid check (status in ('available', 'reserved', 'occupied', 'needs_cleaning')),
  constraint tables_shape_valid check (shape in ('square', 'round', 'rect')),
  constraint tables_location_org_fk foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade,
  -- the area must live in the same location (and, through areas' own FK, the same org)
  constraint tables_area_location_fk foreign key (area_id, location_id)
    references public.areas (id, location_id) on delete cascade,
  constraint tables_qr_token_key unique (qr_token)
);
create index tables_organization_id_idx on public.tables (organization_id);
create index tables_location_id_idx on public.tables (location_id);
create index tables_area_id_idx on public.tables (area_id);
create unique index tables_location_label_active_key on public.tables (location_id, lower(label)) where is_active;

create trigger areas_set_updated_at before update on public.areas
  for each row execute function private.set_updated_at();
create trigger tables_set_updated_at before update on public.tables
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- QR tokens: 24 random bytes (192 bits), base64url, 32 chars. Never derived from ids.
-- ---------------------------------------------------------------------------
create or replace function private.new_qr_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
$$;

-- Always generates the token when none is given; clients cannot give one (no column privilege).
create or replace function private.tables_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.qr_token is null then
    new.qr_token := private.new_qr_token();
  end if;
  return new;
end;
$$;
create trigger tables_before_insert before insert on public.tables
  for each row execute function private.tables_before_insert();
-- qr_token stays NOT NULL: BEFORE triggers run before the constraint check, so an omitted column is filled in.

-- ---------------------------------------------------------------------------
-- Package limit: max_tables (active tables per org)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_table_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active
     and (tg_op = 'INSERT' or not old.is_active or new.organization_id is distinct from old.organization_id) then
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:max_tables:' || new.organization_id::text, 0));
    perform private.plan_limit_check(new.organization_id, 'max_tables',
      (select count(*) from public.tables t
        where t.organization_id = new.organization_id and t.is_active and t.id <> new.id));
  end if;
  return new;
end;
$$;
create trigger tables_enforce_limit before insert or update on public.tables
  for each row execute function private.enforce_table_limit();

-- An area that still has active tables cannot be deactivated.
create or replace function private.guard_area_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active
     and exists (select 1 from public.tables t where t.area_id = new.id and t.is_active) then
    raise exception 'AREA_NOT_EMPTY' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger areas_guard_deactivate before update on public.areas
  for each row execute function private.guard_area_deactivate();

-- ---------------------------------------------------------------------------
-- Audit (ids and old/new names only; never token values)
-- ---------------------------------------------------------------------------
create or replace function private.audit_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, v_actor, 'area.created', 'area', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'name', new.name));
    return null;
  end if;
  if new.name is distinct from old.name then
    perform private.write_audit(new.organization_id, v_actor, 'area.renamed', 'area', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'from', old.name, 'to', new.name));
  end if;
  if old.is_active and not new.is_active then
    perform private.write_audit(new.organization_id, v_actor, 'area.deactivated', 'area', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'name', new.name));
  elsif not old.is_active and new.is_active then
    perform private.write_audit(new.organization_id, v_actor, 'area.reactivated', 'area', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'name', new.name));
  end if;
  return null;
end;
$$;
create trigger areas_audit after insert or update on public.areas
  for each row execute function private.audit_area();

create or replace function private.audit_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, v_actor, 'table.created', 'table', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'area_id', new.area_id, 'label', new.label,
                         'capacity', new.capacity));
    return null;
  end if;
  if new.label is distinct from old.label then
    perform private.write_audit(new.organization_id, v_actor, 'table.renamed', 'table', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'from', old.label, 'to', new.label));
  end if;
  if old.is_active and not new.is_active then
    perform private.write_audit(new.organization_id, v_actor, 'table.deactivated', 'table', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'label', new.label));
  elsif not old.is_active and new.is_active then
    perform private.write_audit(new.organization_id, v_actor, 'table.reactivated', 'table', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'label', new.label));
  end if;
  if new.qr_token is distinct from old.qr_token then
    perform private.write_audit(new.organization_id, v_actor, 'table.qr_rotated', 'table', new.id::text,
      jsonb_build_object('location_id', new.location_id, 'label', new.label));
  end if;
  return null;
end;
$$;
create trigger tables_audit after insert or update on public.tables
  for each row execute function private.audit_table();

-- ---------------------------------------------------------------------------
-- RLS + privileges
-- ---------------------------------------------------------------------------
alter table public.areas  enable row level security;
alter table public.tables enable row level security;

create policy areas_select on public.areas
  for select to authenticated
  using (public.has_location_access(location_id) or public.is_platform_admin());
create policy areas_insert on public.areas
  for insert to authenticated
  with check (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id));
create policy areas_update on public.areas
  for update to authenticated
  using (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id))
  with check (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id));

create policy tables_select on public.tables
  for select to authenticated
  using (public.has_location_access(location_id) or public.is_platform_admin());
create policy tables_insert on public.tables
  for insert to authenticated
  with check (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id));
create policy tables_update on public.tables
  for update to authenticated
  using (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id))
  with check (public.has_permission(organization_id, 'tables.manage') and public.has_location_access(location_id));

-- Column grants: location_id/organization_id are insert-only; qr_token and qr_rotated_at are never client-writable.
grant select on public.areas, public.tables to authenticated;
grant insert (organization_id, location_id, name, sort_order, is_active) on public.areas to authenticated;
grant update (name, sort_order, is_active) on public.areas to authenticated;
grant insert (organization_id, location_id, area_id, label, capacity, status, pos_x, pos_y, shape, is_active)
  on public.tables to authenticated;
grant update (area_id, label, capacity, status, pos_x, pos_y, shape, is_active) on public.tables to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- rotate_table_qr_token(table_id) -> new token. The old token stops resolving immediately.
create or replace function public.rotate_table_qr_token(table_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid := rotate_table_qr_token.table_id;
  v_org   uuid;
  v_loc   uuid;
  v_act   boolean;
  v_token text;
begin
  select t.organization_id, t.location_id, t.is_active into v_org, v_loc, v_act
  from public.tables t where t.id = v_id for update;
  -- Unknown id and no-permission look the same: no existence oracle across tenants.
  if not found
     or not public.has_permission(v_org, 'tables.manage')
     or not public.has_location_access(v_loc) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not v_act then
    raise exception 'TABLE_INACTIVE' using errcode = 'P0001';
  end if;
  v_token := private.new_qr_token();
  update public.tables t set qr_token = v_token, qr_rotated_at = now() where t.id = v_id;
  return v_token;
end;
$$;

-- resolve_table_qr(token) -> the one row the storefront needs, or nothing.
-- Only active tables of active locations and active organizations resolve.
create or replace function public.resolve_table_qr(token text)
returns table (org_slug text, location_id uuid, table_id uuid, label text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.slug, t.location_id, t.id, t.label
  from public.tables t
  join public.organizations o on o.id = t.organization_id and o.status = 'active'
  join public.locations l on l.id = t.location_id and l.is_active
  join public.areas a on a.id = t.area_id and a.is_active
  where t.qr_token = resolve_table_qr.token and t.is_active
  limit 1;
$$;

revoke execute on function public.rotate_table_qr_token(uuid), public.resolve_table_qr(text) from public, anon, authenticated;
grant execute on function public.rotate_table_qr_token(uuid) to authenticated;
grant execute on function public.resolve_table_qr(text) to anon, authenticated;
-- private.* functions stay uncallable by clients (default privileges revoke execute).
