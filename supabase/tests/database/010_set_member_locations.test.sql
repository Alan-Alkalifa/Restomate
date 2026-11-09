begin;
select plan(17);

insert into public.packages (code, name, limits) values ('t-loc', 'Unlimited', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@a.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager@a.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier@a.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@b.test',now(),now(),now());

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.mem(n int) returns uuid language sql as $$ select id from public.organization_members where user_id = pg_temp.uid(n) $$;
create function pg_temp.loc(s text, n text) returns uuid language sql as $$
  select id from public.locations where organization_id = pg_temp.org(s) and name = n $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org A', 'loc-a', '{"name":"L1"}'::jsonb, null, 't-loc');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select public.create_organization('Org B', 'loc-b', '{"name":"L1"}'::jsonb, null, 't-loc');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('loc-a'), 'L2'), (pg_temp.org('loc-a'), 'L3');
insert into public.locations (organization_id, name, is_active) values (pg_temp.org('loc-a'), 'Closed', false);
insert into public.organization_members (organization_id, user_id, role_id) values
  (pg_temp.org('loc-a'), pg_temp.uid(2), pg_temp.role('loc-a', 'manager')),
  (pg_temp.org('loc-a'), pg_temp.uid(3), pg_temp.role('loc-a', 'cashier'));
delete from public.audit_logs where action like 'member.%';

-- happy path as the owner: one call, one audit row, no per-row rows
select pg_temp.act_as(pg_temp.uid(1));
select is((select public.set_member_locations(pg_temp.mem(3), false, array[pg_temp.loc('loc-a','L1'), pg_temp.loc('loc-a','L2')]) ->> 'changed'), 'true', 'owner sets a two-location scope');
reset role;
select is((select count(*)::int from public.location_staff where member_id = pg_temp.mem(3)), 2, 'two rows');
select is((select all_locations from public.organization_members where id = pg_temp.mem(3)), false, 'flag is false');
select is((select count(*)::int from public.audit_logs where action like 'member.%'), 1, 'exactly one audit row (no double logging)');
select is((select action from public.audit_logs where action like 'member.%'), 'member.locations_set', 'it is member.locations_set');
select is((select actor_id from public.audit_logs where action = 'member.locations_set'), pg_temp.uid(1), 'actor recorded');

-- no-op writes nothing
select pg_temp.act_as(pg_temp.uid(1));
select is((select public.set_member_locations(pg_temp.mem(3), false, array[pg_temp.loc('loc-a','L2'), pg_temp.loc('loc-a','L1')]) ->> 'changed'), 'false', 'same scope is a no-op');
reset role;
select is((select count(*)::int from public.audit_logs where action like 'member.%'), 1, 'no-op writes no audit row');

-- validation: other org's location, inactive location, empty list
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok(format($$select public.set_member_locations(%L, false, array[%L::uuid])$$, pg_temp.mem(3), pg_temp.loc('loc-b','L1')), 'P0001', 'INVALID_LOCATION', 'location of another org is rejected');
select throws_ok(format($$select public.set_member_locations(%L, false, array[%L::uuid])$$, pg_temp.mem(3), pg_temp.loc('loc-a','Closed')), 'P0001', 'INVALID_LOCATION', 'inactive location is rejected');
select throws_ok(format($$select public.set_member_locations(%L, false, '{}')$$, pg_temp.mem(3)), 'P0001', 'INVALID_LOCATION', 'empty list without all_locations is rejected');

-- privileges inside the function
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.set_member_locations(%L, true, '{}')$$, pg_temp.mem(1)), '42501', 'FORBIDDEN', 'a manager cannot target an owner');
select throws_ok(format($$select public.set_member_locations(%L, true, '{}')$$, pg_temp.mem(2)), '42501', 'FORBIDDEN', 'a non-owner cannot target themselves');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.set_member_locations(%L, true, '{}')$$, pg_temp.mem(3)), '42501', 'FORBIDDEN', 'no staff.manage -> 42501');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.set_member_locations(%L, true, '{}')$$, pg_temp.mem(3)), '42501', 'FORBIDDEN', 'owner of org B cannot target org A members');
reset role;

-- atomicity: a failure on the LAST write (the flag update) rolls back the location_staff diff
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM'; end $$;
create trigger zz_boom before update of all_locations on public.organization_members for each row execute function pg_temp.boom();
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok(format($$select public.set_member_locations(%L, true, '{}')$$, pg_temp.mem(3)), 'P0001', 'BOOM', 'forced failure mid-way');
reset role;
select is((select count(*)::int from public.location_staff where member_id = pg_temp.mem(3)), 2, 'old location rows are intact after the failure');
drop trigger zz_boom on public.organization_members;

select * from finish();
rollback;
