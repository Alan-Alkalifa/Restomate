begin;
select plan(11);

delete from public.subscriptions;
delete from public.packages;
delete from public.platform_admins;

insert into public.packages (code, name) values ('t-basic', 'Basic'), ('t-pro', 'Pro');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@p.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@x.test',now(),now());
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','admin@p.test'),
  ('00000000-0000-0000-0000-0000000000e2','owner@x.test')
on conflict (id) do update set email = excluded.email;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000e1');

insert into public.organizations (id, slug, name, status) values
  ('10000000-0000-0000-0000-0000000000e1','tl-alpha','Alpha_Cafe','active'),
  ('10000000-0000-0000-0000-0000000000e2','tl-beta','Beta 100%','suspended');
insert into public.subscriptions (organization_id, package_id, status)
select '10000000-0000-0000-0000-0000000000e1', id, 'active' from public.packages where code = 't-pro';
insert into public.subscriptions (organization_id, package_id, status)
select '10000000-0000-0000-0000-0000000000e2', id, 'trialing' from public.packages where code = 't-basic';
insert into public.roles (id, organization_id, key, name, is_system) values
  ('20000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e1','owner','Owner',true);
insert into public.organization_members (organization_id, user_id, role_id, status) values
  ('10000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','20000000-0000-0000-0000-0000000000e1','active');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- a tenant owner is denied
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.admin_list_tenants()$$, '42501', 'FORBIDDEN', 'tenant owner is denied');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select is((public.admin_list_tenants(q => 'tl-') ->> 'total')::int, 2, 'admin sees both tenants');
select is(public.admin_list_tenants(q => 'ALPHA') -> 'rows' -> 0 ->> 'slug', 'tl-alpha', 'q is case-insensitive on name');
select is((public.admin_list_tenants(q => 'tl-beta') ->> 'total')::int, 1, 'q matches slug');
select is((public.admin_list_tenants(q => 'Alpha_Cafe') ->> 'total')::int, 1, 'underscore is matched literally');
select is((public.admin_list_tenants(q => 'a_f') ->> 'total')::int, 0, '_ is not a wildcard');
select is((public.admin_list_tenants(q => '100%') ->> 'total')::int, 1, '% matched literally');
select is((public.admin_list_tenants(q => 'tl-', status_filter => 'suspended') ->> 'total')::int, 1, 'status filter');
select is(public.admin_list_tenants(q => 'tl-', package_code => 't-pro') -> 'rows' -> 0 ->> 'ownerEmail', 'owner@x.test', 'package filter + owner email');
select is((public.admin_list_tenants(q => 'tl-', page_size => 1, page_offset => 1) -> 'rows') ->> 0 is not null, true, 'pagination returns a row');
select is((public.admin_list_tenants(q => 'tl-', page_size => 1) ->> 'total')::int, 2, 'total ignores page size');

select * from finish();
rollback;
