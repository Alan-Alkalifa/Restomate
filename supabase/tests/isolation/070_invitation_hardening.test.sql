-- MF-T26 / MF-T34: explicit all_locations on invitations, https-only logo_url, client expires_at
-- in (now, now+30d] (INVALID_EXPIRY, raised by a trigger for authenticated/anon only).
-- Needs the MF-T34 migration (staff_invitations.all_locations, org_branding.logo_url).
begin;
\ir _helpers.inc
\ir _rpc.inc
select plan(49);

select tests.mkuser('z1'); select tests.mkuser('z4'); select tests.mkuser('z5');
select tests.mkinv('A', 'z2@iso.test', 'cashier', array['A1'], 'tok-expired-revoked-z2-0', interval '-1 day', true);
select tests.mkinv('A', 'z3@iso.test', 'cashier', array['A1'], 'tok-revoked-valid-z3-00', interval '5 days', true);
select tests.mkinv('A', 'z6@iso.test', 'cashier', array['A1'], 'tok-expired-open-z6-0000', interval '-1 day');
-- all-locations invitation fixture (explicit flag, empty list)
insert into public.staff_invitations (organization_id, email, role_id, location_ids, all_locations, token_hash, invited_by)
values ((select id from tests.ids where name = 'A'), 'z4@iso.test', tests.role_id('A','kitchen'), '{}', true,
        encode(extensions.digest('tok-all-locations-z4-00', 'sha256'), 'hex'), (select uid from tests.actors where name = 'oa'));

