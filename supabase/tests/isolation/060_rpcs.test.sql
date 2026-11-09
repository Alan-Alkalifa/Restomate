-- MF-T26: create_organization, is_slug_available, get_storefront, admin_set_org_status abuse tests.
begin;
\ir _helpers.inc
\ir _rpc.inc
select plan(117);

select tests.mkuser('y1'); select tests.mkuser('y2'); select tests.mkuser('y3'); select tests.mkuser('y4');
select tests.mkuser('y5'); select tests.mkuser('y6', false);

create function tests.co(slug text, loc text default '{"name":"Main"}', brand text default null, pkg text default null, nm text default 'Resto') returns text language sql as $$
  select format('public.create_organization(%L, %L, %L::jsonb, %s, %s)', nm, slug, loc,
                case when brand is null then 'null::jsonb' else quote_literal(brand) || '::jsonb' end,
                case when pkg is null then 'null' else quote_literal(pkg) end)
$$;
grant execute on function tests.co(text,text,text,text,text) to public;

-- is_slug_available (anon) ---------------------------------------------------------
select is(tests.scalar('anon', $$public.is_slug_available('iso-fresh-slug')$$), 'true', 'slug: free slug available to anon');
select is(tests.scalar('anon', $$public.is_slug_available('ISO-Fresh-Slug')$$), 'true', 'slug: case-insensitive input');
select is(tests.scalar('anon', $$public.is_slug_available('iso-org-a')$$), 'false', 'slug: taken');
select is(tests.scalar('anon', $$public.is_slug_available('ISO-ORG-A')$$), 'false', 'slug: taken, other case');
select is(tests.scalar('anon', $$public.is_slug_available('www')$$), 'false', 'slug: reserved www');
select is(tests.scalar('anon', $$public.is_slug_available('demo')$$), 'false', 'slug: reserved demo');
select is(tests.scalar('anon', $$public.is_slug_available('ab')$$), 'false', 'slug: too short');
select is(tests.scalar('anon', $$public.is_slug_available(repeat('a', 41))$$), 'false', 'slug: too long');
select is(tests.scalar('anon', $$public.is_slug_available('has space')$$), 'false', 'slug: space');
select is(tests.scalar('anon', $$public.is_slug_available('-bad-start')$$), 'false', 'slug: leading dash');
select is(tests.scalar('anon', $$public.is_slug_available('x'' or ''1''=''1')$$), 'false', 'slug: sql-ish');
select is(tests.scalar('anon', 'public.is_slug_available(null)'), 'false', 'slug: null');
select is(tests.scalar('anon', $$public.is_slug_available('  iso-fresh-slug  ')$$), 'true', 'slug: whitespace trimmed');

