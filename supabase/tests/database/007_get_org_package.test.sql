begin;
select plan(17);

-- independent of seed.sql
delete from public.subscriptions;
delete from public.packages;

insert into public.packages (code, name, features, limits, price_monthly)
values ('t-pkg', 'Test Plan', array['qr_ordering'], '{"max_tables": 10, "max_staff": null}', 123456);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier@a.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gone@a.test',now(),now()),
  ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out@b.test',now(),now());

insert into public.organizations (id, slug, name) values
  ('10000000-0000-0000-0000-0000000000d1','pkg-a','Pkg A'),
  ('10000000-0000-0000-0000-0000000000d2','pkg-b','Pkg B');
insert into public.subscriptions (organization_id, package_id, status)
select o.id, (select id from public.packages where code = 't-pkg'), 'active' from public.organizations o
where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
update public.subscriptions set status = 'canceled' where organization_id = '10000000-0000-0000-0000-0000000000d2';

insert into public.roles (id, organization_id, key, name, is_system) values
  ('20000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000d1','cashier','Cashier',true);
insert into public.organization_members (organization_id, user_id, role_id, status) values
  ('10000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1','20000000-0000-0000-0000-0000000000d1','active'),
  ('10000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','20000000-0000-0000-0000-0000000000d1','deactivated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(public.get_org_package('10000000-0000-0000-0000-0000000000d1') ->> 'code', 't-pkg', 'a cashier (no billing.manage) gets the package');
select is(public.get_org_package('10000000-0000-0000-0000-0000000000d1') -> 'features', '["qr_ordering"]'::jsonb, 'features returned');
select is(public.get_org_package('10000000-0000-0000-0000-0000000000d1') -> 'limits', '{"max_tables": 10, "max_staff": null}'::jsonb, 'limits returned');
select ok(not (public.get_org_package('10000000-0000-0000-0000-0000000000d1') ? 'price_monthly'), 'no prices leak');
select is(public.get_org_package('10000000-0000-0000-0000-0000000000d2'), null, 'member of A gets nothing for org B');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select is(public.get_org_package('10000000-0000-0000-0000-0000000000d1'), null, 'deactivated member gets nothing');
set local role anon;
select throws_ok($$select public.get_org_package('10000000-0000-0000-0000-0000000000d1')$$, '42501', null, 'anon cannot execute');

-- my_org_membership ------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(public.my_org_membership('pkg-a') -> 'org' ->> 'slug', 'pkg-a', 'member gets their membership');
select is(public.my_org_membership('PKG-A') -> 'role' ->> 'key', 'cashier', 'slug is case-insensitive; role key returned');
select is(public.my_org_membership('pkg-a') ->> 'all_locations', 'false', 'all_locations returned');
select is(public.my_org_membership('pkg-b'), null, 'org the caller is not in -> null');
select is(public.my_org_membership('nope'), null, 'unknown slug -> null (same as non-member)');
reset role;
update public.organizations set status = 'suspended' where slug = 'pkg-a';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(public.my_org_membership('pkg-a') -> 'org' ->> 'status', 'suspended', 'suspended org: membership still returned (with role)');
select is(public.my_org_membership('pkg-a') -> 'role' ->> 'name', 'Cashier', 'suspended org: role name still returned');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select is(public.my_org_membership('pkg-a'), null, 'deactivated member -> null');
set local role anon;
select throws_ok($$select public.my_org_membership('pkg-a')$$, '42501', null, 'anon cannot execute');

-- permission catalog must match apps/web/lib/auth/permissions.ts (PERMISSION_KEYS)
reset role;
select is(
  (select array_agg(key order by key) from public.permissions),
  array['billing.manage','bills.print','customers.manage','customers.view','kitchen.update','kitchen.view','locations.manage','menu.manage','orders.create','orders.view','orders.void','payments.refund','payments.take','payments.view','pos.discount','pos.use','reports.view','reservations.manage','reservations.view','settings.branding','settings.manage','staff.manage','tables.manage','tables.view'],
  'permission catalog matches PERMISSION_KEYS in apps/web/lib/auth/permissions.ts');

select * from finish();
rollback;
