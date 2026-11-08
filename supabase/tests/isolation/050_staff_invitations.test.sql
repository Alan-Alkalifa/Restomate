-- MF-T26: staff_invitations isolation, token_hash secrecy, accept_invitation / get_invitation_preview abuse.
begin;
\ir _helpers.inc
\ir _rpc.inc
select plan(99);

select tests.mkuser('x1');  select tests.mkuser('x2');  select tests.mkuser('x3');  select tests.mkuser('x4');
select tests.mkuser('x5');  select tests.mkuser('x6');  select tests.mkuser('x7', false);
select tests.mkuser('x8');  select tests.mkuser('x9');

-- tokens (>= 16 chars)
select tests.mkinv('A', 'x1@iso.test', 'cashier', array['A1'], 'tok-valid-x1-0000000000');
select tests.mkinv('A', 'x2@iso.test', 'cashier', array['A1'], 'tok-expired-x2-00000000', interval '-1 minute');
select tests.mkinv('A', 'x3@iso.test', 'cashier', array['A1'], 'tok-revoked-x3-00000000', interval '7 days', true);
select tests.mkinv('A', 'x4@iso.test', 'waiter',  array['A1','A2'], 'tok-valid-x4-0000000000');
select tests.mkinv('A', 'x6@iso.test', 'kitchen', array[]::text[], 'tok-alllocs-x6-0000000');
select tests.mkinv('A', 'x7@iso.test', 'cashier', array['A1'], 'tok-unconfirmed-x7-0000');
select tests.mkinv('A', 'x8@iso.test', 'cashier', array['A1'], 'tok-accepted-x8-000000', interval '7 days', false, true);
select tests.mkinv('A', 'oa@iso.test', 'cashier', array['A1'], 'tok-for-owner-oa-000000');
select tests.mkinv('B', 'x9@iso.test', 'cashier', array['B1'], 'tok-suspended-x9-00000');

-- 1. the same generic error for every failure mode ---------------------------------
select is(tests.errmsg('x1', $$public.accept_invitation('tok-unknown-0000000000000')$$), 'INVALID_INVITATION|P0001', 'unknown token');
select is(tests.errmsg('x5', $$public.accept_invitation('tok-valid-x4-0000000000')$$), 'INVALID_INVITATION|P0001', 'wrong email (token for x4 used by x5)');
select is(tests.errmsg('x2', $$public.accept_invitation('tok-expired-x2-00000000')$$), 'INVALID_INVITATION|P0001', 'expired token');
select is(tests.errmsg('x3', $$public.accept_invitation('tok-revoked-x3-00000000')$$), 'INVALID_INVITATION|P0001', 'revoked token');
select is(tests.errmsg('x8', $$public.accept_invitation('tok-accepted-x8-000000')$$), 'INVALID_INVITATION|P0001', 'already-accepted token');
select is(tests.errmsg('x7', $$public.accept_invitation('tok-unconfirmed-x7-0000')$$), 'INVALID_INVITATION|P0001', 'unconfirmed account cannot accept');
select is(tests.errmsg('oa', $$public.accept_invitation('tok-for-owner-oa-000000')$$), 'INVALID_INVITATION|P0001', 'an owner cannot be re-roled by an invitation');
select is((select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'oa') and m.organization_id = (select id from tests.ids where name = 'A')), 'owner', 'owner is still owner');
-- probing with odd tokens
select is(tests.errmsg('x1', 'public.accept_invitation(null)'), 'INVALID_INVITATION|P0001', 'null token');
select is(tests.errmsg('x1', $$public.accept_invitation('')$$), 'INVALID_INVITATION|P0001', 'empty token');
select is(tests.errmsg('x1', $$public.accept_invitation('short')$$), 'INVALID_INVITATION|P0001', 'short token');
select is(tests.errmsg('x1', $$public.accept_invitation(repeat('a', 5000))$$), 'INVALID_INVITATION|P0001', 'oversized token');
select is(tests.errmsg('x1', $$public.accept_invitation('x'' or ''1''=''1'' -- 0000000')$$), 'INVALID_INVITATION|P0001', 'sql-ish token');
select is(tests.errmsg('x1', $$public.accept_invitation(upper('tok-valid-x1-0000000000'))$$), 'INVALID_INVITATION|P0001', 'token is case sensitive');
select is(tests.errmsg('x1', $$public.accept_invitation(encode(extensions.digest('tok-valid-x1-0000000000','sha256'),'hex'))$$), 'INVALID_INVITATION|P0001', 'the stored hash is not a usable token');
select is(tests.errmsg('anon', $$public.accept_invitation('tok-valid-x1-0000000000')$$), 'permission denied for function accept_invitation|42501', 'anon cannot call accept_invitation');
select is((select count(*)::int from public.organization_members where user_id in (select uid from tests.actors where name in ('x2','x3','x5','x7','x8'))), 0, 'no failed attempt created a membership');
select is((select count(*)::int from public.staff_invitations where accepted_at is not null), 1, 'failed attempts consumed nothing (only the pre-accepted fixture)');

