begin;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@x.test', now(), now(), now()
from generate_series(1, 4) n;
insert into public.packages (code, name, is_default, limits) values ('unl', 'Unlimited', true, '{}');

create function pg_temp.act_as(uid uuid, mail text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', mail)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql as $$ select id from public.organizations where slug = s $$;
create function pg_temp.mk(n int, s text, branding jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(pg_temp.uid(n), 'u' || n || '@x.test');
  perform public.create_organization('Org ' || s, s, '{"name":"L1"}'::jsonb, branding);
  reset role;
end $$;

-- 2. logo_url ------------------------------------------------------------------------------
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"javascript:alert(1)"}')$$, 'P0001', 'INVALID_BRANDING', 'javascript: logo rejected');
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"data:text/html,x"}')$$, 'P0001', 'INVALID_BRANDING', 'data: logo rejected');
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"http://x.test/a.png"}')$$, 'P0001', 'INVALID_BRANDING', 'http: logo rejected');
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"HTTPS://x.test/a.png"}')$$, 'P0001', 'INVALID_BRANDING', 'uppercase scheme rejected');
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"https:javascript:alert(1)"}')$$, 'P0001', 'INVALID_BRANDING', 'https: without // rejected');
select throws_ok($$select pg_temp.mk(1, 'logo-bad', '{"logo_url":"https://x.test/a b.png"}')$$, 'P0001', 'INVALID_BRANDING', 'whitespace in url rejected');
select lives_ok($$select pg_temp.mk(1, 'logo-ok', '{"logo_url":"https://cdn.x.test/logo.png","primary_color":"#112233"}')$$, 'https logo accepted');
select is((select b.logo_url || '|' || coalesce(b.logo_path, 'null') from public.org_branding b where b.organization_id = pg_temp.org('logo-ok')), 'https://cdn.x.test/logo.png|null', 'stored in logo_url, logo_path untouched');
set local role anon;
select is(public.get_storefront('logo-ok') -> 'branding' ->> 'logo_url', 'https://cdn.x.test/logo.png', 'get_storefront returns logo_url');
reset role;
select throws_ok($$update public.org_branding set logo_url = 'http://x.test/a.png' where organization_id = pg_temp.org('logo-ok')$$, '23514', null, 'column check rejects http: directly');
select throws_ok($$update public.org_branding set logo_url = 'https://x.test/a b' where organization_id = pg_temp.org('logo-ok')$$, '23514', null, 'column check rejects whitespace directly');
select lives_ok($$update public.org_branding set logo_url = null where organization_id = pg_temp.org('logo-ok')$$, 'logo_url may be null');
select lives_ok($$select pg_temp.mk(2, 'no-logo', null)$$, 'branding is optional');

-- 1. explicit invitation scope --------------------------------------------------------------
create temp table ctx as select
  pg_temp.org('logo-ok') as org,
  (select r.id from public.roles r where r.organization_id = pg_temp.org('logo-ok') and r.key = 'cashier') as cashier,
  (select l.id from public.locations l where l.organization_id = pg_temp.org('logo-ok')) as loc;
grant select on ctx to public;

select throws_ok($$insert into public.staff_invitations (organization_id, email, role_id, token_hash) select org, 'scope@x.test', cashier, repeat('1', 64) from ctx$$, '23514', null, 'empty location_ids + all_locations=false rejected');
select lives_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash) select org, 'u3@x.test', cashier, true, encode(extensions.digest('tok-all-locations-0123456789', 'sha256'), 'hex') from ctx$$, 'all_locations=true with empty list is valid');
select lives_ok($$insert into public.staff_invitations (organization_id, email, role_id, location_ids, token_hash) select org, 'u4@x.test', cashier, array[loc], encode(extensions.digest('tok-one-location-0123456789', 'sha256'), 'hex') from ctx$$, 'explicit location list is valid');

select pg_temp.act_as(pg_temp.uid(3), 'u3@x.test');
select lives_ok($$select public.accept_invitation('tok-all-locations-0123456789')$$, 'accept all_locations invitation');
select pg_temp.act_as(pg_temp.uid(4), 'u4@x.test');
select lives_ok($$select public.accept_invitation('tok-one-location-0123456789')$$, 'accept explicit-location invitation');
reset role;
select is((select m.all_locations from public.organization_members m where m.user_id = pg_temp.uid(3)), true, 'flag true -> member all_locations');
select is((select m.all_locations::text || ':' || (select count(*) from public.location_staff ls where ls.member_id = m.id) from public.organization_members m where m.user_id = pg_temp.uid(4)), 'false:1', 'explicit list -> restricted member with 1 location');

-- 3. expiry cap (client roles) -------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1), 'u1@x.test');
select throws_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by, expires_at) select org, 'e1@x.test', cashier, true, repeat('2', 64), pg_temp.uid(1), now() + interval '31 days' from ctx$$, 'P0001', 'INVALID_EXPIRY', 'expiry beyond 30 days rejected on insert');
select throws_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by, expires_at) select org, 'e1@x.test', cashier, true, repeat('2', 64), pg_temp.uid(1), now() - interval '1 minute' from ctx$$, 'P0001', 'INVALID_EXPIRY', 'past expiry rejected on insert');
select lives_ok($$insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by) select org, 'e2@x.test', cashier, true, repeat('3', 64), pg_temp.uid(1) from ctx$$, 'default 7 day expiry still works');
select lives_ok($$update public.staff_invitations set expires_at = now() + interval '30 days' where email = 'e2@x.test'$$, 'extending to exactly 30 days is allowed');
select throws_ok($$update public.staff_invitations set expires_at = now() + interval '40 days' where email = 'e2@x.test'$$, 'P0001', 'INVALID_EXPIRY', 'extending beyond 30 days rejected on update');

-- revoke / un-revoke of an expired invitation
reset role;
insert into public.staff_invitations (organization_id, email, role_id, all_locations, token_hash, invited_by, expires_at)
select org, 'old@x.test', cashier, true, repeat('4', 64), pg_temp.uid(1), now() - interval '2 days' from ctx;
select pg_temp.act_as(pg_temp.uid(1), 'u1@x.test');
select lives_ok($$update public.staff_invitations set revoked_at = now() where email = 'old@x.test'$$, 'revoking an expired invitation is allowed');
select throws_ok($$update public.staff_invitations set revoked_at = null where email = 'old@x.test'$$, 'P0001', 'INVALID_EXPIRY', 'un-revoking an expired invitation is rejected');

select * from finish();
rollback;
