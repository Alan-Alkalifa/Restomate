-- MF-T34: review fixes for 20261108020000_foundation_rpcs.sql (never edited).
--  1. staff_invitations.all_locations is explicit; an empty location_ids never widens scope.
--  2. org_branding.logo_url: own https-only column (logo_path stays for Storage objects).
--  3. Client-set invitation expires_at must be in (now, now + 30 days].
-- Starts from MF-T04's create_organization / accept_invitation (subscription first,
-- invitation consumed before the membership).

-- 1. explicit location scope ---------------------------------------------------------
alter table public.staff_invitations add column all_locations boolean not null default false;
-- rows created under the old "empty list = all" semantics keep their meaning
update public.staff_invitations set all_locations = true where cardinality(location_ids) = 0;
alter table public.staff_invitations
  add constraint staff_invitations_scope_explicit
  check (all_locations or cardinality(location_ids) > 0);

grant select (all_locations) on public.staff_invitations to authenticated;
grant insert (all_locations) on public.staff_invitations to authenticated;
grant update (all_locations) on public.staff_invitations to authenticated;

-- 2. logo_url -------------------------------------------------------------------------
alter table public.org_branding add column logo_url text;
alter table public.org_branding
  add constraint org_branding_logo_url_https
  check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://[^\s]+$'));
grant insert (logo_url) on public.org_branding to authenticated;
grant update (logo_url) on public.org_branding to authenticated;

-- 3. bounded expiry for client writes ---------------------------------------------------
-- Client roles only (authenticated/anon); definer RPCs, the service role and the table
-- owner are unaffected. Checked on insert, when expires_at changes, and when an
-- invitation is un-revoked. Other updates (e.g. revoking an expired invitation) pass.
create or replace function private.check_invitation_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (
       tg_op = 'INSERT'
       or new.expires_at is distinct from old.expires_at
       or (old.revoked_at is not null and new.revoked_at is null)
     )
     and (new.expires_at <= now() or new.expires_at > now() + interval '30 days') then
    raise exception 'INVALID_EXPIRY' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger staff_invitations_check_expiry
  before insert or update on public.staff_invitations
  for each row execute function private.check_invitation_expiry();

revoke execute on all functions in schema private from public, anon, authenticated;

-- functions redefined (same signatures and grants) ----------------------------------------
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
       or (v_logo is not null and (char_length(v_logo) > 500 or v_logo !~ '^https://[^\s]+$')) then
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

  insert into public.org_branding (organization_id, logo_url, primary_color)
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

  v_all := v_inv.all_locations;

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
        'logo_path', b.logo_path,
        'primary_color', b.primary_color,
        'secondary_color', b.secondary_color,
        'font', b.font,
        'theme', b.theme)
      from public.org_branding b where b.organization_id = v_org.id
    ), '{}'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', l.name, 'address', l.address, 'city', l.city,
        'phone', l.phone, 'timezone', l.timezone) order by l.name)
      from public.locations l
      where l.organization_id = v_org.id and l.is_active
    ), '[]'::jsonb)
  );
end;
$$;
