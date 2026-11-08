-- MF-T04: integrity triggers: plan limits, last owner, system roles.
-- Error contract: PLAN_LIMIT:<key> (P0001), LAST_OWNER (P0001), SYSTEM_ROLE (P0001).
-- All trigger functions are security definer with an empty search_path so RLS of the
-- calling user cannot hide rows from the checks. They fire for every role, the service
-- role included. (Only the table owner can disable them, e.g. seed.sql for 'demo'.)

-- ---------------------------------------------------------------------------
-- Plan limits
-- ---------------------------------------------------------------------------
create or replace function private.plan_limit_check(org uuid, lim_key text, used bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim bigint := private.org_limit(org, lim_key);
begin
  -- NULL = unlimited; `used` is the count BEFORE the new row, so cap+1 fails
  if lim is not null and used + 1 > lim then
    raise exception 'PLAN_LIMIT:%', lim_key using errcode = 'P0001';
  end if;
end;
$$;

-- active members + pending (not accepted, not revoked, not expired) invitations
create or replace function private.staff_count(org uuid, except_member uuid, except_invitation uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.organization_members m
      where m.organization_id = org and m.status = 'active'
        and m.id is distinct from except_member)
    + (select count(*) from public.staff_invitations i
      where i.organization_id = org
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and i.id is distinct from except_invitation);
$$;

create or replace function private.enforce_location_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active
     and (tg_op = 'INSERT' or not old.is_active or new.organization_id is distinct from old.organization_id) then
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:max_locations:' || new.organization_id::text, 0));
    perform private.plan_limit_check(new.organization_id, 'max_locations',
      (select count(*) from public.locations l
        where l.organization_id = new.organization_id and l.is_active and l.id <> new.id));
  end if;
  return new;
end;
$$;

create or replace function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status <> 'active' or new.organization_id is distinct from old.organization_id) then
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:max_staff:' || new.organization_id::text, 0));
    perform private.plan_limit_check(new.organization_id, 'max_staff',
      private.staff_count(new.organization_id, new.id, null));
  end if;
  return new;
end;
$$;

create or replace function private.enforce_invitation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_pending boolean := new.accepted_at is null and new.revoked_at is null and new.expires_at > now();
  old_pending boolean;
begin
  if tg_op = 'UPDATE' then
    old_pending := old.accepted_at is null and old.revoked_at is null and old.expires_at > now();
  end if;
  if new_pending
     and (tg_op = 'INSERT' or not old_pending or new.organization_id is distinct from old.organization_id) then
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:max_staff:' || new.organization_id::text, 0));
    perform private.plan_limit_check(new.organization_id, 'max_staff',
      private.staff_count(new.organization_id, null, new.id));
  end if;
  return new;
end;
$$;

create trigger locations_enforce_limit
  before insert or update of is_active, organization_id on public.locations
  for each row execute function private.enforce_location_limit();
create trigger organization_members_enforce_limit
  before insert or update of status, organization_id on public.organization_members
  for each row execute function private.enforce_member_limit();
create trigger staff_invitations_enforce_limit
  before insert or update on public.staff_invitations
  for each row execute function private.enforce_invitation_limit();

-- ---------------------------------------------------------------------------
-- The last active owner cannot be deleted, deactivated, moved or demoted.
-- Deleting the whole organization (cascade) is allowed.
-- ---------------------------------------------------------------------------
create or replace function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_owner  boolean;
  stays_owner boolean;
begin
  select (r.is_system and r.key = 'owner') into was_owner
  from public.roles r where r.id = old.role_id;
  if old.status <> 'active' or not coalesce(was_owner, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return old;  -- the organization itself is being deleted
    end if;
    stays_owner := false;
  else
    select (r.is_system and r.key = 'owner') into stays_owner
    from public.roles r where r.id = new.role_id;
    stays_owner := new.status = 'active' and coalesce(stays_owner, false)
                   and new.organization_id = old.organization_id;
  end if;

  if not stays_owner then
    perform pg_advisory_xact_lock(hashtextextended('last_owner:' || old.organization_id::text, 0));
    if not exists (
      select 1 from public.organization_members m
      join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
      where m.organization_id = old.organization_id and m.id <> old.id
        and m.status = 'active' and r.is_system and r.key = 'owner'
    ) then
      raise exception 'LAST_OWNER' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger organization_members_guard_last_owner
  before delete or update of status, role_id, organization_id on public.organization_members
  for each row execute function private.guard_last_owner();

-- ---------------------------------------------------------------------------
-- System roles: no delete or identity change; the owner role has no editable permissions.
-- ---------------------------------------------------------------------------
create or replace function private.guard_system_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and exists (select 1 from public.organizations o where o.id = old.organization_id) then
      raise exception 'SYSTEM_ROLE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.is_system and (new.key <> old.key or new.is_system <> old.is_system
                        or new.organization_id <> old.organization_id) then
    raise exception 'SYSTEM_ROLE' using errcode = 'P0001';
  end if;
  if not old.is_system and new.is_system then
    raise exception 'SYSTEM_ROLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function private.guard_owner_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touches_owner boolean;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return old;  -- organization cascade
  end if;
  select exists (
    select 1 from public.roles r
    where r.is_system and r.key = 'owner'
      and r.id in (
        case when tg_op <> 'INSERT' then old.role_id end,
        case when tg_op <> 'DELETE' then new.role_id end)
  ) into touches_owner;
  if touches_owner then
    raise exception 'SYSTEM_ROLE' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger roles_guard_system
  before delete or update on public.roles
  for each row execute function private.guard_system_roles();
