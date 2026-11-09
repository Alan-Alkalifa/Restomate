-- MSS-T01: super admin package management RPCs.
-- Each one: security definer, search_path = '', re-checks is_platform_admin(), validates input in SQL (not only Zod),
-- and writes exactly one audit_logs row in the same transaction. No delete: archive = is_active false.

create or replace function private.package_input_check(p jsonb, p_create boolean)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_feat text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p->>'name', ''))) not between 1 and 60 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p->>'description', '')) > 300 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if coalesce(p->>'currency', '') not in ('IDR', 'USD') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'price_monthly') is distinct from 'number' or (p->>'price_monthly') !~ '^\d{1,15}$'
     or jsonb_typeof(p->'price_yearly') is distinct from 'number' or (p->>'price_yearly') !~ '^\d{1,15}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'trial_days') is distinct from 'number' or (p->>'trial_days') !~ '^\d{1,3}$'
     or (p->>'trial_days')::int > 365 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'sort_order') is distinct from 'number' or (p->>'sort_order') !~ '^\d{1,4}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'is_public') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'limits') is distinct from 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  for v_key, v_val in select * from jsonb_each(p->'limits') loop
    if v_key not in ('max_locations', 'max_staff', 'max_tables', 'max_orders_per_month') then
      raise exception 'INVALID_LIMIT_KEY' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_val) <> 'null' and not (jsonb_typeof(v_val) = 'number' and v_val::text ~ '^\d{1,7}$') then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
  end loop;
  if jsonb_typeof(p->'features') is distinct from 'array' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  for v_feat in select jsonb_array_elements_text(p->'features') loop
    if v_feat not in ('qr_ordering', 'reservations', 'custom_domain', 'advanced_reports') then
      raise exception 'INVALID_FEATURE_KEY' using errcode = 'P0001';
    end if;
  end loop;
  if p_create and coalesce(p->>'code', '') !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
end;
$$;

-- Editable fields of a package as jsonb (used for the audit before/after diff).
create or replace function private.package_snapshot(p public.packages)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name, 'description', p.description, 'currency', p.currency,
    'price_monthly', p.price_monthly, 'price_yearly', p.price_yearly, 'trial_days', p.trial_days,
    'limits', p.limits,
    'features', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(p.features) f),
    'is_public', p.is_public, 'sort_order', p.sort_order);
$$;

