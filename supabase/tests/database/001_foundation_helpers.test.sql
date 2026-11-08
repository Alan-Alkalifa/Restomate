begin;
select plan(31);

-- fixtures (as postgres) ----------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@a.test','{"full_name":"Olive Owner"}',now(),now()),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager@a.test','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier@a.test','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gone@a.test','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider@b.test','{}',now(),now());

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-00000000000a','resto-a','Resto A'),
  ('10000000-0000-0000-0000-00000000000b','resto-b','Resto B');

insert into public.roles (id, organization_id, key, name, is_system) values
  ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','owner','Owner',true),
  ('20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','manager','Manager',true),
  ('20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','cashier','Cashier',true);

insert into public.role_permissions (role_id, organization_id, permission_key)
select '20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a', permission_key
from public.default_role_permissions where role_key='manager';
insert into public.role_permissions (role_id, organization_id, permission_key)
select '20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a', permission_key
from public.default_role_permissions where role_key='cashier';

insert into public.locations (id, organization_id, name) values
  ('30000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','Main'),
  ('30000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','Branch');

insert into public.organization_members (id, organization_id, user_id, role_id, status, all_locations) values
  ('40000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a1','active',false),
  ('40000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-0000000000a2','active',true),
  ('40000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-0000000000a3','active',false),
  ('40000000-0000-0000-0000-0000000000a4','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a4','20000000-0000-0000-0000-0000000000a3','deactivated',true);
insert into public.location_staff (member_id, location_id, organization_id) values
  ('40000000-0000-0000-0000-0000000000a3','30000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a');

-- profile trigger -------------------------------------------------------------
select is((select full_name from public.profiles where id='00000000-0000-0000-0000-0000000000a1'), 'Olive Owner', 'profile created from auth.users with full_name');
update auth.users set email='owner2@a.test' where id='00000000-0000-0000-0000-0000000000a1';
select is((select email from public.profiles where id='00000000-0000-0000-0000-0000000000a1'), 'owner2@a.test', 'profile email synced');

-- structural -----------------------------------------------------------------
select is((select count(*)::int from public.permissions), 23, '23 permission keys');
select is((select count(*)::int from public.default_role_permissions where role_key='manager'), 20, 'manager template has 20 keys');
select is((select count(*)::int from public.default_role_permissions where role_key='cashier'), 8, 'cashier template has 8 keys');
select is((select count(*)::int from public.default_role_permissions where role_key='waiter'), 6, 'waiter template has 6 keys');
select is((select count(*)::int from public.default_role_permissions where role_key='kitchen'), 3, 'kitchen template has 3 keys');

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
  null, 'every public table has RLS enabled');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','private') and p.prosecdef
     and not (coalesce(p.proconfig,'{}') @> array['search_path=""'])),
  0, 'all security definer functions pin search_path to empty');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema='public' and data_type in ('real','double precision','numeric','money')),
  0, 'no float/numeric/money columns in public');

select ok(not has_schema_privilege('authenticated','private','usage'), 'authenticated has no usage on private');
select ok(not has_schema_privilege('anon','private','usage'), 'anon has no usage on private');

-- slug check -----------------------------------------------------------------
select lives_ok($$insert into public.organizations (slug,name) values ('good-slug','Good')$$, 'valid slug accepted');
select throws_ok($$insert into public.organizations (slug,name) values ('ab','X')$$, '23514', null, 'too short slug rejected');
select throws_ok($$insert into public.organizations (slug,name) values ('Bad-Slug','X')$$, '23514', null, 'uppercase slug rejected');
select throws_ok($$insert into public.organizations (slug,name) values ('-bad','X')$$, '23514', null, 'leading hyphen rejected');
select throws_ok($$insert into public.organizations (slug,name) values ('bad-','X')$$, '23514', null, 'trailing hyphen rejected');
select throws_ok($$insert into public.organizations (slug,name) values ('has_underscore','X')$$, '23514', null, 'underscore rejected');
select throws_ok($$insert into public.organizations (slug,name) values (repeat('a',41),'X')$$, '23514', null, '41 char slug rejected');
select throws_ok($$insert into public.organizations (slug,name) values ('admin','X')$$, '23514', 'SLUG_RESERVED', 'reserved slug rejected');

-- helpers as each user ---------------------------------------------------------
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select ok(public.is_org_member('10000000-0000-0000-0000-00000000000a'), 'owner is member');
select ok(public.has_permission('10000000-0000-0000-0000-00000000000a','billing.manage'), 'owner has billing.manage');
select ok(not public.has_permission('10000000-0000-0000-0000-00000000000a','anything.at_all'), 'unknown permission key is false even for the owner');
select ok(not public.has_permission('10000000-0000-0000-0000-00000000000b','menu.manage'), 'owner has nothing in org B');
select ok(public.has_location_access('30000000-0000-0000-0000-0000000000a2'), 'owner has access to all locations');
select is(cardinality(public.my_permissions('10000000-0000-0000-0000-00000000000a')), 23, 'owner my_permissions = all 23');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select ok(public.has_permission('10000000-0000-0000-0000-00000000000a','staff.manage') and not public.has_permission('10000000-0000-0000-0000-00000000000a','billing.manage'), 'manager: staff yes, billing no');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select is(cardinality(public.my_permissions('10000000-0000-0000-0000-00000000000a')), 8, 'cashier my_permissions = 8');
select ok(public.has_location_access('30000000-0000-0000-0000-0000000000a1') and not public.has_location_access('30000000-0000-0000-0000-0000000000a2'), 'cashier limited to assigned location');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select ok(not public.is_org_member('10000000-0000-0000-0000-00000000000a') and not public.has_permission('10000000-0000-0000-0000-00000000000a','pos.use'), 'deactivated member has no access');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select ok(not public.is_org_member('10000000-0000-0000-0000-00000000000a') and not public.has_permission('10000000-0000-0000-0000-00000000000a','pos.use'), 'non-member has no access');

select * from finish();
rollback;
