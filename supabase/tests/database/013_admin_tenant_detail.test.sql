-- MSS-T05: admin_get_tenant_detail + admin_prepare_owner_password_reset.
begin;
select plan(39);

insert into public.packages (code, name, limits) values
  ('t-td', 'Detail limits', '{"max_locations":3,"max_staff":4,"max_tables":5}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@td.test', now(), now(), now()
from generate_series(1, 9) n;
insert into public.profiles (id, email, full_name)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'u' || n || '@td.test', 'User ' || n from generate_series(1, 9) n
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000d8');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.used(k text) returns bigint language sql as $$
  select (public.admin_get_tenant_detail(pg_temp.org('td-a'))->'usage'->k->>'used')::bigint $$;

-- Org A: owner u1. Org B: owner u9 (cross-org target).
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org A', 'td-a', '{"name":"L1"}'::jsonb, null, 't-td');
reset role;
select pg_temp.act_as(pg_temp.uid(9));
select public.create_organization('Org B', 'td-b', '{"name":"B1"}'::jsonb, null, 't-td');
reset role;
insert into public.organization_members (organization_id, user_id, role_id, all_locations)
values (pg_temp.org('td-a'), pg_temp.uid(2), pg_temp.role('td-a', 'manager'), true);
delete from public.audit_logs;

-- ---- access: only a platform admin ---------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok($$select public.admin_get_tenant_detail(pg_temp.org('td-a'))$$, '42501', 'FORBIDDEN', 'owner cannot read tenant detail');
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1))$$, '42501', 'FORBIDDEN', 'owner cannot prepare a reset');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$select public.admin_get_tenant_detail(pg_temp.org('td-a'))$$, '42501', 'FORBIDDEN', 'manager cannot read tenant detail');
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1))$$, '42501', 'FORBIDDEN', 'manager cannot prepare a reset');
reset role;
set local role anon;
select throws_ok($$select public.admin_get_tenant_detail(pg_temp.org('td-a'))$$, '42501', null, 'anon cannot read tenant detail');
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1))$$, '42501', null, 'anon cannot prepare a reset');
reset role;
select is((select count(*)::int from public.audit_logs where action = 'tenant.owner_password_reset'), 0, 'denied callers wrote no audit row');

-- ---- payload ---------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(8));
select is(public.admin_get_tenant_detail(gen_random_uuid()), null, 'unknown org returns null');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'org'->>'slug', 'td-a', 'admin gets the org');
select is(jsonb_array_length(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'locations'), 1, 'one location');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'subscription'->>'packageCode', 't-td', 'current subscription package');
select is(jsonb_array_length(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'subscriptionHistory'), 1, 'subscription history');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'owners'->0->>'email', 'u1@td.test', 'owner email is in the admin payload');
select is(jsonb_array_length(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'owners'), 1, 'only the active owner is listed (not the manager)');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'usage'->'max_tables'->>'limit', '5', 'limit comes from the package');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'usage'->'max_orders_per_month'->>'used', '0', 'orders are 0 until M3');
select ok(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'usage'->'max_orders_per_month'->'limit' = 'null'::jsonb, 'unlimited limit is null');
reset role;

-- ---- usage counters match the limit triggers --------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(8));
select is(pg_temp.used('max_locations'), 1::bigint, 'locations: 1 active');
select is(pg_temp.used('max_staff'), 2::bigint, 'staff: owner + manager');
reset role;

insert into public.locations (organization_id, name) values (pg_temp.org('td-a'), 'L2');
insert into public.locations (organization_id, name, is_active) values (pg_temp.org('td-a'), 'Closed', false);
insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by, all_locations) values
  (pg_temp.org('td-a'), 'p1@td.test', pg_temp.role('td-a', 'cashier'), repeat('a', 64), pg_temp.uid(1), true);
insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by, revoked_at, all_locations) values
  (pg_temp.org('td-a'), 'p2@td.test', pg_temp.role('td-a', 'cashier'), repeat('b', 64), pg_temp.uid(1), now(), true);
insert into public.areas (organization_id, location_id, name)
select pg_temp.org('td-a'), l.id, 'Hall' from public.locations l where l.organization_id = pg_temp.org('td-a') and l.name = 'L1';
insert into public.tables (organization_id, location_id, area_id, label, capacity)
select a.organization_id, a.location_id, a.id, 'T1', 2 from public.areas a where a.name = 'Hall' and a.organization_id = pg_temp.org('td-a');
insert into public.tables (organization_id, location_id, area_id, label, capacity, is_active)
select a.organization_id, a.location_id, a.id, 'T2', 2, false from public.areas a where a.name = 'Hall' and a.organization_id = pg_temp.org('td-a');

