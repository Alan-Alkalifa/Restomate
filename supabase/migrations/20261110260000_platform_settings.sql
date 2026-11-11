-- MSS-T08: typed platform settings, public flags, signup guard.
-- platform_settings keeps NO client grants and NO client policy; everything goes through the definer functions below.
-- API keys: signup, maintenance_banner, tax_presets, owned_org_cap. owned_org_cap is stored in the EXISTING row
-- 'max_owned_organizations' as a bare integer, because create_organization already reads that row.

create or replace function private.platform_setting_default(api_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case api_key
    when 'signup' then '{"enabled":true}'::jsonb
    when 'maintenance_banner' then '{"enabled":false,"message":"","level":"info"}'::jsonb
    when 'tax_presets' then '{"presets":[
        {"code":"pb1_10","label":"PB1 10%","taxRateBps":1000,"serviceChargeBps":0,"taxOnServiceCharge":true},
        {"code":"pb1_10_sc5","label":"PB1 10% + service 5%","taxRateBps":1000,"serviceChargeBps":500,"taxOnServiceCharge":true}],
        "defaultCode":"pb1_10"}'::jsonb
    when 'owned_org_cap' then '{"max":3}'::jsonb
  end;
$$;

-- Validates and normalises one setting value. Raises INVALID_SETTING_KEY / INVALID_SETTING (P0001).
create or replace function private.platform_setting_normalize(api_key text, val jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_msg    text;
  v_item   jsonb;
  v_codes  text[] := '{}';
  v_out    jsonb := '[]'::jsonb;
  v_code   text;
  v_label  text;
  v_n      int;
begin
  if api_key is null or api_key not in ('signup', 'maintenance_banner', 'tax_presets', 'owned_org_cap') then
    raise exception 'INVALID_SETTING_KEY' using errcode = 'P0001';
  end if;
  if val is null or jsonb_typeof(val) <> 'object' then
    raise exception 'INVALID_SETTING' using errcode = 'P0001';
  end if;

  if api_key = 'signup' then
    if (select array_agg(k order by k) from jsonb_object_keys(val) k) is distinct from array['enabled']
       or jsonb_typeof(val->'enabled') <> 'boolean' then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    return jsonb_build_object('enabled', (val->>'enabled')::boolean);

  elsif api_key = 'maintenance_banner' then
    if (select array_agg(k order by k) from jsonb_object_keys(val) k) is distinct from array['enabled', 'level', 'message']
       or jsonb_typeof(val->'enabled') <> 'boolean'
       or jsonb_typeof(val->'message') <> 'string'
       or jsonb_typeof(val->'level') <> 'string'
       or (val->>'level') not in ('info', 'warning') then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    v_msg := btrim(val->>'message');
    if char_length(v_msg) > 200 or v_msg ~ '[[:cntrl:]]' or v_msg ~ '[<>]'
       or ((val->>'enabled')::boolean and v_msg = '') then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    return jsonb_build_object('enabled', (val->>'enabled')::boolean, 'message', v_msg, 'level', val->>'level');

  elsif api_key = 'tax_presets' then
    if (select array_agg(k order by k) from jsonb_object_keys(val) k) is distinct from array['defaultCode', 'presets']
       or jsonb_typeof(val->'presets') <> 'array'
       or jsonb_typeof(val->'defaultCode') <> 'string'
       or jsonb_array_length(val->'presets') not between 1 and 20 then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    for v_item in select * from jsonb_array_elements(val->'presets') loop
      if jsonb_typeof(v_item) <> 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_item) k)
            is distinct from array['code', 'label', 'serviceChargeBps', 'taxOnServiceCharge', 'taxRateBps']
         or jsonb_typeof(v_item->'code') <> 'string' or jsonb_typeof(v_item->'label') <> 'string'
         or jsonb_typeof(v_item->'taxOnServiceCharge') <> 'boolean'
         or jsonb_typeof(v_item->'taxRateBps') <> 'number' or jsonb_typeof(v_item->'serviceChargeBps') <> 'number' then
        raise exception 'INVALID_SETTING' using errcode = 'P0001';
      end if;
      v_code := v_item->>'code';
      v_label := btrim(v_item->>'label');
      -- jsonb keeps "1000.0" as written, so the digit-only test also rejects non-integers
      if v_code !~ '^[a-z][a-z0-9_-]{1,29}$' or v_code = any (v_codes)
         or char_length(v_label) not between 1 and 60 or v_label ~ '[[:cntrl:]]'
         or (v_item->>'taxRateBps') !~ '^\d{1,5}$' or (v_item->>'taxRateBps')::int > 10000
         or (v_item->>'serviceChargeBps') !~ '^\d{1,5}$' or (v_item->>'serviceChargeBps')::int > 10000 then
        raise exception 'INVALID_SETTING' using errcode = 'P0001';
      end if;
      v_codes := v_codes || v_code;
      v_out := v_out || jsonb_build_object('code', v_code, 'label', v_label,
        'taxRateBps', (v_item->>'taxRateBps')::int, 'serviceChargeBps', (v_item->>'serviceChargeBps')::int,
        'taxOnServiceCharge', (v_item->>'taxOnServiceCharge')::boolean);
    end loop;
    if not ((val->>'defaultCode') = any (v_codes)) then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    return jsonb_build_object('presets', v_out, 'defaultCode', val->>'defaultCode');

  else -- owned_org_cap
    if (select array_agg(k order by k) from jsonb_object_keys(val) k) is distinct from array['max']
       or jsonb_typeof(val->'max') <> 'number' or (val->>'max') !~ '^\d{1,3}$' then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    v_n := (val->>'max')::int;
    if v_n not between 1 and 100 then
      raise exception 'INVALID_SETTING' using errcode = 'P0001';
    end if;
    return jsonb_build_object('max', v_n);
  end if;
