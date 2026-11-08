begin;
select plan(32);

-- independent of seed.sql: clear seeded plans/subscriptions (rolled back with the transaction)
delete from public.subscriptions;
delete from public.packages;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@x.test', now(), now(), now()
from generate_series(1, 9) n;
insert into public.packages (code, name, is_default, limits) values
  ('cap',  'Capped',    true,  '{"max_locations":2,"max_staff":3}'),
  ('unl',  'Unlimited', false, '{}');

create function pg_temp.act_as(uid uuid, mail text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', mail)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.mkorg(n int, s text, pkg text) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.uid(n), 'u' || n || '@x.test');
  perform public.create_organization('Org ' || s, s, '{"name":"L1"}'::jsonb, null, pkg);
  reset role;
end $$;

-- create_organization works with the triggers (first owner + first location pass)
select lives_ok($$select pg_temp.mkorg(1, 'cap-one', 'cap')$$, 'create_organization passes the limit triggers');
select lives_ok($$select pg_temp.mkorg(2, 'cap-two', 'cap')$$, 'second org created');
select lives_ok($$select pg_temp.mkorg(3, 'unl-org', 'unl')$$, 'unlimited org created');

-- max_locations -----------------------------------------------------------------
select lives_ok($$insert into public.locations (organization_id, name) values (pg_temp.org('cap-one'), 'L2')$$, 'location at the cap (2/2) succeeds');
select throws_ok($$insert into public.locations (organization_id, name) values (pg_temp.org('cap-one'), 'L3')$$, 'P0001', 'PLAN_LIMIT:max_locations', 'cap+1 location fails with PLAN_LIMIT:max_locations');
select lives_ok($$update public.locations set is_active = false where organization_id = pg_temp.org('cap-one') and name = 'L2'$$, 'deactivating a location frees a slot');
select lives_ok($$insert into public.locations (organization_id, name) values (pg_temp.org('cap-one'), 'L3')$$, 'inactive locations are not counted');
select throws_ok($$update public.locations set is_active = true where organization_id = pg_temp.org('cap-one') and name = 'L2'$$, 'P0001', 'PLAN_LIMIT:max_locations', 'reactivating above the cap fails');
select lives_ok($$insert into public.locations (organization_id, name) select pg_temp.org('unl-org'), 'X' || g from generate_series(1, 6) g$$, 'null limit = unlimited');
select throws_ok($$update public.locations set organization_id = pg_temp.org('cap-one') where organization_id = pg_temp.org('unl-org') and name = 'X1'$$, 'P0001', 'PLAN_LIMIT:max_locations', 'moving a location into a full org fails');

-- service role is still bound
set local role service_role;
select throws_ok($$insert into public.locations (organization_id, name) values (pg_temp.org('cap-one'), 'L9')$$, 'P0001', 'PLAN_LIMIT:max_locations', 'service role is still bound by plan limits');
reset role;

-- max_staff: members + pending, non-expired invitations ------------------------------
insert into public.organization_members (organization_id, user_id, role_id)
values (pg_temp.org('cap-one'), pg_temp.uid(4), pg_temp.role('cap-one', 'cashier'));
insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by)
values (pg_temp.org('cap-one'), 'pending@x.test', pg_temp.role('cap-one', 'cashier'), true, repeat('a', 64), pg_temp.uid(1));
select throws_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash) values (pg_temp.org('cap-one'), 'more@x.test', pg_temp.role('cap-one','cashier'), true, repeat('b', 64))$$, 'P0001', 'PLAN_LIMIT:max_staff', '1 owner + 1 member + 1 pending = cap; another invitation fails');
select throws_ok($$insert into public.organization_members (organization_id, user_id, role_id) values (pg_temp.org('cap-one'), pg_temp.uid(5), pg_temp.role('cap-one','cashier'))$$, 'P0001', 'PLAN_LIMIT:max_staff', 'pending invitation counts: member insert fails at cap');
update public.staff_invitations set revoked_at = now() where email = 'pending@x.test';
select lives_ok($$insert into public.organization_members (organization_id, user_id, role_id) values (pg_temp.org('cap-one'), pg_temp.uid(5), pg_temp.role('cap-one','cashier'))$$, 'revoked invitation does not count');
select lives_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by, expires_at) values (pg_temp.org('cap-one'), 'old@x.test', pg_temp.role('cap-one','cashier'), true, repeat('c', 64), pg_temp.uid(1), now() - interval '1 day')$$, 'expired invitation does not count (3/3 active members)');
select throws_ok($$update public.staff_invitations set expires_at = now() + interval '1 day' where email = 'old@x.test'$$, 'P0001', 'PLAN_LIMIT:max_staff', 'un-expiring an invitation above the cap fails');
select lives_ok($$insert into public.organization_members (organization_id, user_id, role_id, status) values (pg_temp.org('cap-one'), pg_temp.uid(6), pg_temp.role('cap-one', 'cashier'), 'deactivated')$$, 'deactivated members are not counted on insert');
select throws_ok($$update public.organization_members set status = 'active' where user_id = pg_temp.uid(6)$$, 'P0001', 'PLAN_LIMIT:max_staff', 'reactivating a member above the cap fails');