select pg_temp.act_as(pg_temp.uid(8));
select is(pg_temp.used('max_locations'), 2::bigint, 'added location counted, inactive one is not');
select is(pg_temp.used('max_staff'), 3::bigint, 'pending invitation counted, revoked one is not');
select is(pg_temp.used('max_tables'), 1::bigint, 'active table counted, inactive one is not');
reset role;

update public.organization_members set status = 'deactivated'
 where organization_id = pg_temp.org('td-a') and user_id = pg_temp.uid(2);
select pg_temp.act_as(pg_temp.uid(8));
select is(pg_temp.used('max_staff'), 2::bigint, 'a deactivated member is not counted');
reset role;

-- the counter reaches the same number the trigger enforces
insert into public.locations (organization_id, name) values (pg_temp.org('td-a'), 'L3');
select pg_temp.act_as(pg_temp.uid(8));
select is(pg_temp.used('max_locations'), 3::bigint, 'third active location reaches the limit');
reset role;
select throws_ok($$insert into public.locations (organization_id, name) values (pg_temp.org('td-a'), 'L4')$$, 'P0001', 'PLAN_LIMIT:max_locations', 'trigger refuses the 4th, matching used = limit');

-- audit trail: newest first, no email-like keys
select private.write_audit(pg_temp.org('td-a'), pg_temp.uid(8), 'test.event', 'x', '1',
  '{"email":"leak@td.test","owner_email":"leak2@td.test","note":"ok"}'::jsonb);
select pg_temp.act_as(pg_temp.uid(8));
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'auditTrail'->0->>'action', 'test.event', 'audit trail is newest first');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'auditTrail'->0->>'actorName', 'User 8', 'actor shown by display name');
select is(public.admin_get_tenant_detail(pg_temp.org('td-a'))->'auditTrail'->0->'metadata', '{"note":"ok"}'::jsonb, 'email-like metadata keys are stripped');
select ok(position('@' in (public.admin_get_tenant_detail(pg_temp.org('td-a'))->'auditTrail')::text) = 0, 'no email in the audit trail payload');
reset role;

-- ---- owner password reset ---------------------------------------------------------------------------------
-- u3: a second owner, then deactivated
insert into public.organization_members (organization_id, user_id, role_id, all_locations)
values (pg_temp.org('td-a'), pg_temp.uid(3), pg_temp.role('td-a', 'owner'), true);
update public.organization_members set status = 'deactivated'
 where organization_id = pg_temp.org('td-a') and user_id = pg_temp.uid(3);
delete from public.audit_logs where action = 'tenant.owner_password_reset';

select pg_temp.act_as(pg_temp.uid(8));
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(2))$$, 'P0001', 'NOT_AN_OWNER', 'a manager is not an owner');
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(3))$$, 'P0001', 'NOT_AN_OWNER', 'a deactivated owner is rejected');
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(9))$$, 'P0001', 'NOT_AN_OWNER', 'an owner of another org is rejected');
select throws_ok($$select public.admin_prepare_owner_password_reset(gen_random_uuid(), pg_temp.uid(1))$$, 'P0001', 'NOT_AN_OWNER', 'unknown org gives the same error');
reset role;
select is((select count(*)::int from public.audit_logs where action = 'tenant.owner_password_reset'), 0, 'rejected attempts wrote no audit row');

select pg_temp.act_as(pg_temp.uid(8));
select is(public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1)), 'u1@td.test', 'active owner: email returned to the caller');
reset role;
select is((select count(*)::int from public.audit_logs where action = 'tenant.owner_password_reset' and actor_id = pg_temp.uid(8)
            and organization_id = pg_temp.org('td-a') and entity_id = pg_temp.uid(1)::text), 1, 'exactly one audit row (org, admin, target user)');
select is((select count(*)::int from public.audit_logs where action = 'tenant.owner_password_reset'
            and (metadata::text like '%@%' or entity_id like '%@%')), 0, 'no email in the audit row');

select pg_temp.act_as(pg_temp.uid(8));
select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1));
select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1));
select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1));
select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1));
select throws_ok($$select public.admin_prepare_owner_password_reset(pg_temp.org('td-a'), pg_temp.uid(1))$$, 'P0001', 'RATE_LIMITED', 'the sixth call within an hour is refused');
reset role;
select is((select count(*)::int from public.audit_logs where action = 'tenant.owner_password_reset'), 5, 'the refused call wrote no audit row');

select * from finish();
rollback;
