begin;
select plan(51);

-- independent of seed.sql: clear seeded plans/subscriptions (rolled back with the transaction)
delete from public.subscriptions;
delete from public.packages;

-- fixtures (postgres) ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','founder@x.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','unconfirmed@x.test',null,now(),now()),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','invitee@x.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@x.test',now(),now(),now()),
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','padmin@x.test',now(),now(),now());
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c5');
insert into public.packages (code, name, trial_days, is_default, limits) values
  ('growth', 'Growth', 14, true, '{"max_locations": 3}'),
  ('starter', 'Starter', 7, false, '{}'),
  ('hidden', 'Hidden', 7, false, '{}');
update public.packages set is_public = false where code = 'hidden';

create function pg_temp.act_as(uid uuid, mail text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'email', mail)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.mkorg(s text) returns jsonb language sql as $$
  select public.create_organization('Resto ' || s, s, '{"name":"Main","city":"Jakarta"}'::jsonb);
$$;

-- is_slug_available (anon) -------------------------------------------------------
set local role anon;
select ok(public.is_slug_available('fresh-slug'), 'is_slug_available: free slug true (anon)');
select ok(not public.is_slug_available('admin'), 'is_slug_available: reserved false');
select ok(not public.is_slug_available('A'), 'is_slug_available: invalid false');
select ok(not public.is_slug_available(null), 'is_slug_available: null false');
select throws_ok($$select public.create_organization('X','x-slug','{"name":"M"}'::jsonb)$$, '42501', null, 'create_organization: anon has no execute');
reset role;

-- create_organization -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select pg_temp.mkorg('unconf-slug')$$, 'P0001', 'EMAIL_NOT_CONFIRMED', 'unconfirmed email rejected');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'founder@x.test');
select throws_ok($$select pg_temp.mkorg('demo')$$, 'P0001', 'SLUG_RESERVED', 'reserved slug rejected');
select throws_ok($$select pg_temp.mkorg('Bad_Slug')$$, 'P0001', 'INVALID_SLUG', 'invalid slug rejected');
select throws_ok($$select public.create_organization('X','good-slug','{"name":"M","tax_rate_bps":99999}'::jsonb)$$, 'P0001', 'INVALID_LOCATION', 'bad tax bps rejected');
select throws_ok($$select public.create_organization('X','good-slug','{"name":"M","timezone":"Mars/Base"}'::jsonb)$$, 'P0001', 'INVALID_LOCATION', 'bad timezone rejected');
select throws_ok($$select public.create_organization('X','good-slug','{"name":"M"}'::jsonb,'{"primary_color":"red"}'::jsonb)$$, 'P0001', 'INVALID_BRANDING', 'bad branding color rejected');
select throws_ok($$select public.create_organization('X','good-slug','{"name":"M"}'::jsonb,null,'hidden')$$, 'P0001', 'INVALID_PACKAGE', 'non-public package rejected');

select lives_ok($$select pg_temp.mkorg('first-resto')$$, 'create_organization happy path');
reset role;
select is((select count(*)::int from public.roles r join public.organizations o on o.id=r.organization_id where o.slug='first-resto' and r.is_system), 5, '5 system roles created');
select is((select count(*)::int from public.role_permissions rp join public.organizations o on o.id=rp.organization_id where o.slug='first-resto'), 37, 'role permissions copied (20+8+6+3)');
select is((select m.all_locations and r.key='owner' from public.organization_members m join public.roles r on r.id=m.role_id join public.organizations o on o.id=m.organization_id where o.slug='first-resto' and m.user_id='00000000-0000-0000-0000-0000000000c1'), true, 'owner membership with all_locations');
select is((select count(*)::int from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='first-resto' and l.tax_rate_bps=1000), 1, 'first location with default tax');
select is((select count(*)::int from public.org_branding b join public.organizations o on o.id=b.organization_id where o.slug='first-resto'), 1, 'branding row created');
select is((select s.status || ':' || p.code from public.subscriptions s join public.packages p on p.id=s.package_id join public.organizations o on o.id=s.organization_id where o.slug='first-resto'), 'trialing:growth', 'trialing subscription on default package');
select ok((select s.trial_ends_at > now() + interval '13 days' from public.subscriptions s join public.organizations o on o.id=s.organization_id where o.slug='first-resto'), 'trial_ends_at = now + trial_days');
select is((select count(*)::int from public.audit_logs where action='organization.created' and actor_id='00000000-0000-0000-0000-0000000000c1'), 1, 'audit entry written');