-- accepting an invitation exactly at the cap succeeds (no double count) ------------------
insert into public.organization_members (organization_id, user_id, role_id)
values (pg_temp.org('cap-two'), pg_temp.uid(7), pg_temp.role('cap-two', 'cashier'));
insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by)
values (pg_temp.org('cap-two'), 'u8@x.test', pg_temp.role('cap-two', 'cashier'), true,
        encode(extensions.digest('tok-cap-two-0123456789abcdef', 'sha256'), 'hex'), pg_temp.uid(2));
select pg_temp.act_as(pg_temp.uid(8), 'u8@x.test');
select lives_ok($$select public.accept_invitation('tok-cap-two-0123456789abcdef')$$, 'accept at exactly the cap succeeds');
reset role;
select is((select count(*)::int from public.organization_members where organization_id = pg_temp.org('cap-two') and status = 'active'), 3, 'cap-two has 3 active members');

-- last owner ------------------------------------------------------------------------
select throws_ok($$update public.organization_members set status = 'deactivated' where user_id = pg_temp.uid(3)$$, 'P0001', 'LAST_OWNER', 'deactivating the last owner fails');
select throws_ok($$update public.organization_members set role_id = pg_temp.role('unl-org', 'cashier') where user_id = pg_temp.uid(3)$$, 'P0001', 'LAST_OWNER', 'demoting the last owner fails');
select throws_ok($$delete from public.organization_members where user_id = pg_temp.uid(3)$$, 'P0001', 'LAST_OWNER', 'deleting the last owner fails');
insert into public.organization_members (organization_id, user_id, role_id)
values (pg_temp.org('unl-org'), pg_temp.uid(9), pg_temp.role('unl-org', 'owner'));
select lives_ok($$update public.organization_members set role_id = pg_temp.role('unl-org', 'cashier') where user_id = pg_temp.uid(9)$$, 'demoting works when a second active owner exists');
select throws_ok($$update public.organization_members set status = 'deactivated' where user_id = pg_temp.uid(3)$$, 'P0001', 'LAST_OWNER', 'back to a single owner: protected again');
select lives_ok($$delete from public.organizations where slug = 'cap-two'$$, 'deleting an organization (cascade) is not blocked by the guards');

-- system roles -------------------------------------------------------------------------
select throws_ok($$delete from public.roles where id = pg_temp.role('cap-one', 'waiter')$$, 'P0001', 'SYSTEM_ROLE', 'system role cannot be deleted');
select throws_ok($$update public.roles set key = 'boss' where id = pg_temp.role('cap-one', 'waiter')$$, 'P0001', 'SYSTEM_ROLE', 'system role key cannot change');
select throws_ok($$insert into public.role_permissions (role_id, organization_id, permission_key) values (pg_temp.role('cap-one','owner'), pg_temp.org('cap-one'), 'menu.manage')$$, 'P0001', 'SYSTEM_ROLE', 'owner role permissions cannot be inserted');
select throws_ok($$update public.role_permissions set role_id = pg_temp.role('cap-one','owner') where role_id = pg_temp.role('cap-one','waiter') and permission_key = 'pos.use'$$, 'P0001', 'SYSTEM_ROLE', 'moving a permission onto the owner role fails');
select lives_ok($$with r as (insert into public.roles (organization_id, key, name) values (pg_temp.org('cap-one'), 'custom_x', 'Custom') returning id, organization_id) insert into public.role_permissions (role_id, organization_id, permission_key) select id, organization_id, 'menu.manage' from r$$, 'custom role permissions are editable');
select lives_ok($$delete from public.roles where key = 'custom_x'$$, 'custom role can be deleted');

select * from finish();
rollback;