-- 2. a wrong user does not burn the token; the right user gets exactly the invited role/locations
select is(tests.errmsg('x5', $$public.accept_invitation('tok-valid-x4-0000000000')$$), 'INVALID_INVITATION|P0001', 'x5 tries x4 token again');
select alike(tests.errmsg('x4', $$public.accept_invitation('tok-valid-x4-0000000000')$$), 'OK:%iso-org-a%', 'x4 still can accept after the wrong attempt');
select is((select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'x4')), 'waiter', 'x4 got exactly the invited role (waiter), not owner');
select is((select m.all_locations from public.organization_members m where m.user_id = (select uid from tests.actors where name = 'x4')), false, 'x4 is location-limited');
select is((select array_agg(location_id order by location_id) from public.location_staff ls join public.organization_members m on m.id = ls.member_id where m.user_id = (select uid from tests.actors where name = 'x4')),
          (select array_agg(id order by id) from tests.ids where name in ('A1','A2')), 'x4 has exactly A1 and A2');
select is(tests.errmsg('x4', $$public.accept_invitation('tok-valid-x4-0000000000')$$), 'INVALID_INVITATION|P0001', 'token replay by the same user fails');
select is(tests.errmsg('x1', $$public.accept_invitation('tok-valid-x4-0000000000')$$), 'INVALID_INVITATION|P0001', 'token replay by another user fails');

select alike(tests.errmsg('x1', $$public.accept_invitation('tok-valid-x1-0000000000')$$), 'OK:%iso-org-a%', 'x1 accepts');
select is((select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'x1')), 'cashier', 'x1 is cashier');
select is((select count(*)::int from public.location_staff ls join public.organization_members m on m.id = ls.member_id where m.user_id = (select uid from tests.actors where name = 'x1')), 1, 'x1 has exactly one location');
select is(tests.scalar('x1', 'public.has_location_access({A2})'), 'false', 'x1 cannot reach A2');
select is(tests.scalar('x1', 'public.has_permission({A}, ''staff.manage'')'), 'false', 'x1 has no staff.manage');
select is((select count(*)::int from public.audit_logs where action = 'invitation.accepted' and actor_id = (select uid from tests.actors where name = 'x1')), 1, 'acceptance audited');
select alike(tests.errmsg('x6', $$public.accept_invitation('tok-alllocs-x6-0000000')$$), 'OK:%', 'x6 accepts all-locations invitation');
select is((select m.all_locations from public.organization_members m where m.user_id = (select uid from tests.actors where name = 'x6')), true, 'empty location list = all locations');

-- suspended org: invitation unusable
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'B');
select is(tests.errmsg('x9', $$public.accept_invitation('tok-suspended-x9-00000')$$), 'INVALID_INVITATION|P0001', 'suspended org invitation is unusable');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'B');

-- 3. get_invitation_preview ----------------------------------------------------------
select is(tests.scalar('anon', $$public.get_invitation_preview('tok-unknown-0000000000000')$$), null, 'preview: unknown token -> null');
select is(tests.scalar('anon', $$public.get_invitation_preview('short')$$), null, 'preview: short token -> null');
select is(tests.scalar('anon', 'public.get_invitation_preview(null)'), null, 'preview: null token -> null');
select is(tests.scalar('anon', $$public.get_invitation_preview('tok-revoked-x3-00000000')$$), null, 'preview: revoked -> null');
select is(tests.scalar('anon', $$public.get_invitation_preview('tok-accepted-x8-000000')$$), null, 'preview: accepted -> null');
select is(tests.scalar('anon', $$public.get_invitation_preview('tok-valid-x4-0000000000')$$), null, 'preview: consumed token -> null');
select is(tests.scalar('anon', $$(public.get_invitation_preview('tok-expired-x2-00000000')->>'expired')$$), 'true', 'preview: expired flagged');
select is(tests.scalar('anon', $$(select array_agg(k order by k) from jsonb_object_keys(public.get_invitation_preview('tok-unconfirmed-x7-0000')) k)$$),
          '{email_hint,expired,restaurant_name,role_name}', 'preview exposes exactly four keys');