end;
$$;

-- Current value of one setting: stored (normalised) or the default. A bad stored row falls back to the default.
create or replace function private.platform_setting_get(api_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row text := case api_key when 'owned_org_cap' then 'max_owned_organizations' else api_key end;
  v_val jsonb;
begin
  select ps.value into v_val from public.platform_settings ps where ps.key = v_row;
  if not found then
    return private.platform_setting_default(api_key);
  end if;
  if api_key = 'owned_org_cap' then
    v_val := jsonb_build_object('max', v_val); -- stored as a bare integer
  end if;
  begin
    return private.platform_setting_normalize(api_key, v_val);
  exception when others then
    return private.platform_setting_default(api_key);
  end;
end;
$$;

create or replace function public.admin_get_platform_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'signup', private.platform_setting_get('signup'),
    'maintenance_banner', private.platform_setting_get('maintenance_banner'),
    'tax_presets', private.platform_setting_get('tax_presets'),
    'owned_org_cap', private.platform_setting_get('owned_org_cap'));
end;
$$;

create or replace function public.admin_update_platform_setting(key text, value jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_after  jsonb;
  v_before jsonb;
  v_row    text;
  v_store  jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_after := private.platform_setting_normalize(admin_update_platform_setting.key, admin_update_platform_setting.value);

  perform pg_advisory_xact_lock(hashtextextended('platform_setting:' || admin_update_platform_setting.key, 0));
  v_before := private.platform_setting_get(admin_update_platform_setting.key);
  if v_before = v_after then
    return false; -- no-op: nothing written, no audit row
  end if;

  v_row := case admin_update_platform_setting.key when 'owned_org_cap' then 'max_owned_organizations'
                                                   else admin_update_platform_setting.key end;
  v_store := case admin_update_platform_setting.key when 'owned_org_cap' then v_after->'max' else v_after end;
  insert into public.platform_settings (key, value, updated_by) values (v_row, v_store, v_uid)
  on conflict on constraint platform_settings_pkey do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

  perform private.write_audit(null, v_uid, 'platform_setting.updated', 'platform_setting',
    admin_update_platform_setting.key,
    jsonb_build_object('key', admin_update_platform_setting.key, 'before', v_before, 'after', v_after));
  return true;
end;
$$;

-- Public: ONLY these two values, nothing else. A disabled banner returns null so its text never leaks.
create or replace function public.get_public_platform_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'signupEnabled', (private.platform_setting_get('signup')->>'enabled')::boolean,
    'maintenanceBanner', case when (private.platform_setting_get('maintenance_banner')->>'enabled')::boolean
                              then private.platform_setting_get('maintenance_banner') else null end);
$$;

-- Signup guard: client roles (authenticated, anon) cannot create organizations while signup is off. Decided on the
-- request's JWT role claim, because create_organization is security definer (current_user would always be the owner).
-- service_role and the table owner (no claim: seed, fixtures, psql) are exempt.
create or replace function private.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role in ('authenticated', 'anon')
     and not (private.platform_setting_get('signup')->>'enabled')::boolean then
    raise exception 'SIGNUP_DISABLED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger organizations_signup_guard
  before insert on public.organizations
  for each row execute function private.guard_signup();

revoke execute on function
  public.admin_get_platform_settings(),
  public.admin_update_platform_setting(text, jsonb),
  public.get_public_platform_flags()
  from public, anon, authenticated;
grant execute on function public.admin_get_platform_settings(), public.admin_update_platform_setting(text, jsonb)
  to authenticated;
grant execute on function public.get_public_platform_flags() to anon, authenticated;
revoke execute on function
  private.platform_setting_default(text), private.platform_setting_normalize(text, jsonb),
  private.platform_setting_get(text), private.guard_signup()
  from public, anon, authenticated;