-- atomicity: failure leaves nothing behind
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4', 'other@x.test');
select throws_ok($$select pg_temp.mkorg('first-resto')$$, 'P0001', 'SLUG_TAKEN', 'taken slug rejected');
select throws_ok($$select public.create_organization('X','atomic-slug','{"name":"M"}'::jsonb,null,'nope')$$, 'P0001', 'INVALID_PACKAGE', 'unknown package rejected');
reset role;
select is((select count(*)::int from public.organizations where slug='atomic-slug')
        + (select count(*)::int from public.organization_members where user_id='00000000-0000-0000-0000-0000000000c4'), 0, 'failed create_organization leaves no rows');

-- owned org cap (default 3)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'founder@x.test');
select lives_ok($$select pg_temp.mkorg('second-resto')$$, '2nd org ok');
select lives_ok($$select pg_temp.mkorg('third-resto')$$, '3rd org ok');
select throws_ok($$select pg_temp.mkorg('fourth-resto')$$, 'P0001', 'ORG_LIMIT_REACHED', '4th owned org rejected');
reset role;

-- invitations ---------------------------------------------------------------------
create temp table ctx as select
  (select id from public.organizations where slug='first-resto') as org,
  (select r.id from public.roles r join public.organizations o on o.id=r.organization_id where o.slug='first-resto' and r.key='cashier') as cashier,
  (select l.id from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='first-resto') as loc;
grant select on ctx to public;

insert into public.staff_invitations (organization_id, email, role_id, location_ids, all_locations, token_hash, invited_by, expires_at, revoked_at)
select org, e, cashier, case when e='invitee@x.test' then array[loc] else '{}'::uuid[] end, e<>'invitee@x.test',
       encode(extensions.digest(t, 'sha256'), 'hex'), '00000000-0000-0000-0000-0000000000c1',
       case when e='expired@x.test' then now() - interval '1 day' else now() + interval '7 days' end,
       case when e='revoked@x.test' then now() else null end
from ctx, (values ('invitee@x.test','tok-valid-0123456789abcdef'),
                  ('expired@x.test','tok-expired-0123456789abcdef'),
                  ('revoked@x.test','tok-revoked-0123456789abcdef')) v(e, t);

select is((select count(*)::int from public.staff_invitations where token_hash like 'tok-%'), 0, 'raw tokens are never stored');

-- preview (anon)
set local role anon;
select is(public.get_invitation_preview('tok-valid-0123456789abcdef'), jsonb_build_object('restaurant_name','Resto first-resto','role_name','Cashier','email_hint','i***@x.test','expired',false), 'preview: masked, minimal payload');
select is((public.get_invitation_preview('tok-expired-0123456789abcdef') ->> 'expired')::boolean, true, 'preview: expired flag');
select is(public.get_invitation_preview('tok-revoked-0123456789abcdef'), null, 'preview: revoked -> null');
select is(public.get_invitation_preview('garbage-token-0123456789'), null, 'preview: unknown -> null');
reset role;

