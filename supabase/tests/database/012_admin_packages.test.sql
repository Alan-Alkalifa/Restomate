begin;
select plan(25);

delete from public.subscriptions;
delete from public.packages;
delete from public.platform_admins;
delete from public.audit_logs where entity_type = 'package';

insert into public.packages (code, name, is_default) values ('t-basic', 'Basic', true), ('t-pro', 'Pro', false);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@pk.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@pk.test',now(),now());
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000f1','admin@pk.test'),
  ('00000000-0000-0000-0000-0000000000f2','owner@pk.test')
on conflict (id) do update set email = excluded.email;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000f1');
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-0000000000f1','pk-org','Pk Org');
insert into public.subscriptions (organization_id, package_id, status)
select '10000000-0000-0000-0000-0000000000f1', id, 'active' from public.packages where code = 't-pro';

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.valid(over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('code','t-new','name','New','description',null,'currency','IDR','price_monthly',1000,
    'price_yearly',10000,'trial_days',7,'limits','{"max_tables":10,"max_staff":null}'::jsonb,
    'features','["qr_ordering"]'::jsonb,'is_public',true,'sort_order',5) || over $$;

-- non-admin: RPCs and direct writes are rejected
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.admin_create_package(pg_temp.valid())$$, '42501', 'FORBIDDEN', 'owner cannot create');
select throws_ok($$select public.admin_update_package((select id from public.packages where code='t-basic'), pg_temp.valid())$$, '42501', 'FORBIDDEN', 'owner cannot update');
select throws_ok($$select public.admin_set_package_active((select id from public.packages where code='t-basic'), false)$$, '42501', 'FORBIDDEN', 'owner cannot archive');
select throws_ok($$select public.admin_set_default_package((select id from public.packages where code='t-pro'))$$, '42501', 'FORBIDDEN', 'owner cannot set default');
select throws_ok($$insert into public.packages (code, name) values ('t-evil','Evil')$$, '42501', null, 'owner cannot insert directly (RLS)');
update public.packages set name = 'Hacked' where code = 't-pro';
select is((select name from public.packages where code='t-pro'), 'Pro', 'owner direct update changes nothing (RLS)');
reset role;

-- admin
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$select public.admin_create_package(pg_temp.valid())$$, 'admin creates a package');
select is((select count(*)::int from public.audit_logs where action='package.created' and actor_id='00000000-0000-0000-0000-0000000000f1' and organization_id is null), 1, 'exactly one create audit row with the admin id');
select is((select price_monthly from public.packages where code='t-new'), 1000::bigint, 'price stored as bigint minor units');

select throws_ok($$select public.admin_create_package(pg_temp.valid('{"price_monthly":10.5}'))$$, 'P0001', 'INVALID_INPUT', 'decimal price rejected');
select throws_ok($$select public.admin_create_package(pg_temp.valid('{"price_monthly":-1,"code":"t-neg"}'))$$, 'P0001', 'INVALID_INPUT', 'negative price rejected');
select throws_ok($$select public.admin_create_package(pg_temp.valid('{"limits":{"max_bogus":1},"code":"t-lim"}'))$$, 'P0001', 'INVALID_LIMIT_KEY', 'unknown limit key rejected');
select throws_ok($$select public.admin_create_package(pg_temp.valid('{"features":["teleport"],"code":"t-feat"}'))$$, 'P0001', 'INVALID_FEATURE_KEY', 'unknown feature rejected');
select throws_ok($$select public.admin_create_package(pg_temp.valid())$$, '23505', null, 'duplicate code rejected');

-- update: audit diff; no-op writes nothing
select is(public.admin_update_package((select id from public.packages where code='t-new'), (pg_temp.valid() - 'code') || '{"name":"Renamed"}'), true, 'update reports a change');
select is((select metadata->'after'->>'name' from public.audit_logs where action='package.updated'), 'Renamed', 'audit has after diff');
select is((select metadata->'before'->>'name' from public.audit_logs where action='package.updated'), 'New', 'audit has before diff');
select is(public.admin_update_package((select id from public.packages where code='t-new'), (pg_temp.valid() - 'code') || '{"name":"Renamed"}'), false, 'no-op update returns false');
select is((select count(*)::int from public.audit_logs where action='package.updated'), 1, 'no-op update writes no audit row');
select throws_ok($$select public.admin_update_package((select id from public.packages where code='t-pro'), pg_temp.valid('{"currency":"USD"}') - 'code')$$, 'P0001', 'PACKAGE_IN_USE', 'currency locked once subscribed');

-- archive: default cannot be archived; archived plan with subscriptions keeps its row
select throws_ok($$select public.admin_set_package_active((select id from public.packages where code='t-basic'), false)$$, 'P0001', 'DEFAULT_PACKAGE', 'default cannot be archived');
select is(public.admin_set_package_active((select id from public.packages where code='t-pro'), false), true, 'archive subscribed plan');
select is((select is_active from public.packages where code='t-pro'), false, 'row kept with is_active=false');

-- default
select throws_ok($$select public.admin_set_default_package((select id from public.packages where code='t-pro'))$$, 'P0001', 'PACKAGE_INACTIVE', 'archived plan cannot be default');
select public.admin_set_default_package((select id from public.packages where code='t-new'));
select is((select count(*)::int from public.packages where is_default), 1, 'exactly one default after switch');
reset role;

select * from finish();
rollback;
