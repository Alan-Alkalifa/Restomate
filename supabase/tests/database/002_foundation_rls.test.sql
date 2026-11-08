begin;
select plan(11);

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
insert into public.organization_members (id, organization_id, user_id, role_id, all_locations) values
  ('40000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a1',true),
  ('40000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-0000000000a2',true),
  ('40000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-0000000000a3',false);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.try_deactivate_owner() returns int language plpgsql as $$
declare n int;
begin
  update public.organization_members set status='deactivated' where id='40000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  return n;
end $$;

create function pg_temp.try_self_promote() returns int language plpgsql as $$
declare n int;
begin
  update public.organization_members set role_id='20000000-0000-0000-0000-0000000000a1' where id='40000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  return n;
end $$;

-- anon sees only the public catalog
set local role anon;
select throws_ok($$select * from public.organizations$$, '42501', null, 'anon cannot read organizations');
select throws_ok($$select * from public.permissions$$, '42501', null, 'anon cannot read permissions');
reset role;

-- manager escalation attempts
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select is(pg_temp.try_self_promote(), 0, 'manager cannot self-promote to owner');
select is(pg_temp.try_deactivate_owner(), 0, 'manager cannot deactivate owner');
select throws_ok($$insert into public.role_permissions values ('20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-00000000000a','billing.manage')$$, '42501', null, 'manager cannot grant permissions to a role');
select throws_ok($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a2')$$, '42501', null, 'member cannot insert platform_admins');
select throws_ok($$select * from public.platform_settings$$, '42501', null, 'no client access to platform_settings');
select is((select count(*)::int from public.subscriptions), 0, 'manager cannot read subscriptions');

-- suspended org
reset role;
update public.organizations set status='suspended' where id='10000000-0000-0000-0000-00000000000a';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select ok(not public.has_permission('10000000-0000-0000-0000-00000000000a','menu.manage'), 'suspended: owner has_permission false');
select is((select status from public.organizations where id='10000000-0000-0000-0000-00000000000a'), 'suspended', 'suspended: member still reads own organization row');
select is((select count(*)::int from public.roles), 0, 'suspended: tenant data (roles) blocked');

select * from finish();
rollback;