create trigger role_permissions_guard_owner
  before insert or update or delete on public.role_permissions
  for each row execute function private.guard_owner_role_permissions();

revoke execute on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs adjusted for the triggers (same signatures, grants and behavior otherwise):
--  * create_organization creates the subscription before the first member/location
--  * accept_invitation consumes the invitation before creating the membership, so
--    the invite being accepted is not counted next to the new membership
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  name text,
  slug text,
  location jsonb,
  branding jsonb default null,
  package_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_name       text := trim(coalesce(create_organization.name, ''));
  v_slug       text := lower(trim(coalesce(create_organization.slug, '')));
  v_loc        jsonb := create_organization.location;
  v_brand      jsonb := create_organization.branding;
  v_pkg_code   text := create_organization.package_code;
  v_email      text;
  v_confirmed  timestamptz;
  v_owned      integer;
  v_max_owned  integer := 3;
  v_setting    text;
  v_loc_name   text;
  v_loc_addr   text;
  v_loc_city   text;
  v_loc_phone  text;
  v_tz         text;
  v_cur        text;
  v_tax        integer;
  v_svc        integer;
  v_tax_on_svc boolean;
  v_primary    text;
  v_logo       text;
  v_pkg        public.packages%rowtype;
  v_org        uuid;
  v_owner_role uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_uid;
  if v_confirmed is null then
    raise exception 'EMAIL_NOT_CONFIRMED' using errcode = 'P0001';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$' then
    raise exception 'INVALID_SLUG' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reserved_slugs rs where rs.slug = v_slug) then
    raise exception 'SLUG_RESERVED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end if;

  -- location
  if v_loc is null or jsonb_typeof(v_loc) <> 'object' then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;
  begin
    v_loc_name  := trim(coalesce(v_loc ->> 'name', ''));
    v_loc_addr  := nullif(trim(coalesce(v_loc ->> 'address', '')), '');
    v_loc_city  := nullif(trim(coalesce(v_loc ->> 'city', '')), '');
    v_loc_phone := nullif(trim(coalesce(v_loc ->> 'phone', '')), '');
    v_tz        := coalesce(nullif(trim(v_loc ->> 'timezone'), ''), 'Asia/Jakarta');
    v_cur       := upper(coalesce(nullif(trim(v_loc ->> 'currency'), ''), 'IDR'));
    v_tax       := coalesce((v_loc ->> 'tax_rate_bps')::integer, 1000);
    v_svc       := coalesce((v_loc ->> 'service_charge_bps')::integer, 0);
    v_tax_on_svc := coalesce((v_loc ->> 'tax_on_service_charge')::boolean, true);
  exception when others then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end;
  if char_length(v_loc_name) < 1 or char_length(v_loc_name) > 120
     or char_length(coalesce(v_loc_addr, '')) > 300
     or char_length(coalesce(v_loc_city, '')) > 120
     or char_length(coalesce(v_loc_phone, '')) > 32
     or v_cur !~ '^[A-Z]{3}$'
     or v_tax not between 0 and 10000
     or v_svc not between 0 and 10000
     or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = v_tz) then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;

  -- branding (optional)
  if v_brand is not null then
    if jsonb_typeof(v_brand) <> 'object' then
      raise exception 'INVALID_BRANDING' using errcode = 'P0001';
    end if;
    v_primary := nullif(trim(coalesce(v_brand ->> 'primary_color', '')), '');
    v_logo    := nullif(trim(coalesce(v_brand ->> 'logo_url', '')), '');
    if (v_primary is not null and v_primary !~ '^#[0-9a-fA-F]{6}$')
       or char_length(coalesce(v_logo, '')) > 500 then
      raise exception 'INVALID_BRANDING' using errcode = 'P0001';
    end if;
  end if;

  -- package
  if v_pkg_code is not null then
    select pk.* into v_pkg from public.packages pk
    where pk.code = v_pkg_code and pk.is_active and pk.is_public;
  else
    select pk.* into v_pkg from public.packages pk
    where pk.is_default and pk.is_active;
  end if;
  if not found then
    raise exception 'INVALID_PACKAGE' using errcode = 'P0001';
  end if;

  -- cap on owned organizations (abuse guard); serialize per user
  perform pg_advisory_xact_lock(hashtextextended('create_organization:' || v_uid::text, 0));
  select ps.value #>> '{}' into v_setting
  from public.platform_settings ps where ps.key = 'max_owned_organizations';
  begin
    if v_setting is not null then v_max_owned := v_setting::integer; end if;
  exception when others then
    v_max_owned := 3;
  end;
  select count(*) into v_owned
  from public.organization_members m
  join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
  where m.user_id = v_uid and m.status = 'active' and r.is_system and r.key = 'owner';
  if v_owned >= v_max_owned then
    raise exception 'ORG_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- organization
  begin
    insert into public.organizations (slug, name, currency, timezone, contact_email, created_by)
    values (v_slug, v_name, v_cur, v_tz, v_email, v_uid)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end;

  -- the subscription comes first: plan-limit triggers read it
  insert into public.subscriptions (organization_id, package_id, status, billing_period,
                                    trial_ends_at, current_period_start, current_period_end)
  values (v_org, v_pkg.id, 'trialing', 'monthly',
          now() + make_interval(days => v_pkg.trial_days),
          now(), now() + make_interval(days => v_pkg.trial_days));

  -- system roles and their permissions
  insert into public.roles (organization_id, key, name, description, is_system)
  select v_org, k.key, k.name, k.descr, true
  from (values
    ('owner',   'Owner',   'Full access, including billing'),
    ('manager', 'Manager', 'Runs day-to-day operations'),
    ('cashier', 'Cashier', 'Takes orders and payments'),
    ('waiter',  'Waiter',  'Takes and serves orders'),
    ('kitchen', 'Kitchen', 'Prepares orders')
  ) as k (key, name, descr);

  insert into public.role_permissions (role_id, organization_id, permission_key)
  select r.id, v_org, d.permission_key
  from public.roles r
  join public.default_role_permissions d on d.role_key = r.key
  where r.organization_id = v_org;

  select r.id into v_owner_role
  from public.roles r where r.organization_id = v_org and r.key = 'owner';

  insert into public.organization_members (organization_id, user_id, role_id, status, all_locations)
  values (v_org, v_uid, v_owner_role, 'active', true);

  insert into public.locations (organization_id, name, address, city, phone, timezone, currency,
                                tax_rate_bps, service_charge_bps, tax_on_service_charge)
  values (v_org, v_loc_name, v_loc_addr, v_loc_city, v_loc_phone, v_tz, v_cur,
          v_tax, v_svc, v_tax_on_svc);

  insert into public.org_branding (organization_id, logo_path, primary_color)
  values (v_org, v_logo, v_primary);

  perform private.write_audit(v_org, v_uid, 'organization.created', 'organization', v_org::text,
    jsonb_build_object('slug', v_slug, 'package', v_pkg.code));

  return jsonb_build_object('organization_id', v_org, 'slug', v_slug);
