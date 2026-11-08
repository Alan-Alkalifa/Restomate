-- Restomate foundation: tenancy core, permission catalog, helpers, RLS.
-- Spec: docs/PLAN.md §4.2, CLAUDE.md "Multi-tenancy" and "Domain model".
--
-- Conventions
--   * text + CHECK constraints instead of enums
--   * money = bigint minor units + currency; rates = integer basis points (1000 = 10%)
--   * RLS enabled on every table in public; policies use (select auth.uid()) via helpers
--   * client privileges are granted explicitly per table (default privileges are
--     revoked below, so a new table is unreachable until its migration grants it)
--   * internal functions live in the non-exposed `private` schema

-- ---------------------------------------------------------------------------
-- Schemas and privilege baseline
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_len check (full_name is null or char_length(full_name) <= 120),
  constraint profiles_phone_len check (phone is null or char_length(phone) <= 32)
);

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.packages (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  description    text,
  currency       text not null default 'IDR',
  price_monthly  bigint not null default 0,
  price_yearly   bigint not null default 0,
  trial_days     integer not null default 0,
  limits         jsonb not null default '{}'::jsonb,
  features       text[] not null default '{}',
  is_active      boolean not null default true,
  is_public      boolean not null default true,
  is_default     boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint packages_code_format check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint packages_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint packages_prices_nonneg check (price_monthly >= 0 and price_yearly >= 0),
  constraint packages_trial_days_range check (trial_days between 0 and 365),
  constraint packages_limits_is_object check (jsonb_typeof(limits) = 'object')
);
create unique index packages_single_default on public.packages (is_default) where is_default;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table public.organizations (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  status         text not null default 'active',
  currency       text not null default 'IDR',
  timezone       text not null default 'Asia/Jakarta',
  contact_email  text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$'),
  constraint organizations_name_len check (char_length(name) between 1 and 120),
  constraint organizations_status_valid check (status in ('active', 'suspended', 'past_due', 'read_only')),
  constraint organizations_currency_format check (currency ~ '^[A-Z]{3}$')
);

create table public.reserved_slugs (
  slug    text primary key,
  reason  text,
  constraint reserved_slugs_lowercase check (slug = lower(slug))
);

insert into public.reserved_slugs (slug, reason) values
  ('www', 'infrastructure'), ('app', 'infrastructure'), ('admin', 'infrastructure'),
  ('api', 'infrastructure'), ('mail', 'infrastructure'), ('smtp', 'infrastructure'),
  ('mx', 'infrastructure'), ('ns1', 'infrastructure'), ('ns2', 'infrastructure'),
  ('ftp', 'infrastructure'), ('cdn', 'infrastructure'), ('static', 'infrastructure'),
  ('assets', 'infrastructure'), ('status', 'infrastructure'), ('webhooks', 'infrastructure'),
  ('demo', 'public demo restaurant'),
  ('dashboard', 'product'), ('login', 'product'), ('signup', 'product'), ('auth', 'product'),
  ('onboarding', 'product'), ('invite', 'product'), ('settings', 'product'),
  ('billing', 'product'), ('pricing', 'product'), ('superadmin', 'product'),
  ('platform', 'product'), ('storefront', 'product'),
  ('docs', 'marketing'), ('help', 'marketing'), ('support', 'marketing'),
  ('blog', 'marketing'), ('about', 'marketing'), ('contact', 'marketing'),
  ('restomate', 'brand'), ('root', 'reserved'), ('test', 'reserved'),
  ('staging', 'reserved'), ('dev', 'reserved'), ('s', 'reserved'), ('t', 'reserved');

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  package_id            uuid not null references public.packages (id),
  status                text not null default 'trialing',
  billing_period        text not null default 'monthly',
  trial_ends_at         timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  canceled_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint subscriptions_status_valid check (status in ('trialing', 'active', 'past_due', 'canceled')),
  constraint subscriptions_period_valid check (billing_period in ('monthly', 'yearly'))
);
create index subscriptions_organization_id_idx on public.subscriptions (organization_id);
create index subscriptions_package_id_idx on public.subscriptions (package_id);
-- at most one live subscription per organization
create unique index subscriptions_one_live_per_org
  on public.subscriptions (organization_id)
  where status in ('trialing', 'active', 'past_due');