create or replace function public.admin_create_package(input jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
  v_row public.packages;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform private.package_input_check(input, true);

  insert into public.packages (code, name, description, currency, price_monthly, price_yearly, trial_days,
                               limits, features, is_public, sort_order, is_active, is_default)
  values (input->>'code', btrim(input->>'name'), nullif(btrim(coalesce(input->>'description', '')), ''),
          input->>'currency', (input->>'price_monthly')::bigint, (input->>'price_yearly')::bigint,
          (input->>'trial_days')::int, input->'limits',
          (select coalesce(array_agg(distinct f order by f), '{}') from jsonb_array_elements_text(input->'features') f),
          (input->>'is_public')::boolean, (input->>'sort_order')::int, true, false)
  returning * into v_row;
  v_id := v_row.id;

  perform private.write_audit(null, v_uid, 'package.created', 'package', v_id::text,
    jsonb_build_object('code', v_row.code, 'before', null, 'after', private.package_snapshot(v_row)));
  return v_id;
end;
$$;

create or replace function public.admin_update_package(package_id uuid, input jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_old    public.packages;
  v_new    public.packages;
  v_before jsonb;
  v_after  jsonb;
  v_bd     jsonb;
  v_ad     jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform private.package_input_check(input, false);

  select * into v_old from public.packages p where p.id = admin_update_package.package_id for update;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if input->>'currency' <> v_old.currency
     and exists (select 1 from public.subscriptions s where s.package_id = v_old.id) then
    raise exception 'PACKAGE_IN_USE' using errcode = 'P0001';
  end if;

  update public.packages p set
    name = btrim(input->>'name'),
    description = nullif(btrim(coalesce(input->>'description', '')), ''),
    currency = input->>'currency',
    price_monthly = (input->>'price_monthly')::bigint,
    price_yearly = (input->>'price_yearly')::bigint,
    trial_days = (input->>'trial_days')::int,
    limits = input->'limits',
    features = (select coalesce(array_agg(distinct f order by f), '{}') from jsonb_array_elements_text(input->'features') f),
    is_public = (input->>'is_public')::boolean,
    sort_order = (input->>'sort_order')::int,
    updated_at = now()
  where p.id = v_old.id
  returning * into v_new;

  v_before := private.package_snapshot(v_old);
  v_after  := private.package_snapshot(v_new);
  if v_before = v_after then
    -- no-op: undo the updated_at bump by raising nothing; row identical except updated_at, keep it unchanged
    update public.packages p set updated_at = v_old.updated_at where p.id = v_old.id;
    return false;
  end if;

  select coalesce(jsonb_object_agg(k, v_before->k), '{}'::jsonb), coalesce(jsonb_object_agg(k, v_after->k), '{}'::jsonb)
    into v_bd, v_ad
    from jsonb_object_keys(v_after) k
   where v_before->k is distinct from v_after->k;

  perform private.write_audit(null, v_uid, 'package.updated', 'package', v_old.id::text,
    jsonb_build_object('code', v_old.code, 'before', v_bd, 'after', v_ad));
  return true;
end;
$$;

create or replace function public.admin_set_package_active(package_id uuid, active boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.packages;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if admin_set_package_active.active is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select * into v_old from public.packages p where p.id = admin_set_package_active.package_id for update;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.is_active = admin_set_package_active.active then
    return false;
  end if;
  if not admin_set_package_active.active and v_old.is_default then
    raise exception 'DEFAULT_PACKAGE' using errcode = 'P0001';
  end if;

  update public.packages p set is_active = admin_set_package_active.active, updated_at = now() where p.id = v_old.id;

  perform private.write_audit(null, v_uid,
    case when admin_set_package_active.active then 'package.restored' else 'package.archived' end,
    'package', v_old.id::text,
    jsonb_build_object('code', v_old.code,
      'before', jsonb_build_object('is_active', v_old.is_active),
      'after', jsonb_build_object('is_active', admin_set_package_active.active)));
  return true;
end;
$$;

create or replace function public.admin_set_default_package(package_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_new  public.packages;
  v_prev text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Serialise concurrent callers: lock every package row in id order before reading or changing the default.
  perform 1 from (select p.id from public.packages p order by p.id for update) l;

  select * into v_new from public.packages p where p.id = admin_set_default_package.package_id;
  if not found then
    raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not v_new.is_active then
    raise exception 'PACKAGE_INACTIVE' using errcode = 'P0001';
  end if;
  if v_new.is_default then
    return false;
  end if;

  select p.code into v_prev from public.packages p where p.is_default;
  update public.packages p set is_default = false, updated_at = now() where p.is_default;
  update public.packages p set is_default = true, updated_at = now() where p.id = v_new.id;

  perform private.write_audit(null, v_uid, 'package.default_changed', 'package', v_new.id::text,
    jsonb_build_object('code', v_new.code,
      'before', jsonb_build_object('default_code', v_prev),
      'after', jsonb_build_object('default_code', v_new.code)));
  return true;
end;
$$;

revoke execute on function
  public.admin_create_package(jsonb),
  public.admin_update_package(uuid, jsonb),
  public.admin_set_package_active(uuid, boolean),
  public.admin_set_default_package(uuid)
  from public, anon, authenticated;
grant execute on function
  public.admin_create_package(jsonb),
  public.admin_update_package(uuid, jsonb),
  public.admin_set_package_active(uuid, boolean),
  public.admin_set_default_package(uuid)
  to authenticated;
-- private helpers are not callable by clients (default privileges revoke covers new functions? be explicit)
revoke execute on function private.package_input_check(jsonb, boolean), private.package_snapshot(public.packages)
  from public, anon, authenticated;
