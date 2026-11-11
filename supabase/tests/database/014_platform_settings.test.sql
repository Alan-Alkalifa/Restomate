-- MSS-T08: platform settings RPCs, public flags, signup guard, owned-org cap.
begin;
select plan(49);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ps.test', now(), now(), now()
from generate_series(1, 4) n;
insert into public.profiles (id, email) select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, 'u' || n || '@ps.test' from generate_series(1, 4) n
on conflict (id) do update set email = excluded.email;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c4');
delete from public.platform_settings;
delete from public.audit_logs where action = 'platform_setting.updated';

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000c' || n)::uuid $$;
create function pg_temp.audits() returns int language sql as $$ select count(*)::int from public.audit_logs where action = 'platform_setting.updated' $$;
create function pg_temp.keys(j jsonb) returns text language sql as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(j) k $$;

-- ---- no client access to the table -------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.platform_settings', 'select')
      and not has_table_privilege('authenticated', 'public.platform_settings', 'insert')
      and not has_table_privilege('authenticated', 'public.platform_settings', 'update')
      and not has_table_privilege('anon', 'public.platform_settings', 'select'), 'platform_settings has no client grants');

-- ---- admin RPCs: platform admin only ---------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok($$select public.admin_get_platform_settings()$$, '42501', 'FORBIDDEN', 'non-admin cannot read settings');
select throws_ok($$select public.admin_update_platform_setting('signup', '{"enabled":false}')$$, '42501', 'FORBIDDEN', 'non-admin cannot update settings');
reset role;
set local role anon;
select throws_ok($$select public.admin_get_platform_settings()$$, '42501', null, 'anon cannot read settings');
select throws_ok($$select public.admin_update_platform_setting('signup', '{"enabled":false}')$$, '42501', null, 'anon cannot update settings');
reset role;
select is((select count(*)::int from public.platform_settings), 0, 'denied callers wrote nothing');

-- ---- defaults and public flags -----------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select is(public.admin_get_platform_settings()->'signup', '{"enabled":true}'::jsonb, 'default: signup on');
select is(jsonb_array_length(public.admin_get_platform_settings()->'tax_presets'->'presets'), 2, 'default: two tax presets');
select is(public.admin_get_platform_settings()->'owned_org_cap', '{"max":3}'::jsonb, 'default: cap 3');
reset role;
set local role anon;
select is(pg_temp.keys(public.get_public_platform_flags()), 'maintenanceBanner,signupEnabled', 'anon gets exactly the two public flags');
select is(public.get_public_platform_flags()->'maintenanceBanner', 'null'::jsonb, 'disabled banner is null');
reset role;

-- ---- validation ---------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok($$select public.admin_update_platform_setting('bogus', '{}')$$, 'P0001', 'INVALID_SETTING_KEY', 'unknown key rejected');
select throws_ok($$select public.admin_update_platform_setting('signup', '{"enabled":"yes"}')$$, 'P0001', 'INVALID_SETTING', 'wrong type rejected');
select throws_ok($$select public.admin_update_platform_setting('signup', '{"enabled":true,"x":1}')$$, 'P0001', 'INVALID_SETTING', 'extra field rejected');
select throws_ok($$select public.admin_update_platform_setting('maintenance_banner', jsonb_build_object('enabled', true, 'message', repeat('a', 201), 'level', 'info'))$$, 'P0001', 'INVALID_SETTING', 'banner over 200 chars rejected');
select throws_ok($$select public.admin_update_platform_setting('maintenance_banner', '{"enabled":true,"message":"<script>x</script>","level":"info"}')$$, 'P0001', 'INVALID_SETTING', 'banner with angle brackets rejected');
select throws_ok($$select public.admin_update_platform_setting('maintenance_banner', '{"enabled":true,"message":"  ","level":"info"}')$$, 'P0001', 'INVALID_SETTING', 'enabled banner needs a message');
select throws_ok($$select public.admin_update_platform_setting('maintenance_banner', '{"enabled":true,"message":"x","level":"error"}')$$, 'P0001', 'INVALID_SETTING', 'bad banner level rejected');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"a1","label":"A","taxRateBps":10001,"serviceChargeBps":0,"taxOnServiceCharge":true}],"defaultCode":"a1"}')$$, 'P0001', 'INVALID_SETTING', 'rate above 10000 bps rejected');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"a1","label":"A","taxRateBps":1000.5,"serviceChargeBps":0,"taxOnServiceCharge":true}],"defaultCode":"a1"}')$$, 'P0001', 'INVALID_SETTING', 'fractional rate rejected');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"a1","label":"A","taxRateBps":1000.0,"serviceChargeBps":0,"taxOnServiceCharge":true}],"defaultCode":"a1"}')$$, 'P0001', 'INVALID_SETTING', 'float-written rate rejected');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"a1","label":"A","taxRateBps":1,"serviceChargeBps":0,"taxOnServiceCharge":true},{"code":"a1","label":"B","taxRateBps":2,"serviceChargeBps":0,"taxOnServiceCharge":true}],"defaultCode":"a1"}')$$, 'P0001', 'INVALID_SETTING', 'duplicate preset code rejected');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"a1","label":"A","taxRateBps":1,"serviceChargeBps":0,"taxOnServiceCharge":true}],"defaultCode":"zz"}')$$, 'P0001', 'INVALID_SETTING', 'defaultCode must be a preset');
select throws_ok($$select public.admin_update_platform_setting('tax_presets', '{"presets":[],"defaultCode":"a1"}')$$, 'P0001', 'INVALID_SETTING', 'at least one preset');
select throws_ok($$select public.admin_update_platform_setting('owned_org_cap', '{"max":0}')$$, 'P0001', 'INVALID_SETTING', 'cap 0 rejected');
select throws_ok($$select public.admin_update_platform_setting('owned_org_cap', '{"max":101}')$$, 'P0001', 'INVALID_SETTING', 'cap 101 rejected');
select throws_ok($$select public.admin_update_platform_setting('owned_org_cap', '{"max":2.5}')$$, 'P0001', 'INVALID_SETTING', 'fractional cap rejected');
reset role;
select is(pg_temp.audits(), 0, 'rejected writes left no audit row');