create table public.locations (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  name                   text not null,
  address                text,
  city                   text,
  phone                  text,
  timezone               text not null default 'Asia/Jakarta',
  currency               text not null default 'IDR',
  tax_rate_bps           integer not null default 1000,
  service_charge_bps     integer not null default 0,
  tax_on_service_charge  boolean not null default true,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint locations_name_len check (char_length(name) between 1 and 120),
  constraint locations_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint locations_tax_bps_range check (tax_rate_bps between 0 and 10000),
  constraint locations_service_bps_range check (service_charge_bps between 0 and 10000),
  constraint locations_id_org_unique unique (id, organization_id)
);
create index locations_organization_id_idx on public.locations (organization_id);

-- ---------------------------------------------------------------------------
-- Permissions, roles, membership
-- ---------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  category     text not null,
  description  text not null,
  constraint permissions_key_format check (key ~ '^[a-z]+\.[a-z]+$')
);

insert into public.permissions (key, category, description) values
  ('menu.manage',          'menu',         'Create and edit menu items, categories and modifiers'),
  ('orders.view',          'orders',       'View orders'),
  ('orders.create',        'orders',       'Create and edit orders'),
  ('orders.void',          'orders',       'Void or cancel orders'),
  ('pos.use',              'pos',          'Use the point of sale'),
  ('pos.discount',         'pos',          'Apply discounts at the point of sale'),
  ('kitchen.view',         'kitchen',      'View the kitchen display'),
  ('kitchen.update',       'kitchen',      'Update kitchen ticket status'),
  ('tables.view',          'tables',       'View tables and areas'),
  ('tables.manage',        'tables',       'Create and edit tables and areas'),
  ('reservations.view',    'reservations', 'View reservations'),
  ('reservations.manage',  'reservations', 'Create and manage reservations'),
  ('payments.view',        'payments',     'View bills and payments'),
  ('payments.take',        'payments',     'Take payments'),
  ('payments.refund',      'payments',     'Refund payments'),
  ('customers.view',       'customers',    'View customers'),
  ('customers.manage',     'customers',    'Create and edit customers'),
  ('reports.view',         'reports',      'View reports'),
  ('staff.manage',         'staff',        'Invite and manage staff and roles'),
  ('locations.manage',     'settings',     'Create and edit locations'),
  ('settings.manage',      'settings',     'Manage organization settings'),
  ('settings.branding',    'settings',     'Edit branding'),
  ('billing.manage',       'billing',      'Manage subscription and billing');

create table public.default_role_permissions (
  role_key        text not null,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key),
  constraint default_role_permissions_role_valid
    check (role_key in ('manager', 'cashier', 'waiter', 'kitchen'))
);

-- Manager: everything except billing.manage, settings.manage, locations.manage
insert into public.default_role_permissions (role_key, permission_key)
select 'manager', key from public.permissions
where key not in ('billing.manage', 'settings.manage', 'locations.manage');

insert into public.default_role_permissions (role_key, permission_key) values
  ('cashier', 'pos.use'), ('cashier', 'orders.view'), ('cashier', 'orders.create'),
  ('cashier', 'payments.view'), ('cashier', 'payments.take'), ('cashier', 'customers.view'),
  ('cashier', 'kitchen.view'), ('cashier', 'tables.view'),
  ('waiter', 'pos.use'), ('waiter', 'orders.view'), ('waiter', 'orders.create'),
  ('waiter', 'kitchen.view'), ('waiter', 'tables.view'), ('waiter', 'reservations.view'),
  ('kitchen', 'kitchen.view'), ('kitchen', 'kitchen.update'), ('kitchen', 'orders.view');

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null,
  name             text not null,
  description      text,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint roles_name_len check (char_length(name) between 1 and 60),
  -- system keys belong to system roles only, and system roles only use system keys
  constraint roles_system_keys check (
    (is_system and key in ('owner', 'manager', 'cashier', 'waiter', 'kitchen'))
    or (not is_system and key not in ('owner', 'manager', 'cashier', 'waiter', 'kitchen'))
  ),
  constraint roles_org_key_unique unique (organization_id, key),
  constraint roles_id_org_unique unique (id, organization_id)
);
create index roles_organization_id_idx on public.roles (organization_id);