create function tests.inv(em text, expr text, cols text default '', vals text default '') returns text language sql as $$
  select format('insert into public.staff_invitations (organization_id, email, role_id, token_hash, invited_by, expires_at%s) values ({A}, %L, tests.role_id(''A'',''cashier''), %L, {uma}, %s%s)',
                cols, em, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'), expr, vals)
$$;
grant execute on function tests.inv(text,text,text,text) to public;
create function tests.refused_expiry(actor text, stmt text) returns text language sql as $$ select tests.stmt(actor, stmt) $$;
grant execute on function tests.refused_expiry(text,text) to public;

-- expires_at on insert: client roles must stay inside (now, now+30d]
select is(tests.aff('ma', tests.inv('e1@iso.test', 'now() + interval ''7 days''', ', location_ids, all_locations', ', ''{}'', true')), 1::bigint, 'control: valid insert with all_locations = true');
select is(tests.stmt('ma', tests.inv('e2@iso.test', 'now() - interval ''1 day''', ', location_ids, all_locations', ', ''{}'', true')), 'INVALID_EXPIRY|P0001', 'expires_at in the past -> INVALID_EXPIRY');
select is(tests.stmt('ma', tests.inv('e3@iso.test', 'now() + interval ''31 days''', ', location_ids, all_locations', ', ''{}'', true')), 'INVALID_EXPIRY|P0001', 'expires_at beyond 30 days -> INVALID_EXPIRY');
select is(tests.stmt('ma', tests.inv('e4@iso.test', 'now() + interval ''100 years''', ', location_ids, all_locations', ', ''{}'', true')), 'INVALID_EXPIRY|P0001', 'expires_at 100 years out -> INVALID_EXPIRY');
select is(tests.stmt('ma', tests.inv('e4b@iso.test', 'now()', ', location_ids, all_locations', ', ''{}'', true')), 'INVALID_EXPIRY|P0001', 'expires_at = now() is not in (now, ...] -> INVALID_EXPIRY');
select is(tests.aff('ma', tests.inv('e5@iso.test', 'now() + interval ''29 days''', ', location_ids, all_locations', ', ''{}'', true')), 1::bigint, '29 days is fine');
select is(tests.stmt('oa', tests.inv('e6@iso.test', 'now() + interval ''31 days''', ', location_ids, all_locations', ', ''{}'', true')), 'INVALID_EXPIRY|P0001', 'the owner is capped too');
select is(tests.stmt('anon', tests.inv('e7@iso.test', 'now() + interval ''1 day''', ', location_ids, all_locations', ', ''{}'', true')) like '%|42501', true, 'anon is refused by privileges before any expiry logic');

-- explicit all_locations (check: all_locations or cardinality(location_ids) > 0)
select cmp_ok(tests.aff('ma', tests.inv('l1@iso.test', 'now() + interval ''7 days''', ', location_ids, all_locations', ', ''{}'', false')), '<=', 0::bigint, 'empty location_ids without all_locations rejected');
select cmp_ok(tests.aff('ma', tests.inv('l1b@iso.test', 'now() + interval ''7 days''')), '<=', 0::bigint, 'omitting both location_ids and all_locations rejected');
select is(tests.aff('ma', tests.inv('l2@iso.test', 'now() + interval ''7 days''', ', location_ids, all_locations', format(', array[%L::uuid], false', (select id from tests.ids where name = 'A1')))), 1::bigint, 'location list with all_locations = false is fine');
select cmp_ok(tests.aff('ma', 'update public.staff_invitations set all_locations = false where email = ''z4@iso.test'''), '<=', 0::bigint, 'flipping an all-locations invitation to "none" violates the check');
select is(tests.aff('ma', 'update public.staff_invitations set all_locations = true where email = ''l2@iso.test'''), 1::bigint, 'widening a pending invitation to all locations is allowed for staff.manage');

-- accept: the flag, not the list length, decides
select alike(tests.errmsg('z4', $$public.accept_invitation('tok-all-locations-z4-00')$$), 'OK:%', 'z4 accepts the all-locations invitation');
select is((select m.all_locations from public.organization_members m where m.user_id = (select uid from tests.actors where name = 'z4')), true, 'z4 has all_locations = true');
select is((select count(*)::int from public.location_staff ls join public.organization_members m on m.id = ls.member_id where m.user_id = (select uid from tests.actors where name = 'z4')), 0, 'z4 has no per-location rows');
select is(tests.scalar('z4', 'public.has_location_access({A2})'), 'true', 'z4 reaches every location of A');
select is(tests.scalar('z4', 'public.has_location_access({B1})'), 'false', 'z4 does not reach org B');

-- updates of expires_at
select is(tests.aff('ma', 'update public.staff_invitations set expires_at = now() + interval ''10 days'' where email = ''z3@iso.test'''), 1::bigint, 'control: resend extends within the cap');
select is(tests.stmt('ma', 'update public.staff_invitations set expires_at = now() + interval ''90 days'' where email = ''e1@iso.test'''), 'INVALID_EXPIRY|P0001', 'update expires_at beyond 30 days -> INVALID_EXPIRY');
select is(tests.stmt('ma', 'update public.staff_invitations set expires_at = now() - interval ''1 day'' where email = ''e1@iso.test'''), 'INVALID_EXPIRY|P0001', 'update expires_at into the past -> INVALID_EXPIRY (revoke instead)');
select is(tests.stmt('ma', 'update public.staff_invitations set send_count = send_count + 1 where email = ''e1@iso.test'''), 'OK', 'updates that do not touch expires_at are unaffected');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = now() where email = ''z6@iso.test'''), 'OK', 'revoking an already-expired invitation is allowed');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = null where email = ''z2@iso.test'''), 'INVALID_EXPIRY|P0001', 'un-revoking an expired invitation -> INVALID_EXPIRY');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = null where email = ''z6@iso.test'''), 'INVALID_EXPIRY|P0001', 'un-revoking an invitation that expired while revoked -> INVALID_EXPIRY');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = null, expires_at = now() + interval ''400 days'' where email = ''z2@iso.test'''), 'INVALID_EXPIRY|P0001', 'un-revoke combined with a huge expiry -> INVALID_EXPIRY');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = null, expires_at = now() + interval ''5 days'' where email = ''z2@iso.test'''), 'OK', 'un-revoke together with a valid new expiry is allowed');
select is(tests.stmt('ma', 'update public.staff_invitations set revoked_at = null where email = ''z3@iso.test'''), 'OK', 'un-revoking a still-valid invitation is allowed');
select is((select count(*)::int from public.staff_invitations where expires_at > now() + interval '30 days'), 0, 'no invitation expires beyond 30 days');
select is(tests.stmt('postgres', 'update public.staff_invitations set expires_at = now() + interval ''90 days'' where email = ''e1@iso.test'''), 'OK', 'service/maintenance roles are not capped (trigger is for client roles only)');

