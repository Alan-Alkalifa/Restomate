begin;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@a.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager@a.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier@a.test',now(),now());
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-00000000000a','resto-a','Resto A');
insert into public.roles (id, organization_id, key, name, is_system) values
  ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','owner','Owner',true),
  ('20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','manager','Manager',true),
  ('20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','cashier','Cashier',true);
insert into public.role_permissions (role_id, organization_id, permission_key)
select '20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a', permission_key from public.default_role_permissions where role_key='manager';
insert into public.role_permissions (role_id, organization_id, permission_key)
select '20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a', permission_key from public.default_role_permissions where role_key='cashier';
insert into public.organization_members (id, organization_id, user_id, role_id, all_locations) values
  ('40000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a1',true),
  ('40000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-0000000000a2',true),
  ('40000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-0000000000a3',false);

-- org B with its own owner (cross-org probe)
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@b.test',now(),now());
insert into public.organizations (id, slug, name) values ('10000000-0000-0000-0000-00000000000b','resto-b','Resto B');
insert into public.roles (id, organization_id, key, name, is_system) values
  ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','owner','Owner',true);
insert into public.organization_members (id, organization_id, user_id, role_id, all_locations) values
  ('40000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000b1',true);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.try_delete_member() returns int language plpgsql as $$
declare n int;
begin
  delete from public.organization_members where id='40000000-0000-0000-0000-0000000000a3';
  get diagnostics n = row_count; return n;
end $$;

-- profiles read scope
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.profiles), 1, 'cashier sees only own profile');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.profiles), 3, 'manager (staff.manage) sees all co-member profiles');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.profiles), 3, 'owner sees all co-member profiles');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.profiles), 1, 'owner of org B cannot read org A profiles');

-- no client deletes on organization_members
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select pg_temp.try_delete_member()$$, '42501', null, 'owner cannot delete a member');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select pg_temp.try_delete_member()$$, '42501', null, 'manager cannot delete a member');

-- platform_settings explicit deny
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='platform_settings' and policyname='platform_settings_no_client_access'), 'platform_settings has explicit deny policy');
reset role;

-- suspended truth table
update public.organizations set status='suspended' where id='10000000-0000-0000-0000-00000000000a';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select ok(not public.is_org_member('10000000-0000-0000-0000-00000000000a'), 'suspended: manager not a member');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select ok(not public.has_permission('10000000-0000-0000-0000-00000000000a','pos.use') and not public.has_location_access('30000000-0000-0000-0000-0000000000a1'), 'suspended: cashier has no permission or location access');
select is(public.my_permissions('10000000-0000-0000-0000-00000000000a'), '{}'::text[], 'suspended: my_permissions empty');

select * from finish();
rollback;