create table public.role_permissions (
  role_id          uuid not null,
  organization_id  uuid not null,
  permission_key   text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key),
  foreign key (role_id, organization_id)
    references public.roles (id, organization_id) on delete cascade
);
create index role_permissions_organization_id_idx on public.role_permissions (organization_id);
create index role_permissions_permission_key_idx on public.role_permissions (permission_key);

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role_id          uuid not null,
  status           text not null default 'active',
  all_locations    boolean not null default false,
  invited_by       uuid references auth.users (id) on delete set null,
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organization_members_status_valid check (status in ('active', 'deactivated')),
  constraint organization_members_org_user_unique unique (organization_id, user_id),
  constraint organization_members_id_org_unique unique (id, organization_id),
  foreign key (role_id, organization_id) references public.roles (id, organization_id)
);
create index organization_members_organization_id_idx on public.organization_members (organization_id);
create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_role_id_idx on public.organization_members (role_id);

create table public.location_staff (
  member_id        uuid not null,
  location_id      uuid not null,
  organization_id  uuid not null,
  created_at       timestamptz not null default now(),
  primary key (member_id, location_id),
  foreign key (member_id, organization_id)
    references public.organization_members (id, organization_id) on delete cascade,
  foreign key (location_id, organization_id)
    references public.locations (id, organization_id) on delete cascade
);
create index location_staff_organization_id_idx on public.location_staff (organization_id);
create index location_staff_location_id_idx on public.location_staff (location_id);

-- ---------------------------------------------------------------------------
-- Branding, audit, platform settings
-- ---------------------------------------------------------------------------
create table public.org_branding (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  logo_path        text,
  primary_color    text,
  secondary_color  text,
  font             text,
  theme            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint org_branding_primary_color check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint org_branding_secondary_color check (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint org_branding_theme_is_object check (jsonb_typeof(theme) = 'object')
);

create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete set null,
  actor_id         uuid,
  action           text not null,
  entity_type      text,
  entity_id        text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

create table public.platform_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'packages', 'organizations', 'subscriptions', 'locations',
    'roles', 'organization_members', 'org_branding', 'platform_settings'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- auth.users -> profiles
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Reserved slugs cannot be used by organizations (defense in depth; the
-- create_organization RPC checks too).
create or replace function private.check_slug_not_reserved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.reserved_slugs where slug = new.slug) then
    raise exception 'SLUG_RESERVED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger organizations_slug_not_reserved
  before insert or update of slug on public.organizations
  for each row execute function private.check_slug_not_reserved();

-- ---------------------------------------------------------------------------
-- Helpers (security definer, empty search_path, stable)
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status <> 'suspended'
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function public.is_org_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status <> 'suspended'
    join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and r.is_system and r.key = 'owner'
  );
$$;

create or replace function public.has_permission(org uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.status <> 'suspended'
    join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        (r.is_system and r.key = 'owner')
        or exists (
          select 1 from public.role_permissions rp
          where rp.role_id = r.id and rp.permission_key = perm
        )
      )
  );
$$;

create or replace function public.has_location_access(location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.locations l
    join public.organization_members m
      on m.organization_id = l.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    join public.organizations o on o.id = l.organization_id and o.status <> 'suspended'
    join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
    where l.id = location
      and (
        m.all_locations
        or (r.is_system and r.key = 'owner')
        or exists (
          select 1 from public.location_staff ls
          where ls.member_id = m.id and ls.location_id = l.id
        )
      )
  );