end;
$$;

create or replace function public.accept_invitation(token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_token      text := accept_invitation.token;
  v_email      text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_confirmed  timestamptz;
  v_inv        public.staff_invitations%rowtype;
  v_org        public.organizations%rowtype;
  v_member     uuid;
  v_cur_owner  boolean;
  v_all        boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if v_token is null or char_length(v_token) < 16 or char_length(v_token) > 256 then
    raise exception 'INVALID_INVITATION' using errcode = 'P0001';
  end if;

  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v_uid;

  select i.* into v_inv
  from public.staff_invitations i
  where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  for update;

  -- one generic error for: unknown token, wrong email, expired, revoked, reused,
  -- unconfirmed account, suspended organization
  if not found
     or v_confirmed is null
     or v_inv.email <> v_email
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'INVALID_INVITATION' using errcode = 'P0001';
  end if;

  select o.* into v_org from public.organizations o where o.id = v_inv.organization_id;
  if not found or v_org.status = 'suspended' then
    raise exception 'INVALID_INVITATION' using errcode = 'P0001';
  end if;

  -- consume the invitation first so it is not counted next to the new membership
  update public.staff_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  v_all := cardinality(v_inv.location_ids) = 0;

  select m.id, (r.is_system and r.key = 'owner')
    into v_member, v_cur_owner
  from public.organization_members m
  join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
  where m.organization_id = v_inv.organization_id and m.user_id = v_uid;

  if v_member is not null then
    -- an invitation never changes an existing owner
    if v_cur_owner then
      raise exception 'INVALID_INVITATION' using errcode = 'P0001';
    end if;
    update public.organization_members
       set role_id = v_inv.role_id, status = 'active', all_locations = v_all,
           invited_by = v_inv.invited_by
     where id = v_member;
    delete from public.location_staff ls where ls.member_id = v_member;
  else
    insert into public.organization_members
      (organization_id, user_id, role_id, status, all_locations, invited_by)
    values (v_inv.organization_id, v_uid, v_inv.role_id, 'active', v_all, v_inv.invited_by)
    returning id into v_member;
  end if;

  if not v_all then
    insert into public.location_staff (member_id, location_id, organization_id)
    select v_member, l.id, l.organization_id
    from public.locations l
    where l.organization_id = v_inv.organization_id and l.id = any (v_inv.location_ids)
    on conflict do nothing;
  end if;

  perform private.write_audit(v_inv.organization_id, v_uid, 'invitation.accepted',
    'staff_invitation', v_inv.id::text, jsonb_build_object('role_id', v_inv.role_id));

  return jsonb_build_object('organization_id', v_org.id, 'slug', v_org.slug);
end;
$$;