-- create_organization: access and input validation -------------------------------------
select is(tests.errmsg('anon', tests.co('iso-new-1')), 'permission denied for function create_organization|42501', 'create: anon denied');
select is(tests.errmsg('y6', tests.co('iso-new-1')), 'EMAIL_NOT_CONFIRMED|P0001', 'create: unconfirmed email');
select is(tests.errmsg('y1', tests.co('www')), 'SLUG_RESERVED|P0001', 'create: reserved slug');
select is(tests.errmsg('y1', tests.co('demo')), 'SLUG_RESERVED|P0001', 'create: demo reserved');
select is(tests.errmsg('y1', tests.co('DEMO')), 'SLUG_RESERVED|P0001', 'create: reserved slug in uppercase');
select is(tests.errmsg('y1', tests.co('iso-org-a')), 'SLUG_TAKEN|P0001', 'create: taken slug');
select is(tests.errmsg('y1', tests.co('ISO-ORG-A')), 'SLUG_TAKEN|P0001', 'create: taken slug other case');
select is(tests.errmsg('y1', tests.co('ab')), 'INVALID_SLUG|P0001', 'create: short slug');
select is(tests.errmsg('y1', tests.co('bad slug')), 'INVALID_SLUG|P0001', 'create: space in slug');
select is(tests.errmsg('y1', tests.co('bad_slug')), 'INVALID_SLUG|P0001', 'create: underscore in slug');
select is(tests.errmsg('y1', tests.co('-bad-slug')), 'INVALID_SLUG|P0001', 'create: leading dash');
select is(tests.errmsg('y1', tests.co('a/../b')), 'INVALID_SLUG|P0001', 'create: path chars in slug');
select is(tests.errmsg('y1', tests.co('iso-new-1', nm => '')), 'INVALID_NAME|P0001', 'create: empty name');
select is(tests.errmsg('y1', tests.co('iso-new-1', nm => repeat('n', 121))), 'INVALID_NAME|P0001', 'create: name too long');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => 'null')), 'INVALID_LOCATION|P0001', 'create: location null');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '[]')), 'INVALID_LOCATION|P0001', 'create: location not an object');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":""}')), 'INVALID_LOCATION|P0001', 'create: location name empty');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","tax_rate_bps":20000}')), 'INVALID_LOCATION|P0001', 'create: tax over 100%');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","tax_rate_bps":-1}')), 'INVALID_LOCATION|P0001', 'create: negative tax');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","tax_rate_bps":"abc"}')), 'INVALID_LOCATION|P0001', 'create: non-numeric tax');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","service_charge_bps":10001}')), 'INVALID_LOCATION|P0001', 'create: service charge over 100%');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","timezone":"Mars/Base"}')), 'INVALID_LOCATION|P0001', 'create: invalid timezone');
select is(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"M","currency":"rupiah"}')), 'INVALID_LOCATION|P0001', 'create: invalid currency');
select is(tests.errmsg('y1', tests.co('iso-new-1', brand => '{"primary_color":"red"}')), 'INVALID_BRANDING|P0001', 'create: invalid color');
select is(tests.errmsg('y1', tests.co('iso-new-1', brand => '{"primary_color":"red;} body{display:none"}')), 'INVALID_BRANDING|P0001', 'create: css injection in color');
select is(tests.errmsg('y1', tests.co('iso-new-1', brand => '"str"')), 'INVALID_BRANDING|P0001', 'create: branding not an object');
select is(tests.errmsg('y1', tests.co('iso-new-1', pkg => 'iso-priv')), 'INVALID_PACKAGE|P0001', 'create: non-public package refused');
select is(tests.errmsg('y1', tests.co('iso-new-1', pkg => 'iso-old')), 'INVALID_PACKAGE|P0001', 'create: archived package refused');
select is(tests.errmsg('y1', tests.co('iso-new-1', pkg => 'nope')), 'INVALID_PACKAGE|P0001', 'create: unknown package');
select is((select count(*)::int from public.organizations where slug like 'iso-new-%'), 0, 'create: no failed attempt left an organization');
select is(tests.errmsg('y1', $$public.create_organization('R', 'iso-new-1', '{"name":"M"}'::jsonb, null, null, 'extra')$$) like '%|42883', true, 'create: no extra argument (cannot choose another owner)');
select is(tests.errmsg('y1', $$public.create_organization(name := 'R', slug := 'iso-new-1', location := '{"name":"M"}'::jsonb, owner_id := '$$ || (select uid from tests.actors where name='oa') || $$'::uuid)$$) like '%|42883', true, 'create: owner_id named argument rejected');

-- success path + what got created ------------------------------------------------------------
select alike(tests.errmsg('y1', tests.co('iso-new-1', loc => '{"name":"Main","tax_rate_bps":1100,"service_charge_bps":500,"city":"Jakarta"}', brand => '{"primary_color":"#112233"}')), 'OK:%iso-new-1%', 'create: success');
select is((select count(*)::int from public.organizations where slug = 'iso-new-1'), 1, 'created: one organization');
select is((select status from public.organizations where slug = 'iso-new-1'), 'active', 'created: active');
select is((select created_by from public.organizations where slug = 'iso-new-1'), (select uid from tests.actors where name = 'y1'), 'created: created_by is the caller');
select is((select count(*)::int from public.roles r join public.organizations o on o.id = r.organization_id where o.slug = 'iso-new-1' and r.is_system), 5, 'created: five system roles');
select is((select count(*)::int from public.role_permissions rp join public.organizations o on o.id = rp.organization_id where o.slug = 'iso-new-1'), 37, 'created: role permissions copied from templates');
select is((select array_agg(m.user_id::text || ':' || r.key) from public.organization_members m join public.roles r on r.id = m.role_id join public.organizations o on o.id = m.organization_id where o.slug = 'iso-new-1'),
          array[(select uid::text from tests.actors where name = 'y1') || ':owner'], 'created: exactly one member: the caller as owner');
select is((select count(*)::int from public.locations l join public.organizations o on o.id = l.organization_id where o.slug = 'iso-new-1'), 1, 'created: exactly one location');
select is((select l.tax_rate_bps from public.locations l join public.organizations o on o.id = l.organization_id where o.slug = 'iso-new-1'), 1100, 'created: tax bps stored');
select is((select count(*)::int from public.org_branding b join public.organizations o on o.id = b.organization_id where o.slug = 'iso-new-1' and b.primary_color = '#112233'), 1, 'created: branding row');
select is((select s.status from public.subscriptions s join public.organizations o on o.id = s.organization_id where o.slug = 'iso-new-1'), 'trialing', 'created: trialing subscription');
select is((select pk.code from public.subscriptions s join public.packages pk on pk.id = s.package_id join public.organizations o on o.id = s.organization_id where o.slug = 'iso-new-1'), 'iso-pub', 'created: default package');
select is((select count(*)::int from public.audit_logs a join public.organizations o on o.id = a.organization_id where o.slug = 'iso-new-1' and a.action = 'organization.created' and a.actor_id = (select uid from tests.actors where name = 'y1')), 1, 'created: audited');
select is(tests.scalar('y1', 'public.is_org_owner((select id from public.organizations where slug = ''iso-new-1''))'), 'true', 'created: caller is owner via helper');
select is(tests.cnt('y2', $$select 1 from public.organizations where slug = 'iso-new-1'$$), 0::bigint, 'created: other users cannot see the new org');
select is(tests.errmsg('y2', tests.co('iso-new-1')), 'SLUG_TAKEN|P0001', 'create: same slug again is taken');