$$;

create or replace function public.my_permissions(org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.key order by p.key), '{}'::text[])
  from public.permissions p
  where public.has_permission(org, p.key);
$$;

-- Numeric limit of the organization's live subscription package.
--   NULL  = unlimited (key absent or JSON null)
--   0     = no live subscription (fail closed)
create or replace function private.org_limit(org uuid, key text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_live boolean := false;
  lim jsonb;
begin
  select true, pk.limits -> key
    into found_live, lim
  from public.subscriptions s
  join public.packages pk on pk.id = s.package_id
  where s.organization_id = org
    and s.status in ('trialing', 'active', 'past_due')
  limit 1;

  if not coalesce(found_live, false) then
    return 0;
  end if;
  if lim is null or jsonb_typeof(lim) = 'null' then
    return null;
  end if;
  return (lim #>> '{}')::bigint;
end;
$$;

create or replace function private.write_audit(
  p_org uuid,
  p_actor uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id;
$$;

-- Function privileges: nothing in private is callable by clients; public
-- helpers are callable by signed-in users only.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.is_platform_admin(), public.is_org_member(uuid), public.is_org_owner(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid), public.my_permissions(uuid)
  from public, anon;
grant execute on function
  public.is_platform_admin(), public.is_org_member(uuid), public.is_org_owner(uuid),
  public.has_permission(uuid, text), public.has_location_access(uuid), public.my_permissions(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.platform_admins          enable row level security;
alter table public.packages                 enable row level security;
alter table public.organizations            enable row level security;
alter table public.reserved_slugs           enable row level security;
alter table public.subscriptions            enable row level security;
alter table public.locations                enable row level security;
alter table public.permissions              enable row level security;
alter table public.default_role_permissions enable row level security;
alter table public.roles                    enable row level security;
alter table public.role_permissions         enable row level security;
alter table public.organization_members     enable row level security;
alter table public.location_staff           enable row level security;
alter table public.org_branding             enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.platform_settings        enable row level security;

-- profiles: own row, people in my organizations, platform admins. No inserts
-- (trigger-created) and no deletes from clients.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1 from public.organization_members m
      where m.user_id = profiles.id and public.is_org_member(m.organization_id)
    )
  );
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- platform_admins: "is it me" only. Writes happen with the service role.
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- packages: public catalog for everyone, own plan for members, all for platform admins.
create policy packages_select_public on public.packages
  for select to anon, authenticated
  using (is_active and is_public);
create policy packages_select_own_plan on public.packages
  for select to authenticated
  using (exists (
    select 1 from public.subscriptions s
    where s.package_id = packages.id and public.has_permission(s.organization_id, 'billing.manage')
  ));
create policy packages_admin_all on public.packages
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- organizations: members read; settings.manage edits a limited column set;
-- creation goes through the create_organization RPC.
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  );
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_permission(id, 'settings.manage'))
  with check (public.has_permission(id, 'settings.manage'));

-- reserved slugs and the permission catalog: read-only reference data.
create policy reserved_slugs_select on public.reserved_slugs
  for select to authenticated using (true);
create policy permissions_select on public.permissions
  for select to authenticated using (true);
create policy default_role_permissions_select on public.default_role_permissions
  for select to authenticated using (true);

-- subscriptions: owner / billing.manage read; only platform admins (and the service role) write.
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (public.has_permission(organization_id, 'billing.manage') or public.is_platform_admin());
create policy subscriptions_admin_write on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- locations
create policy locations_select on public.locations
  for select to authenticated
  using (public.has_location_access(id) or public.is_platform_admin());
create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.has_permission(organization_id, 'locations.manage'));
create policy locations_update on public.locations
  for update to authenticated
  using (public.has_permission(organization_id, 'locations.manage'))
  with check (public.has_permission(organization_id, 'locations.manage'));