select is(tests.scalar('anon', $$(public.get_invitation_preview('tok-unconfirmed-x7-0000')->>'email_hint')$$), 'x***@iso.test', 'preview masks the email');
select doesnt_match(tests.scalar('anon', $$public.get_invitation_preview('tok-unconfirmed-x7-0000')$$), '(x7@iso\.test|[0-9a-f]{8}-[0-9a-f]{4}-)', 'preview has no full email and no uuid');
select is(tests.scalar('anon', $$(public.get_invitation_preview('tok-unconfirmed-x7-0000')->>'role_name')$$), 'Cashier', 'preview role name');
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(tests.scalar('anon', $$public.get_invitation_preview('tok-unconfirmed-x7-0000')$$), null, 'preview: suspended org -> null');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'A');

-- 4. staff_invitations: reads ---------------------------------------------------------------
select is(tests.cnt(v.a, 'select 1 from public.staff_invitations where organization_id = {A}'), v.n::bigint, 'staff_invitations A visible to ' || v.a)
  from (values ('oa',8),('ma',8),('ca',0),('wa',0),('ka',0),('da',0),('ob',0),('out',0),('padmin',0),('anon',0),('x1',0)) v(a, n);
select is(tests.cnt('ob', 'select 1 from public.staff_invitations where organization_id = {B}'), 1::bigint, 'owner of B sees B invitations');
select is(tests.scalar('oa', 'select token_hash from public.staff_invitations limit 1'), 'DENIED', 'owner cannot select token_hash');
select is(tests.scalar('ma', 'select token_hash from public.staff_invitations limit 1'), 'DENIED', 'manager cannot select token_hash');
select is(tests.scalar('padmin', 'select token_hash from public.staff_invitations limit 1'), 'DENIED', 'platform admin cannot select token_hash');
select is(tests.scalar('oa', 'select count(*) from (select * from public.staff_invitations) s'), 'DENIED', 'select * is refused (token_hash column)');
select is(tests.scalar('oa', $$select count(*) from public.staff_invitations where token_hash like 'a%'$$), 'DENIED', 'cannot probe token_hash with WHERE either');

