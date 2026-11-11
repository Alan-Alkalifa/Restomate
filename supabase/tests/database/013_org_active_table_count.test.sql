-- B1-T21: org_active_table_count is org-wide for any member (even location-scoped), refused for non-members/anon.
begin;
select plan(8);

insert into public.packages (code, name, limits) values ('t-cnt', 'Count', '{"max_tables":20}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'c' || n || '@c.test', now(), now(), now()
from generate_series(1, 3) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(s text, n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org(s) and name = n $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org C', 'cnt-a', '{"name":"L1"}'::jsonb, null, 't-cnt');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select public.create_organization('Org D', 'cnt-b', '{"name":"D1"}'::jsonb, null, 't-cnt');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('cnt-a'), 'L2');

-- u2: manager scoped to L2 only
insert into public.organization_members (organization_id, user_id, role_id, all_locations)
values (pg_temp.org('cnt-a'), pg_temp.uid(2), pg_temp.role('cnt-a', 'manager'), false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('cnt-a', 'L2'), m.organization_id from public.organization_members m where m.user_id = pg_temp.uid(2);

insert into public.areas (organization_id, location_id, name) values
  (pg_temp.org('cnt-a'), pg_temp.loc('cnt-a', 'L1'), 'A1'), (pg_temp.org('cnt-a'), pg_temp.loc('cnt-a', 'L2'), 'A2'),
  (pg_temp.org('cnt-b'), pg_temp.loc('cnt-b', 'D1'), 'AD');
insert into public.tables (organization_id, location_id, area_id, label, capacity, is_active)
select a.organization_id, a.location_id, a.id, x.l, 2, x.act
from public.areas a join (values ('A1','t1',true),('A1','t2',true),('A1','t3',true),('A1','t4',false),('A2','t5',true),('AD','d1',true)) x(an,l,act) on x.an = a.name;

select pg_temp.act_as(pg_temp.uid(2));
select is((select count(*)::int from public.tables where is_active), 1, 'precondition: the scoped manager sees only their location''s active table via RLS');
select is(public.org_active_table_count(pg_temp.org('cnt-a')), 4, 'scoped manager gets the org-wide active count (inactive excluded, other org excluded)');
select throws_ok(format($$select public.org_active_table_count(%L)$$, pg_temp.org('cnt-b')), '42501', 'FORBIDDEN', 'non-member of the other org is refused');
select throws_ok($$select public.org_active_table_count('00000000-0000-0000-0000-000000000999')$$, '42501', 'FORBIDDEN', 'unknown org looks the same');
reset role;

select pg_temp.act_as(pg_temp.uid(1));
select is(public.org_active_table_count(pg_temp.org('cnt-a')), 4, 'owner gets the same count');
reset role;

set local role anon;
select throws_ok(format($$select public.org_active_table_count(%L)$$, pg_temp.org('cnt-a')), '42501', null, 'anon cannot execute');
reset role;
select ok(not has_function_privilege('anon', 'public.org_active_table_count(uuid)', 'execute'), 'anon has no execute privilege');
select ok(has_function_privilege('authenticated', 'public.org_active_table_count(uuid)', 'execute'), 'authenticated has execute');

select * from finish();
rollback;
