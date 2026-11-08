-- MF-T03: staff_invitations + public RPCs.
--
-- Error contract (message = code; read it from the Postgres error message):
--   42501 FORBIDDEN / permission denied      P0001 <CODE> business errors:
--   NOT_AUTHENTICATED, EMAIL_NOT_CONFIRMED, INVALID_NAME, INVALID_SLUG, SLUG_RESERVED,
--   SLUG_TAKEN, INVALID_LOCATION, INVALID_BRANDING, INVALID_PACKAGE, ORG_LIMIT_REACHED,
--   INVALID_INVITATION (generic: not found / wrong email / expired / revoked / reused),
--   INVALID_STATUS, INVALID_REASON, ORG_NOT_FOUND.

-- ---------------------------------------------------------------------------
-- staff_invitations
-- ---------------------------------------------------------------------------
create table public.staff_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null,
  role_id          uuid not null,
  location_ids     uuid[] not null default '{}',
  token_hash       text not null unique,
  invited_by       uuid references auth.users (id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  send_count       integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint staff_invitations_email_lower check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$' and char_length(email) <= 254),
  constraint staff_invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_invitations_send_count_pos check (send_count >= 1),
  constraint staff_invitations_locations_max check (cardinality(location_ids) <= 100),
  foreign key (role_id, organization_id) references public.roles (id, organization_id)
);
create index staff_invitations_organization_id_idx on public.staff_invitations (organization_id);
create index staff_invitations_role_id_idx on public.staff_invitations (role_id);
create index staff_invitations_email_idx on public.staff_invitations (organization_id, email);
-- one pending invitation per organization + email (DB guard; the app also checks)
create unique index staff_invitations_one_pending
  on public.staff_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create trigger set_updated_at before update on public.staff_invitations
  for each row execute function private.set_updated_at();

alter table public.staff_invitations enable row level security;

-- staff.manage only; the owner role can be granted only by an owner.
create policy staff_invitations_select on public.staff_invitations
  for select to authenticated
  using (public.has_permission(organization_id, 'staff.manage'));
create policy staff_invitations_insert on public.staff_invitations
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'staff.manage')
    and invited_by = (select auth.uid())
    and accepted_at is null and revoked_at is null
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = staff_invitations.role_id and r.is_system and r.key = 'owner'
      )
    )
  );
create policy staff_invitations_update on public.staff_invitations
  for update to authenticated
  using (public.has_permission(organization_id, 'staff.manage'))
  with check (
    public.has_permission(organization_id, 'staff.manage')
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = staff_invitations.role_id and r.is_system and r.key = 'owner'
      )
    )
  );

-- token_hash is write-only for clients: no select privilege on it, no deletes.
grant select (id, organization_id, email, role_id, location_ids, invited_by, expires_at,
  accepted_at, accepted_by, revoked_at, send_count, created_at, updated_at)
  on public.staff_invitations to authenticated;
grant insert (organization_id, email, role_id, location_ids, token_hash, invited_by, expires_at)
  on public.staff_invitations to authenticated;
grant update (role_id, location_ids, token_hash, expires_at, revoked_at, send_count)
  on public.staff_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- is_slug_available(slug) -> boolean   [anon, authenticated]
-- ---------------------------------------------------------------------------
create or replace function public.is_slug_available(slug text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(trim(coalesce(is_slug_available.slug, '')));
begin
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$' then
    return false;
  end if;
  if exists (select 1 from public.reserved_slugs rs where rs.slug = v_slug) then
    return false;
  end if;
  return not exists (select 1 from public.organizations o where o.slug = v_slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_organization(name, slug, location, branding, package_code)
--   -> { organization_id, slug }   [authenticated, confirmed email]
-- One transaction: org, 5 system roles + permissions, owner membership,
-- first location, branding row, trialing subscription, audit entry.
-- branding.logo_url is stored in org_branding.logo_path.
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

  insert into public.subscriptions (organization_id, package_id, status, billing_period,
                                    trial_ends_at, current_period_start, current_period_end)
  values (v_org, v_pkg.id, 'trialing', 'monthly',
          now() + make_interval(days => v_pkg.trial_days),
          now(), now() + make_interval(days => v_pkg.trial_days));

  perform private.write_audit(v_org, v_uid, 'organization.created', 'organization', v_org::text,
    jsonb_build_object('slug', v_slug, 'package', v_pkg.code));

  return jsonb_build_object('organization_id', v_org, 'slug', v_slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invitation(token) -> { organization_id, slug }   [authenticated]
-- Every failure raises the same INVALID_INVITATION so tokens cannot be probed.
-- An invitation with no location_ids grants all_locations.
-- ---------------------------------------------------------------------------
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

  update public.staff_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  perform private.write_audit(v_inv.organization_id, v_uid, 'invitation.accepted',
    'staff_invitation', v_inv.id::text, jsonb_build_object('role_id', v_inv.role_id));

  return jsonb_build_object('organization_id', v_org.id, 'slug', v_org.slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_invitation_preview(token) -> { restaurant_name, role_name, email_hint, expired } | null
-- [anon, authenticated]. Looks up by hash only; no ids, no full email.
-- Revoked, accepted, unknown and suspended-org invitations return null.
-- ---------------------------------------------------------------------------
create or replace function public.get_invitation_preview(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := get_invitation_preview.token;
  v_row   record;
begin
  if v_token is null or char_length(v_token) < 16 or char_length(v_token) > 256 then
    return null;
  end if;

  select o.name as restaurant_name, r.name as role_name, i.email, i.expires_at
    into v_row
  from public.staff_invitations i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id and r.organization_id = i.organization_id
  where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
    and i.accepted_at is null
    and i.revoked_at is null
    and o.status <> 'suspended';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'restaurant_name', v_row.restaurant_name,
    'role_name', v_row.role_name,
    'email_hint', left(split_part(v_row.email, '@', 1), 1) || '***@' || split_part(v_row.email, '@', 2),
    'expired', v_row.expires_at <= now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_storefront(slug) -> public info   [anon, authenticated]
--   active org   -> { status:'active', name, slug, branding{...}, locations[...] }
--   other status -> { status:'unavailable' } (nothing else)
--   unknown slug -> null
-- No ids and no emails are returned.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- admin_set_org_status(org, status, reason) -> void   [platform admins only]
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_org_status(org uuid, status text, reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org    uuid := admin_set_org_status.org;
  v_status text := admin_set_org_status.status;
  v_reason text := trim(coalesce(admin_set_org_status.reason, ''));
  v_old    text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_status is null or v_status not in ('active', 'suspended', 'past_due', 'read_only') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;

  select o.status into v_old from public.organizations o where o.id = v_org for update;
  if not found then
    raise exception 'ORG_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.organizations o set status = v_status where o.id = v_org;

  perform private.write_audit(v_org, v_uid, 'organization.status_changed', 'organization', v_org::text,
    jsonb_build_object('from', v_old, 'to', v_status, 'reason', v_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for PUBLIC; only the intended roles.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.is_slug_available(text),
  public.create_organization(text, text, jsonb, jsonb, text),
  public.accept_invitation(text),
  public.get_invitation_preview(text),
  public.get_storefront(text),
  public.admin_set_org_status(uuid, text, text)
  from public, anon, authenticated;

grant execute on function
  public.is_slug_available(text),
  public.get_invitation_preview(text),
  public.get_storefront(text)
  to anon, authenticated;

grant execute on function
  public.create_organization(text, text, jsonb, jsonb, text),
  public.accept_invitation(text),
  public.admin_set_org_status(uuid, text, text)
  to authenticated;