-- 5. staff_invitations: writes -----------------------------------------------------------------
create function tests.ins_inv(org text, em text, role_key text, by_actor text, extra_cols text default '', extra_vals text default '') returns text language sql as $$
  select format('insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by%s) values ({%s}, %L, tests.role_id(%L,%L), %L, {u%s}%s)',
                extra_cols, org, em, org, role_key, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'), by_actor, extra_vals)
$$;
grant execute on function tests.ins_inv(text,text,text,text,text,text) to public;

select is(tests.aff('ma', tests.ins_inv('A','n1@iso.test','cashier','ma')), 1::bigint, 'manager invites a cashier');
select is(tests.aff('oa', tests.ins_inv('A','n2@iso.test','owner','oa')), 1::bigint, 'owner may invite an owner');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','n3@iso.test','owner','ma')), '<=', 0::bigint, 'manager cannot invite an owner');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','n4@iso.test','cashier','oa')), '<=', 0::bigint, 'invited_by must be the caller');
select cmp_ok(tests.aff('ca', tests.ins_inv('A','n5@iso.test','cashier','ca')), '<=', 0::bigint, 'cashier cannot invite');
select cmp_ok(tests.aff('wa', tests.ins_inv('A','n5@iso.test','cashier','wa')), '<=', 0::bigint, 'waiter cannot invite');
select cmp_ok(tests.aff('da', tests.ins_inv('A','n5@iso.test','cashier','da')), '<=', 0::bigint, 'deactivated cannot invite');
select cmp_ok(tests.aff('ob', tests.ins_inv('A','n5@iso.test','cashier','ob')), '<=', 0::bigint, 'org B owner cannot invite into A');
select is(tests.aff('ob', tests.ins_inv('B','n6@iso.test','cashier','ob')), 1::bigint, 'control: B owner invites into B');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','n7@iso.test','cashier','ma', ', accepted_at', ', now()')), '<=', 0::bigint, 'cannot insert a pre-accepted invitation');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','n8@iso.test','cashier','ma', ', revoked_at', ', now()')), '<=', 0::bigint, 'cannot insert a pre-revoked invitation');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','N1@ISO.TEST','cashier','ma')), '<=', 0::bigint, 'duplicate pending invite (case-insensitive) rejected');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','n1@iso.test','cashier','ma')), '<=', 0::bigint, 'duplicate pending invite rejected');
select cmp_ok(tests.aff('ma', tests.ins_inv('A','not-an-email','cashier','ma')), '<=', 0::bigint, 'invalid email rejected');
select cmp_ok(tests.aff('ma', format('insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by) values ({A}, ''n9@iso.test'', tests.role_id(''B'',''cashier''), %L, {uma})', repeat('a',64))), '<=', 0::bigint, 'role from another org rejected');
select cmp_ok(tests.aff('ma', format('insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by) values ({A}, ''n9@iso.test'', tests.role_id(''A'',''cashier''), %L, {uma})', 'plain-text-token')), '<=', 0::bigint, 'token_hash must be a sha256 hex string');
select cmp_ok(tests.aff('anon', tests.ins_inv('A','n5@iso.test','cashier','ma')), '<=', 0::bigint, 'anon cannot invite');
-- updates
select is(tests.aff('ma', 'update public.staff_invitations set revoked_at = now() where email = ''n1@iso.test'''), 1::bigint, 'manager revokes an invitation');
select is(tests.aff('ma', 'update public.staff_invitations set expires_at = now() + interval ''30 days'', send_count = send_count + 1 where email = ''x6@iso.test'''), 1::bigint, 'manager can resend (extend + count)');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set accepted_at = now() where email = ''x7@iso.test'''), '<=', 0::bigint, 'client cannot mark an invitation accepted');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set accepted_by = {uma} where email = ''x7@iso.test'''), '<=', 0::bigint, 'client cannot set accepted_by');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set email = ''attacker@iso.test'' where email = ''x7@iso.test'''), '<=', 0::bigint, 'invitee email is immutable');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set organization_id = {B} where email = ''x7@iso.test'''), '<=', 0::bigint, 'invitation cannot move to another org');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set role_id = tests.role_id(''A'',''owner'') where email = ''x7@iso.test'''), '<=', 0::bigint, 'manager cannot upgrade an invitation to owner');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set role_id = tests.role_id(''B'',''cashier'') where email = ''x7@iso.test'''), '<=', 0::bigint, 'cannot point invitation at another org role');
select cmp_ok(tests.aff('ca', 'update public.staff_invitations set revoked_at = now() where organization_id = {A}'), '<=', 0::bigint, 'cashier cannot revoke');
select cmp_ok(tests.aff('ob', 'update public.staff_invitations set revoked_at = now() where organization_id = {A}'), '<=', 0::bigint, 'org B cannot revoke A invitations');
select cmp_ok(tests.aff('anon', 'update public.staff_invitations set revoked_at = now()'), '<=', 0::bigint, 'anon cannot revoke');
select cmp_ok(tests.aff('oa', 'delete from public.staff_invitations'), '<=', 0::bigint, 'nobody deletes invitations (owner)');
select cmp_ok(tests.aff('ob', 'delete from public.staff_invitations where organization_id = {A}'), '<=', 0::bigint, 'nobody deletes invitations (org B)');
select is(tests.errmsg('x5', $$public.get_invitation_preview('x')$$), 'OK:NULL', 'preview with garbage is null for signed-in users too');

-- 6. owner only via an owner invitation; reactivation through an invitation
select tests.mkuser('x10');
select tests.mkinv('A', 'x10@iso.test', 'owner', array[]::text[], 'tok-owner-x10-0000000');
select tests.mkinv('A', 'da@iso.test', 'waiter', array['A1'], 'tok-reactivate-da-0000');
select alike(tests.errmsg('x10', $$public.accept_invitation('tok-owner-x10-0000000')$$), 'OK:%', 'an owner invitation yields an owner');
select is((select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'x10')), 'owner', 'x10 is owner only because invited as owner');
select is((select count(*)::int from public.organization_members m join public.roles r on r.id = m.role_id where r.key = 'owner' and m.organization_id = (select id from tests.ids where name = 'A') and m.user_id <> (select uid from tests.actors where name in ('oa') limit 1) and m.user_id <> (select uid from tests.actors where name = 'x10')), 0, 'no other owner appeared');
select alike(tests.errmsg('da', $$public.accept_invitation('tok-reactivate-da-0000')$$), 'OK:%', 'deactivated member can be re-invited');
select is((select m.status || ':' || r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'da')), 'active:waiter', 'reactivated with the invited role');

select * from finish();
rollback;