-- ---- writes, audit, no-op -----------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select is(public.admin_update_platform_setting('maintenance_banner', '{"enabled":true,"message":"  Back at 10:00  ","level":"warning"}'), true, 'banner update reports a change');
select is(public.admin_update_platform_setting('maintenance_banner', '{"enabled":true,"message":"Back at 10:00","level":"warning"}'), false, 'same value (after trimming) is a no-op');
select is(public.admin_update_platform_setting('tax_presets', '{"presets":[{"code":"pb1_8","label":"PB1 8%","taxRateBps":800,"serviceChargeBps":250,"taxOnServiceCharge":false}],"defaultCode":"pb1_8"}'), true, 'tax presets update');
reset role;
select is(pg_temp.audits(), 2, 'one audit row per real change, none for the no-op');
select is((select metadata->'after'->>'message' from public.audit_logs where action = 'platform_setting.updated' and entity_id = 'maintenance_banner'), 'Back at 10:00', 'audit has the normalised after value');
select is((select metadata->'before'->>'enabled' from public.audit_logs where action = 'platform_setting.updated' and entity_id = 'maintenance_banner'), 'false', 'audit has the before value');
select is((select count(*)::int from public.audit_logs where action = 'platform_setting.updated' and organization_id is null and actor_id = pg_temp.uid(4)), 2, 'audit rows carry the admin id and no org');
select is(jsonb_typeof(value->'presets'->0->'taxRateBps'), 'number', 'rates are stored as JSON numbers') from public.platform_settings where key = 'tax_presets';
select is((value->'presets'->0->>'taxRateBps'), '800', 'rate stored as integer basis points') from public.platform_settings where key = 'tax_presets';

set local role anon;
select is(public.get_public_platform_flags()->'maintenanceBanner', '{"enabled":true,"message":"Back at 10:00","level":"warning"}'::jsonb, 'enabled banner is public');
reset role;

-- ---- owned org cap (stored in the existing row, read by create_organization) -------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select public.admin_update_platform_setting('owned_org_cap', '{"max":1}');
reset role;
select is((select value from public.platform_settings where key = 'max_owned_organizations'), '1'::jsonb, 'cap stored as a bare integer in the existing row');
select pg_temp.act_as(pg_temp.uid(1));
select lives_ok($$select public.create_organization('Org One', 'ps-one', '{"name":"L1"}'::jsonb)$$, 'first org is within the cap');
select throws_ok($$select public.create_organization('Org Two', 'ps-two', '{"name":"L1"}'::jsonb)$$, 'P0001', 'ORG_LIMIT_REACHED', 'cap 1 is enforced by the existing trigger path');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select public.admin_update_platform_setting('owned_org_cap', '{"max":2}');
reset role;
select pg_temp.act_as(pg_temp.uid(1));
select lives_ok($$select public.create_organization('Org Two', 'ps-two', '{"name":"L1"}'::jsonb)$$, 'raising the cap takes effect immediately');
reset role;

-- ---- signup off ---------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select public.admin_update_platform_setting('signup', '{"enabled":false}');
reset role;
set local role anon;
select is(public.get_public_platform_flags()->>'signupEnabled', 'false', 'public flag shows signup off');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$select public.create_organization('Org Three', 'ps-three', '{"name":"L1"}'::jsonb)$$, 'P0001', 'SIGNUP_DISABLED', 'create_organization is refused while signup is off');
reset role;
-- a platform admin is not exempt on the public flow
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok($$select public.create_organization('Org Admin', 'ps-admin', '{"name":"L1"}'::jsonb)$$, 'P0001', 'SIGNUP_DISABLED', 'platform admin is not exempt');
reset role;
-- exemptions: service_role and the table owner
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok($$insert into public.organizations (slug, name) values ('ps-svc', 'Service Org')$$, 'service_role is exempt');
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok($$insert into public.organizations (slug, name) values ('ps-owner', 'Owner Org')$$, 'the table owner (seed, fixtures) is exempt');
-- sign-in side is untouched: existing members still read their org
select pg_temp.act_as(pg_temp.uid(1));
select is((select count(*)::int from public.organizations where slug = 'ps-one'), 1, 'existing users keep working');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select public.admin_update_platform_setting('signup', '{"enabled":true}');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok($$select public.create_organization('Org Three', 'ps-three', '{"name":"L1"}'::jsonb)$$, 'creation works again once signup is back on');
reset role;

select * from finish();
rollback;