-- logo_url: https only, <= 500 chars
create function tests.cob(logo text) returns text language sql as $$
  select format('public.create_organization(''R'', ''iso-logo-'' || substr(md5(%L), 1, 6), ''{"name":"M"}''::jsonb, %L::jsonb, null)', logo, json_build_object('logo_url', logo)::text)
$$;
grant execute on function tests.cob(text) to public;
select is(tests.errmsg('z1', tests.cob('javascript:alert(1)')), 'INVALID_BRANDING|P0001', 'create: javascript: logo rejected');
select is(tests.errmsg('z1', tests.cob('data:text/html;base64,PHNjcmlwdD4=')), 'INVALID_BRANDING|P0001', 'create: data: logo rejected');
select is(tests.errmsg('z1', tests.cob('http://example.com/logo.png')), 'INVALID_BRANDING|P0001', 'create: plain http logo rejected');
select is(tests.errmsg('z1', tests.cob('//evil.example/logo.png')), 'INVALID_BRANDING|P0001', 'create: protocol-relative logo rejected');
select is(tests.errmsg('z1', tests.cob('/relative/logo.png')), 'INVALID_BRANDING|P0001', 'create: relative path logo rejected');
select is(tests.errmsg('z1', tests.cob('https://' || repeat('a', 500) || '.example')), 'INVALID_BRANDING|P0001', 'create: over-long logo rejected');
select alike(tests.errmsg('z1', tests.cob('https://example.com/logo.png')), 'OK:%', 'create: https logo accepted');
select is((select b.logo_url from public.org_branding b join public.organizations o on o.id = b.organization_id where o.slug like 'iso-logo-%' and b.logo_url is not null), 'https://example.com/logo.png', 'create: logo stored in org_branding.logo_url');
-- direct writes by staff with settings.branding
select is(tests.aff('ma', 'update public.org_branding set logo_url = ''https://cdn.example/logo.png'' where organization_id = {A}'), 1::bigint, 'branding: https logo accepted for a manager');
select cmp_ok(tests.aff('ma', 'update public.org_branding set logo_url = ''javascript:alert(1)'' where organization_id = {A}'), '<=', 0::bigint, 'branding: javascript: refused');
select cmp_ok(tests.aff('ma', 'update public.org_branding set logo_url = ''data:image/svg+xml;base64,PHN2Zz4='' where organization_id = {A}'), '<=', 0::bigint, 'branding: data: refused');
select cmp_ok(tests.aff('ma', 'update public.org_branding set logo_url = ''http://example.com/l.png'' where organization_id = {A}'), '<=', 0::bigint, 'branding: http refused');
select ok(tests.aff('ma', 'update public.org_branding set logo_url = ''HTTPS://example.com/l.png'' where organization_id = {A}') in (1, -2), 'branding: uppercase scheme is either accepted or cleanly refused by the check');
select cmp_ok(tests.aff('ma', format('update public.org_branding set logo_url = %L where organization_id = {A}', 'https://' || repeat('a', 500))), '<=', 0::bigint, 'branding: over-long logo refused');
select cmp_ok(tests.aff('ob', 'update public.org_branding set logo_url = ''https://evil.example/l.png'' where organization_id = {A}'), '<=', 0::bigint, 'branding: org B cannot set A logo');
select isnt(tests.stmt('ma', 'update public.org_branding set logo_path = ''javascript:alert(1)'' where organization_id = {A} and false or true'), 'OK', 'branding: the legacy logo_path column cannot be used to smuggle a non-https logo');
select is(tests.scalar('anon', $$public.get_storefront('iso-org-a')->'branding'->>'logo_url'$$), 'https://cdn.example/logo.png', 'storefront: branding.logo_url is returned');
select is(tests.scalar('anon', $$(select array_agg(k order by k) from jsonb_object_keys(public.get_storefront('iso-org-a')->'branding') k)$$) like '%logo_url%', true, 'storefront: branding exposes logo_url');
select is(tests.scalar('anon', $$public.get_storefront('iso-org-a')::text ~ 'logo_path'$$), 'false', 'storefront: the old logo_path key is gone');

select * from finish();
rollback;