-- roles / role_permissions: members read; only owners write, and never system roles.
create policy roles_select on public.roles
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy roles_insert on public.roles
  for insert to authenticated
  with check (public.is_org_owner(organization_id) and not is_system);
create policy roles_update on public.roles
  for update to authenticated
  using (public.is_org_owner(organization_id) and not is_system)
  with check (public.is_org_owner(organization_id) and not is_system);
create policy roles_delete on public.roles
  for delete to authenticated
  using (public.is_org_owner(organization_id) and not is_system);

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    public.is_org_owner(organization_id)
    and not exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id and r.is_system and r.key = 'owner'
    )
  );
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    public.is_org_owner(organization_id)
    and not exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id and r.is_system and r.key = 'owner'
    )
  );

-- organization_members: members see their team; own row is always visible.
-- staff.manage may change role/status/locations but cannot touch owners or
-- grant the owner role unless the actor is an owner. Rows are created by RPCs.
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (
    public.has_permission(organization_id, 'staff.manage')
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = organization_members.role_id and r.is_system and r.key = 'owner'
      )
    )
  )
  with check (
    public.has_permission(organization_id, 'staff.manage')
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = organization_members.role_id and r.is_system and r.key = 'owner'
      )
    )
  );
create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (
    public.has_permission(organization_id, 'staff.manage')
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = organization_members.role_id and r.is_system and r.key = 'owner'
      )
    )
  );

-- location_staff
create policy location_staff_select on public.location_staff
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy location_staff_insert on public.location_staff
  for insert to authenticated
  with check (public.has_permission(organization_id, 'staff.manage'));
create policy location_staff_delete on public.location_staff
  for delete to authenticated
  using (public.has_permission(organization_id, 'staff.manage'));

-- org_branding
create policy org_branding_select on public.org_branding
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy org_branding_insert on public.org_branding
  for insert to authenticated
  with check (public.has_permission(organization_id, 'settings.branding'));
create policy org_branding_update on public.org_branding
  for update to authenticated
  using (public.has_permission(organization_id, 'settings.branding'))
  with check (public.has_permission(organization_id, 'settings.branding'));

-- audit_logs: append-only via private.write_audit; readable by the org owner
-- or platform admins (all rows, including org-less ones).
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    public.is_platform_admin()
    or (organization_id is not null and public.is_org_owner(organization_id))
  );

-- platform_settings: no client access at all (RLS on, no policies, no grants).
-- Definer functions read it; the service role writes it.

-- ---------------------------------------------------------------------------
-- Table privileges (RLS above narrows these further)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.packages to anon;

grant select on public.platform_admins, public.reserved_slugs, public.permissions,
  public.default_role_permissions, public.subscriptions, public.role_permissions,
  public.location_staff, public.audit_logs to authenticated;

grant select on public.profiles, public.packages, public.organizations, public.locations,
  public.roles, public.organization_members, public.org_branding
  to authenticated;

grant update (full_name, phone, avatar_url) on public.profiles to authenticated;
grant update (name, contact_email, timezone, currency) on public.organizations to authenticated;
grant insert, update, delete on public.packages to authenticated;
grant insert, update, delete on public.subscriptions to authenticated;
grant insert, update (name, address, city, phone, timezone, currency, tax_rate_bps,
  service_charge_bps, tax_on_service_charge, is_active) on public.locations to authenticated;
grant insert (organization_id, key, name, description), update (name, description), delete
  on public.roles to authenticated;
grant insert (role_id, organization_id, permission_key), delete on public.role_permissions to authenticated;
grant update (role_id, status, all_locations), delete on public.organization_members to authenticated;
grant insert (member_id, location_id, organization_id), delete on public.location_staff to authenticated;
grant insert (organization_id, logo_path, primary_color, secondary_color, font, theme),
  update (logo_path, primary_color, secondary_color, font, theme) on public.org_branding to authenticated;
