begin;
select plan(14);

insert into public.packages (code, name, limits) values ('t-aud', 'Unlimited', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@a.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier@a.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@b.test',now(),now(),now());

create function pg_temp.act_as(uid uuid, mail text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', mail)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.n(act text, actor uuid) returns int language sql as $$
  select count(*)::int from public.audit_logs where action = act and actor_id is not distinct from actor $$;

select pg_temp.act_as(pg_temp.uid(1), 'owner@a.test');
select public.create_organization('Org A', 'aud-a', '{"name":"L1"}'::jsonb, null, 't-aud');
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'owner@b.test');
select public.create_organization('Org B', 'aud-b', '{"name":"L1"}'::jsonb, null, 't-aud');
reset role;
insert into public.organization_members (organization_id, user_id, role_id)
values (pg_temp.org('aud-a'), pg_temp.uid(2), pg_temp.role('aud-a', 'cashier'));
delete from public.audit_logs where action like 'member.%' or action like 'invitation.%';

-- invitation lifecycle, as the org A owner
select pg_temp.act_as(pg_temp.uid(1), 'owner@a.test');
insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by)
values (pg_temp.org('aud-a'), 'new@x.test', pg_temp.role('aud-a', 'waiter'), true, repeat('a', 64), pg_temp.uid(1));
select is(pg_temp.n('invitation.created', pg_temp.uid(1)), 1, 'invite writes exactly one invitation.created with the actor');
update public.staff_invitations set token_hash = repeat('b', 64), send_count = send_count + 1 where email = 'new@x.test';
select is(pg_temp.n('invitation.resent', pg_temp.uid(1)), 1, 'resend writes one invitation.resent');
update public.staff_invitations set revoked_at = now() where email = 'new@x.test';
select is(pg_temp.n('invitation.revoked', pg_temp.uid(1)), 1, 'revoke writes one invitation.revoked');
select is((select count(*)::int from public.audit_logs where action like 'invitation.%'), 3, 'no extra rows');

-- member changes
update public.organization_members set role_id = pg_temp.role('aud-a', 'waiter') where user_id = pg_temp.uid(2);
select is(pg_temp.n('member.role_changed', pg_temp.uid(1)), 1, 'role change writes one row');
select is((select metadata ->> 'new_role_id' from public.audit_logs where action = 'member.role_changed'), pg_temp.role('aud-a', 'waiter')::text, 'role change records the new role id');
update public.organization_members set status = 'deactivated' where user_id = pg_temp.uid(2);
select is(pg_temp.n('member.deactivated', pg_temp.uid(1)), 1, 'deactivate writes one row');
update public.organization_members set status = 'active' where user_id = pg_temp.uid(2);
select is(pg_temp.n('member.reactivated', pg_temp.uid(1)), 1, 'reactivate writes one row');
update public.organization_members set all_locations = true where user_id = pg_temp.uid(2);
select is(pg_temp.n('member.scope_changed', pg_temp.uid(1)), 1, 'scope change writes one row');
select is((select count(*)::int from public.audit_logs where action like 'member.%'), 4, 'no extra member rows');
select is((select count(*)::int from public.audit_logs where metadata::text ilike '%@%'), 0, 'no emails in audit metadata');

-- isolation: a member of org B cannot write in org A, so no audit row appears
reset role;
select pg_temp.act_as(pg_temp.uid(3), 'owner@b.test');
update public.organization_members set status = 'deactivated' where user_id = pg_temp.uid(2);
reset role;
select is((select count(*)::int from public.audit_logs where action = 'member.deactivated'), 1, 'org B owner cannot cause audit rows in org A');
select pg_temp.act_as(pg_temp.uid(1), 'owner@a.test');
select throws_ok($$insert into public.audit_logs (organization_id, action) values (pg_temp.org('aud-a'), 'forged')$$, '42501', null, 'nobody can insert into audit_logs directly');
reset role;
select is((select count(*)::int from public.audit_logs where action = 'forged'), 0, 'no forged row');

select * from finish();
rollback;
