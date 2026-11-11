-- B1-T18: before_user_created hook.
begin;
select plan(11);

delete from public.platform_settings where key = 'signup';

create function pg_temp.ev(e text) returns jsonb language sql as $$ select jsonb_build_object('user', jsonb_build_object('email', e)) $$;

select ok(not has_function_privilege('anon', 'public.before_user_created_signup_guard(jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.before_user_created_signup_guard(jsonb)', 'execute'),
  'clients cannot execute the hook');
select ok(has_function_privilege('supabase_auth_admin', 'public.before_user_created_signup_guard(jsonb)', 'execute'),
  'supabase_auth_admin can execute the hook');

-- default (no row) = enabled
select is(public.before_user_created_signup_guard(pg_temp.ev('new@hook.test')), '{}'::jsonb, 'allowed when no setting row exists');

insert into public.platform_settings (key, value) values ('signup', '{"enabled":true}');
select is(public.before_user_created_signup_guard(pg_temp.ev('new@hook.test')), '{}'::jsonb, 'allowed when signup enabled');

update public.platform_settings set value = '{"enabled":false}' where key = 'signup';
select is((public.before_user_created_signup_guard(pg_temp.ev('new@hook.test'))->'error'->>'http_code')::int, 403, 'refused with 403 when disabled');
select matches(public.before_user_created_signup_guard(pg_temp.ev('new@hook.test'))->'error'->>'message', '^SIGNUP_DISABLED', 'error message carries SIGNUP_DISABLED');
select ok(public.before_user_created_signup_guard('{"user":{"phone":"+620000"}}'::jsonb) ? 'error', 'refused with no email');
select ok(public.before_user_created_signup_guard('{}'::jsonb) ? 'error', 'refused on empty event');

-- invitations
insert into public.organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000f1', 'Hook Org', 'hook-org');
insert into public.roles (id, organization_id, key, name, is_system)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'cashier', 'Cashier', true)
on conflict do nothing;
-- bypass the plan-limit trigger: this org has no package, and limits are not under test
set local session_replication_role = replica;
insert into public.staff_invitations (all_locations, organization_id, email, role_id, token_hash, expires_at, accepted_at, revoked_at)
values
 (true, '00000000-0000-0000-0000-0000000000f1', 'pending@hook.test',  '00000000-0000-0000-0000-0000000000f2', repeat('a', 64), now() + interval '1 day', null, null),
 (true, '00000000-0000-0000-0000-0000000000f1', 'revoked@hook.test',  '00000000-0000-0000-0000-0000000000f2', repeat('b', 64), now() + interval '1 day', null, now()),
 (true, '00000000-0000-0000-0000-0000000000f1', 'expired@hook.test',  '00000000-0000-0000-0000-0000000000f2', repeat('c', 64), now() - interval '1 day', null, null),
 (true, '00000000-0000-0000-0000-0000000000f1', 'accepted@hook.test', '00000000-0000-0000-0000-0000000000f2', repeat('d', 64), now() + interval '1 day', now(), null);
set local session_replication_role = origin;

select is(public.before_user_created_signup_guard(pg_temp.ev('Pending@Hook.test')), '{}'::jsonb, 'pending invitee allowed while disabled (case-insensitive)');
select ok(public.before_user_created_signup_guard(pg_temp.ev('revoked@hook.test')) ? 'error', 'revoked invitee refused');
select ok(public.before_user_created_signup_guard(pg_temp.ev('expired@hook.test')) ? 'error'
      and public.before_user_created_signup_guard(pg_temp.ev('accepted@hook.test')) ? 'error', 'expired and already-accepted invitees refused');

select * from finish();
rollback;