-- accept: generic error for every failure
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4', 'other@x.test');
select throws_ok($$select public.accept_invitation('tok-valid-0123456789abcdef')$$, 'P0001', 'INVALID_INVITATION', 'wrong email -> generic error');
select throws_ok($$select public.accept_invitation('garbage-token-0123456789')$$, 'P0001', 'INVALID_INVITATION', 'unknown token -> same error');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', 'invitee@x.test');
select throws_ok($$select public.accept_invitation('tok-expired-0123456789abcdef')$$, 'P0001', 'INVALID_INVITATION', 'expired -> generic error (wrong email too)');
select throws_ok($$select public.accept_invitation('tok-revoked-0123456789abcdef')$$, 'P0001', 'INVALID_INVITATION', 'revoked -> generic error');
select is((public.accept_invitation('tok-valid-0123456789abcdef') ->> 'slug'), 'first-resto', 'accept: correct token works');
select throws_ok($$select public.accept_invitation('tok-valid-0123456789abcdef')$$, 'P0001', 'INVALID_INVITATION', 'reused token -> generic error');
reset role;
select is((select r.key || ':' || m.all_locations::text || ':' || (select count(*) from public.location_staff ls where ls.member_id=m.id) from public.organization_members m join public.roles r on r.id=m.role_id where m.user_id='00000000-0000-0000-0000-0000000000c3'), 'cashier:false:1', 'membership has invited role and location');

-- token_hash not selectable by clients
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'founder@x.test');
select throws_ok($$select token_hash from public.staff_invitations$$, '42501', null, 'token_hash not selectable by authenticated');
select ok((select count(*) from public.staff_invitations) >= 3, 'owner can list invitations (other columns)');
reset role;

-- get_storefront (anon)
set local role anon;
select ok((public.get_storefront('first-resto') ->> 'name') = 'Resto first-resto' and public.get_storefront('first-resto') ->> 'status' = 'active', 'storefront: active org (anon)');
select ok(position((select org::text from ctx) in public.get_storefront('first-resto')::text) = 0
      and position('@' in public.get_storefront('first-resto')::text) = 0, 'storefront: no ids or emails');
reset role;

-- admin_set_org_status
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'founder@x.test');
select throws_ok($$select public.admin_set_org_status((select id from public.organizations where slug='first-resto'),'suspended','mine')$$, '42501', 'FORBIDDEN', 'tenant owner cannot call admin_set_org_status');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c5', 'padmin@x.test');
select throws_ok($$select public.admin_set_org_status((select id from public.organizations where slug='first-resto'),'bogus','x')$$, 'P0001', 'INVALID_STATUS', 'invalid status rejected');
select lives_ok($$select public.admin_set_org_status((select id from public.organizations where slug='first-resto'),'suspended','unpaid invoice')$$, 'platform admin can suspend');
reset role;
select is((select a.metadata ->> 'reason' from public.audit_logs a where a.action='organization.status_changed' and a.actor_id='00000000-0000-0000-0000-0000000000c5'), 'unpaid invoice', 'status change audited with admin id and reason');
set local role anon;
select is(public.get_storefront('first-resto'), '{"status":"unavailable"}'::jsonb, 'storefront: suspended org -> unavailable only');
reset role;

-- function attributes and grants
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('is_slug_available','create_organization','accept_invitation','get_invitation_preview','get_storefront','admin_set_org_status')
    and p.prosecdef and coalesce(p.proconfig,'{}') @> array['search_path=""']), 6, 'all 6 RPCs are security definer with empty search_path');
select is((select count(*)::int from (values
  ('public.is_slug_available(text)'),('public.get_invitation_preview(text)'),('public.get_storefront(text)'),
  ('public.create_organization(text,text,jsonb,jsonb,text)'),('public.accept_invitation(text)'),('public.admin_set_org_status(uuid,text,text)')) f(sig)
  where has_function_privilege('anon', f.sig, 'execute')), 3, 'anon can execute only the 3 public RPCs');
select is((select count(*)::int from (values
  ('public.is_slug_available(text)'),('public.get_invitation_preview(text)'),('public.get_storefront(text)'),
  ('public.create_organization(text,text,jsonb,jsonb,text)'),('public.accept_invitation(text)'),('public.admin_set_org_status(uuid,text,text)')) f(sig)
  where has_function_privilege('authenticated', f.sig, 'execute')), 6, 'authenticated can execute all 6');

select * from finish();
rollback;