-- cap on owned orgs (default 3) -----------------------------------------------------------------
select alike(tests.errmsg('y3', tests.co('iso-cap-1')), 'OK:%', 'cap: first');
select alike(tests.errmsg('y3', tests.co('iso-cap-2')), 'OK:%', 'cap: second');
select alike(tests.errmsg('y3', tests.co('iso-cap-3')), 'OK:%', 'cap: third');
select is(tests.errmsg('y3', tests.co('iso-cap-4')), 'ORG_LIMIT_REACHED|P0001', 'cap: fourth is rejected');
select is((select count(*)::int from public.organizations where slug = 'iso-cap-4'), 0, 'cap: rejected attempt created nothing');
select alike(tests.errmsg('y4', tests.co('iso-cap-5')), 'OK:%', 'cap is per user: another user is unaffected');

-- atomicity: a failure late in the transaction leaves nothing behind ------------------------------------
create function tests.boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM'; end $$;
create trigger tests_boom before insert on public.subscriptions for each row execute function tests.boom();
select is(tests.errmsg('y5', tests.co('iso-atomic')), 'BOOM|P0001', 'atomic: forced failure surfaces');
drop trigger tests_boom on public.subscriptions;
select is((select count(*)::int from public.organizations where slug = 'iso-atomic'), 0, 'atomic: no organization');
select is((select count(*)::int from public.organization_members where user_id = (select uid from tests.actors where name = 'y5')), 0, 'atomic: no membership');
select is((select count(*)::int from public.audit_logs where metadata ->> 'slug' = 'iso-atomic'), 0, 'atomic: no audit row');
select is((select count(*)::int from public.roles where organization_id not in (select id from public.organizations)), 0, 'atomic: no orphan roles');
select alike(tests.errmsg('y5', tests.co('iso-atomic')), 'OK:%', 'atomic: retry succeeds after the failure');

-- get_storefront (anon) -----------------------------------------------------------------------------
select is(tests.scalar('anon', $$(select array_agg(k order by k) from jsonb_object_keys(public.get_storefront('iso-org-a')) k)$$), '{branding,locations,name,slug,status}', 'storefront: exact top-level keys');
select is(tests.scalar('anon', $$public.get_storefront('iso-org-a')->>'status'$$), 'active', 'storefront: active');
select is(tests.scalar('anon', $$jsonb_array_length(public.get_storefront('iso-org-a')->'locations')$$), '2', 'storefront: locations');
select is(tests.scalar('anon', $$(select array_agg(distinct k order by k) from jsonb_array_elements(public.get_storefront('iso-org-a')->'locations') e, jsonb_object_keys(e) k)$$), '{address,city,name,phone,timezone}', 'storefront: location keys carry no ids');
select doesnt_match(tests.scalar('anon', $$public.get_storefront('iso-org-a')$$), '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|@iso\.test|contact_email|organization_id|"id")', 'storefront: no uuid, no email, no id fields');
select is(tests.scalar('anon', $$public.get_storefront('ISO-ORG-A')->>'slug'$$), 'iso-org-a', 'storefront: slug lookup is case-insensitive');
select is(tests.scalar('anon', $$public.get_storefront('does-not-exist')$$), null, 'storefront: unknown slug -> null');
select is(tests.scalar('anon', 'public.get_storefront(null)'), null, 'storefront: null slug -> null');
select is(tests.scalar('anon', $$public.get_storefront('x'' or ''1''=''1')$$), null, 'storefront: sql-ish slug -> null');
update public.locations set is_active = false where id = (select id from tests.ids where name = 'A2');
select is(tests.scalar('anon', $$jsonb_array_length(public.get_storefront('iso-org-a')->'locations')$$), '1', 'storefront: inactive locations hidden');
update public.organizations set status = 'suspended' where slug = 'iso-org-a';
select is(tests.scalar('anon', $$public.get_storefront('iso-org-a')$$), '{"status": "unavailable"}', 'storefront: suspended org exposes only status');
update public.organizations set status = 'past_due' where slug = 'iso-org-a';
select is(tests.scalar('anon', $$public.get_storefront('iso-org-a')$$), '{"status": "unavailable"}', 'storefront: past_due org unavailable (M6 may revisit)');
update public.organizations set status = 'active' where slug = 'iso-org-a';

-- admin_set_org_status --------------------------------------------------------------------------------------
select is(tests.errmsg('oa', $$public.admin_set_org_status({A}, 'suspended', 'because')$$), 'FORBIDDEN|42501', 'admin_set_org_status: owner of the org is refused');
select is(tests.errmsg('ma', $$public.admin_set_org_status({A}, 'suspended', 'because')$$), 'FORBIDDEN|42501', 'admin_set_org_status: manager refused');
select is(tests.errmsg('ob', $$public.admin_set_org_status({A}, 'suspended', 'because')$$), 'FORBIDDEN|42501', 'admin_set_org_status: org B owner refused');
select is(tests.errmsg('out', $$public.admin_set_org_status({A}, 'suspended', 'because')$$), 'FORBIDDEN|42501', 'admin_set_org_status: signed-in user refused');
select is(tests.errmsg('anon', $$public.admin_set_org_status({A}, 'suspended', 'because')$$), 'permission denied for function admin_set_org_status|42501', 'admin_set_org_status: anon refused');
select is((select status from public.organizations where slug = 'iso-org-a'), 'active', 'admin_set_org_status: refused calls changed nothing');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'banana', 'because')$$), 'INVALID_STATUS|P0001', 'admin_set_org_status: invalid status');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, null, 'because')$$), 'INVALID_STATUS|P0001', 'admin_set_org_status: null status');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', '')$$), 'INVALID_REASON|P0001', 'admin_set_org_status: empty reason');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', '   ')$$), 'INVALID_REASON|P0001', 'admin_set_org_status: blank reason');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', repeat('r', 501))$$), 'INVALID_REASON|P0001', 'admin_set_org_status: reason too long');
select is(tests.errmsg('padmin', $$public.admin_set_org_status(gen_random_uuid(), 'suspended', 'because')$$), 'ORG_NOT_FOUND|P0001', 'admin_set_org_status: unknown org');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', 'chargeback review')$$), 'OK:true', 'admin_set_org_status: platform admin suspends');
select is((select status from public.organizations where slug = 'iso-org-a'), 'suspended', 'admin_set_org_status: status changed');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')
            and actor_id = (select uid from tests.actors where name = 'padmin') and metadata ->> 'reason' = 'chargeback review' and metadata ->> 'from' = 'active' and metadata ->> 'to' = 'suspended'), 1, 'admin_set_org_status: audit row with actor, reason, from, to');
select is(tests.scalar('oa', 'public.is_org_member({A})'), 'false', 'suspended by admin: owner is locked out');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'active', 'resolved')$$), 'OK:true', 'admin_set_org_status: reactivate');
select is(tests.scalar('oa', 'public.is_org_member({A})'), 'true', 'reactivated: owner is back');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 2, 'admin_set_org_status: two audit rows');
-- B1-T03: reason bounds (5..500, trimmed) and same-status no-op, via the direct RPC path
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', 'abcd')$$), 'INVALID_REASON|P0001', 'admin_set_org_status: 4-char reason rejected');
select is(tests.errmsg('padmin', $$public.admin_set_org_status({A}, 'suspended', '  abcd  ')$$), 'INVALID_REASON|P0001', 'admin_set_org_status: padded 4-char reason rejected (trimmed)');
select is((select status from public.organizations where slug = 'iso-org-a'), 'active', 'admin_set_org_status: rejected reasons changed nothing');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 2, 'admin_set_org_status: rejected reasons wrote no audit');
select is(tests.scalar('padmin', $$public.admin_set_org_status({A}, 'active', 'already active')$$), 'false', 'admin_set_org_status: same status returns false');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 2, 'admin_set_org_status: same-status call wrote no audit');
select is(tests.scalar('padmin', $$public.admin_set_org_status({A}, 'suspended', 'abcde')$$), 'true', 'admin_set_org_status: 5-char reason accepted, returns true');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 3, 'admin_set_org_status: real change wrote one audit row');
select is(tests.scalar('padmin', $$public.admin_set_org_status({A}, 'suspended', 'again please')$$), 'false', 'admin_set_org_status: repeated suspend is a no-op');
select is((select status from public.organizations where slug = 'iso-org-a'), 'suspended', 'admin_set_org_status: no-op left status as is');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 3, 'admin_set_org_status: repeated suspend wrote no audit');
select is(tests.scalar('padmin', $$public.admin_set_org_status({A}, 'active', repeat('r', 500))$$), 'true', 'admin_set_org_status: 500-char reason accepted');
select is((select count(*)::int from public.audit_logs where action = 'organization.status_changed' and organization_id = (select id from tests.ids where name = 'A')), 4, 'admin_set_org_status: audit rows after boundary reasons');

select * from finish();
rollback;
