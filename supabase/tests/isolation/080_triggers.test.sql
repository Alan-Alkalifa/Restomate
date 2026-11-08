-- MF-T26 part 2 / MF-T04: plan limits, last owner, system roles. Triggers fire for every role,
-- so most statements run as postgres; client cases check the trigger also bites through RLS.
begin;
\ir _helpers.inc
\ir _rpc.inc
select plan(74);

select tests.mkuser('m1'); select tests.mkuser('m2'); select tests.mkuser('m3'); select tests.mkuser('mx');
select tests.mkuser('own1');

create function tests.inv_sql(org text, em text, extra text default '') returns text language sql as $$
  select format('insert into public.staff_invitations (organization_id, email, role_id, location_ids, token_hash, invited_by%s) values ({%s}, %L, tests.role_id(%L, ''cashier''), array[{%s1}], %L, {uob}%s)',
    case when extra = '' then '' else ', expires_at' end, org, em, org, org,
    encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'), case when extra = '' then '' else ', ' || extra end)
$$;
grant execute on function tests.inv_sql(text, text, text) to public;
create function tests.mem_sql(org text, u text, role_key text default 'cashier', st text default 'active') returns text language sql as $$
  select format('insert into public.organization_members (organization_id, user_id, role_id, status) values ({%s}, {%s}, tests.role_id(%L, %L), %L)', org, u, org, role_key, st)
$$;
grant execute on function tests.mem_sql(text, text, text, text) to public;
create function tests.loc_sql(org text, nm text) returns text language sql as $$
  select format('insert into public.locations (organization_id, name) values ({%s}, %L)', org, nm)
$$;
grant execute on function tests.loc_sql(text, text) to public;

-- org B on a tiny plan: 2 locations, 3 staff
insert into public.packages (code, name, limits) values ('iso-tiny', 'Tiny', '{"max_locations":2,"max_staff":3,"max_tables":1}');
update public.subscriptions set package_id = (select id from public.packages where code = 'iso-tiny')
 where organization_id = (select id from tests.ids where name = 'B');

-- ===== max_locations ==================================================================
select is(tests.stmt('postgres', tests.loc_sql('B', 'B2')), 'OK', 'locations: 2nd location (= cap) is allowed');
select is(tests.stmt('postgres', tests.loc_sql('B', 'B3')), 'PLAN_LIMIT:max_locations|P0001', 'locations: cap+1 refused');
select is(tests.stmt('ob', tests.loc_sql('B', 'B3')), 'PLAN_LIMIT:max_locations|P0001', 'locations: cap+1 refused for the owner through the client');
select is((select count(*)::int from public.locations where organization_id = (select id from tests.ids where name = 'B')), 2, 'locations: refused inserts left no rows');
select is(tests.stmt('postgres', 'update public.locations set name = ''B1 renamed'' where id = {B1}'), 'OK', 'locations: editing at the cap is fine');
select is(tests.stmt('ob', 'update public.locations set name = ''B1 again'' where id = {B1}'), 'OK', 'locations: client edit at the cap is fine');
select is(tests.stmt('postgres', 'update public.locations set is_active = false where name = ''B2'''), 'OK', 'locations: deactivating is fine');
select is(tests.stmt('postgres', tests.loc_sql('B', 'B3')), 'OK', 'locations: inactive locations do not count');
select is(tests.stmt('postgres', 'update public.locations set is_active = true where name = ''B2'''), 'PLAN_LIMIT:max_locations|P0001', 'locations: reactivating above the cap is refused (UPDATE bypass)');
select is(tests.stmt('ob', 'update public.locations set is_active = true where name = ''B2'''), 'PLAN_LIMIT:max_locations|P0001', 'locations: reactivating above the cap is refused for the owner too');
select is(tests.stmt('postgres', 'update public.locations set organization_id = {B} where id = {A2}'), 'PLAN_LIMIT:max_locations|P0001', 'locations: moving a location into a full org is refused (UPDATE bypass)');
select is((select organization_id from public.locations where id = (select id from tests.ids where name = 'A2')), (select id from tests.ids where name = 'A'), 'locations: A2 stayed in org A');
-- no live subscription = limit 0 (fail closed)
update public.locations set is_active = false where name = 'B3';
update public.subscriptions set status = 'canceled' where organization_id = (select id from tests.ids where name = 'B');
select is(tests.stmt('postgres', tests.loc_sql('B', 'B4')), 'PLAN_LIMIT:max_locations|P0001', 'locations: org without a live subscription cannot add locations (fail closed)');
update public.subscriptions set status = 'active' where organization_id = (select id from tests.ids where name = 'B');
-- unlimited plan (limits = {})
update public.subscriptions set package_id = (select id from public.packages where code = 'iso-priv') where organization_id = (select id from tests.ids where name = 'B');
select is((select count(*)::int from (select tests.stmt('postgres', tests.loc_sql('B', 'U' || g)) r from generate_series(1, 6) g) x where r = 'OK'), 6, 'locations: unlimited plan accepts many');
update public.subscriptions set package_id = (select id from public.packages where code = 'iso-tiny') where organization_id = (select id from tests.ids where name = 'B');
select is(tests.stmt('postgres', tests.loc_sql('B', 'still full')), 'PLAN_LIMIT:max_locations|P0001', 'locations: back on the tiny plan the overshoot blocks further inserts');

-- ===== max_staff (active members + pending invitations) ===============================
select is(tests.stmt('postgres', tests.mem_sql('B', 'um1')), 'OK', 'staff: 2nd person');
select is(tests.stmt('postgres', tests.mem_sql('B', 'um2')), 'OK', 'staff: 3rd person (= cap)');
select is(tests.stmt('postgres', tests.mem_sql('B', 'um3')), 'PLAN_LIMIT:max_staff|P0001', 'staff: cap+1 member refused');
select is(tests.stmt('postgres', tests.inv_sql('B', 'i1@iso.test')), 'PLAN_LIMIT:max_staff|P0001', 'staff: cap+1 invitation refused');
select is(tests.stmt('ob', tests.inv_sql('B', 'i1@iso.test')), 'PLAN_LIMIT:max_staff|P0001', 'staff: cap+1 invitation refused for the owner through the client');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''deactivated'' where user_id = {um2}'), 'OK', 'staff: deactivating is fine');
select is(tests.stmt('postgres', tests.inv_sql('B', 'i1@iso.test')), 'OK', 'staff: pending invitation counts toward the cap (2 members + 1 invite = 3)');
select is(tests.stmt('postgres', tests.inv_sql('B', 'i2@iso.test')), 'PLAN_LIMIT:max_staff|P0001', 'staff: a second pending invitation is refused');
select is(tests.stmt('ob', tests.inv_sql('B', 'i3@iso.test')), 'PLAN_LIMIT:max_staff|P0001', 'staff: ... also through the client');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''active'' where user_id = {um2}'), 'PLAN_LIMIT:max_staff|P0001', 'staff: reactivating a member above the cap is refused (UPDATE bypass)');
select is((select status from public.organization_members where user_id = (select uid from tests.actors where name = 'm2')), 'deactivated', 'staff: m2 is still deactivated');
update public.staff_invitations set revoked_at = now() where email = 'i1@iso.test';
select is(tests.stmt('postgres', 'update public.staff_invitations set revoked_at = null where email = ''i1@iso.test'''), 'OK', 'staff: un-revoking with room left is fine');
update public.staff_invitations set revoked_at = now() where email = 'i1@iso.test';
select is(tests.stmt('postgres', 'update public.organization_members set status = ''active'' where user_id = {um2}'), 'OK', 'staff: revoked invitations do not count; reactivation fits (3 = cap)');
select is(tests.stmt('postgres', 'update public.staff_invitations set revoked_at = null where email = ''i1@iso.test'''), 'PLAN_LIMIT:max_staff|P0001', 'staff: un-revoking at the cap is refused (UPDATE bypass)');
update public.organization_members set status = 'deactivated' where user_id = (select uid from tests.actors where name = 'm2');
select tests.mkinv('B', 'e1@iso.test', 'cashier', array['B1'], 'tok-expired-cap-e1-00000', interval '-1 day');
select is((select count(*)::int from public.staff_invitations where email = 'e1@iso.test'), 1, 'staff: expired invitation inserted');
select tests.mkinv('B', 'mx@iso.test', 'cashier', array['B1'], 'tok-cap-accept-mx-0000');
select is((select count(*)::int from public.staff_invitations where email = 'mx@iso.test'), 1, 'staff: expired invitations do not count (2 members + mx invite = 3 = cap)');
select alike(tests.errmsg('mx', $$public.accept_invitation('tok-cap-accept-mx-0000')$$), 'OK:%', 'staff: accepting an invitation at exactly the cap succeeds (no double count)');
select is((select count(*)::int from public.organization_members where organization_id = (select id from tests.ids where name = 'B') and status = 'active'), 3, 'staff: three active members after the acceptance');
select is(tests.stmt('postgres', tests.inv_sql('B', 'i4@iso.test')), 'PLAN_LIMIT:max_staff|P0001', 'staff: full again after the acceptance');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''active'' where user_id = {um2}'), 'PLAN_LIMIT:max_staff|P0001', 'staff: m2 cannot come back above the cap');
update public.subscriptions set status = 'canceled' where organization_id = (select id from tests.ids where name = 'B');
select is(tests.stmt('postgres', tests.inv_sql('B', 'i5@iso.test', 'now() + interval ''1 day''')), 'PLAN_LIMIT:max_staff|P0001', 'staff: no live subscription = nobody can be added (fail closed)');
update public.subscriptions set status = 'active' where organization_id = (select id from tests.ids where name = 'B');

-- ===== LAST_OWNER ======================================================================
select is(tests.stmt('postgres', 'delete from public.organization_members where user_id = {uoa}'), 'LAST_OWNER|P0001', 'owner: cannot delete the last owner');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''deactivated'' where user_id = {uoa}'), 'LAST_OWNER|P0001', 'owner: cannot deactivate the last owner');
select is(tests.stmt('postgres', 'update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uoa}'), 'LAST_OWNER|P0001', 'owner: cannot demote the last owner');
select ok(tests.stmt('postgres', 'update public.organization_members set organization_id = {B} where user_id = {uoa}') in ('LAST_OWNER|P0001', 'PLAN_LIMIT:max_staff|P0001'), 'owner: cannot move the last owner to another org (LAST_OWNER, or PLAN_LIMIT first when the target is full)');
select is((select organization_id from public.organization_members where user_id = (select uid from tests.actors where name = 'oa')), (select id from tests.ids where name = 'A'), 'owner: the owner stayed in org A');
select ok(tests.stmt('oa', 'update public.organization_members set status = ''deactivated'' where user_id = {uoa}') in ('LAST_OWNER|P0001', 'OK'), 'owner: client self-deactivation either refused or filtered');
select is((select status from public.organization_members where user_id = (select uid from tests.actors where name = 'oa')), 'active', 'owner: the owner is still active after the client attempt');
select ok(tests.stmt('oa', 'update public.organization_members set role_id = tests.role_id(''A'',''waiter'') where user_id = {uoa}') in ('LAST_OWNER|P0001', 'OK'), 'owner: client self-demotion either refused or filtered');
select is((select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.user_id = (select uid from tests.actors where name = 'oa')), 'owner', 'owner: still owner after the client attempt');
select is(tests.stmt('postgres', 'delete from public.organization_members where user_id = {uka}'), 'OK', 'owner: removing a non-owner is unaffected');
-- a second owner makes the first removable
select is(tests.stmt('postgres', tests.mem_sql('A', 'uown1', 'owner')), 'OK', 'owner: second owner added');
select is(tests.stmt('postgres', 'update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uoa}'), 'OK', 'owner: with a second owner the first can be demoted');
select is(tests.stmt('postgres', 'update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uown1}'), 'LAST_OWNER|P0001', 'owner: ...but then the second is the last owner');
select is(tests.stmt('postgres', 'update public.organization_members set role_id = tests.role_id(''A'',''owner'') where user_id = {uoa}'), 'OK', 'owner: promoting back is fine');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''deactivated'' where user_id = {uown1}'), 'OK', 'owner: deactivating one of two owners is fine');
select is(tests.stmt('postgres', 'update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uoa}'), 'LAST_OWNER|P0001', 'owner: a deactivated owner does not count as an owner');
select is(tests.stmt('postgres', 'update public.organization_members set status = ''active'' where user_id = {uown1}'), 'OK', 'owner: reactivating an owner is fine');
select is(tests.stmt('postgres', 'delete from public.organization_members where user_id = {uown1}'), 'OK', 'owner: deleting one of two owners is fine');

-- ===== SYSTEM_ROLE =====================================================================
select is(tests.stmt('postgres', format('delete from public.roles where id = tests.role_id(''A'', %L)', k)), 'SYSTEM_ROLE|P0001', 'system role cannot be deleted: ' || k)
  from unnest(array['owner','manager','cashier','waiter','kitchen']) k;
select is(tests.stmt('postgres', 'update public.roles set key = ''cashier2'' where id = tests.role_id(''A'',''cashier'')'), 'SYSTEM_ROLE|P0001', 'system role key is immutable');
select is(tests.stmt('postgres', 'update public.roles set is_system = false where id = tests.role_id(''A'',''cashier'')'), 'SYSTEM_ROLE|P0001', 'system role cannot be demoted to custom');
select is(tests.stmt('postgres', 'update public.roles set is_system = true where id = {SA}'), 'SYSTEM_ROLE|P0001', 'custom role cannot be promoted to system');
select is(tests.stmt('postgres', 'update public.roles set organization_id = {B} where id = tests.role_id(''A'',''cashier'')'), 'SYSTEM_ROLE|P0001', 'system role cannot move to another org');
select is(tests.stmt('oa', 'delete from public.roles where id = tests.role_id(''A'',''manager'')'), 'OK', 'system role delete through the client: filtered by RLS, no error') ;
select is((select count(*)::int from public.roles where organization_id = (select id from tests.ids where name = 'A') and is_system), 5, 'all five system roles of A still exist');
select is(tests.stmt('postgres', 'update public.roles set description = ''renamed'' where id = tests.role_id(''A'',''cashier'')'), 'OK', 'system role description may change (control)');
select is(tests.stmt('postgres', 'delete from public.roles where id = {SA}'), 'OK', 'custom role can be deleted (control)');
select is(tests.stmt('postgres', 'insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''owner''), {A}, ''menu.manage'')'), 'SYSTEM_ROLE|P0001', 'owner role: permission cannot be added (even as postgres)');
select is(tests.stmt('oa', 'insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''owner''), {A}, ''menu.manage'')'), 'SYSTEM_ROLE|P0001', 'owner role: permission cannot be added through the client');
select is(tests.stmt('postgres', 'update public.role_permissions set role_id = tests.role_id(''A'',''owner'') where role_id = tests.role_id(''A'',''kitchen'') and permission_key = ''kitchen.view'''), 'SYSTEM_ROLE|P0001', 'owner role: permission cannot be moved in by UPDATE');
select is(tests.stmt('postgres', 'delete from public.role_permissions where role_id = tests.role_id(''A'',''cashier'') and permission_key = ''pos.use'''), 'OK', 'other system roles stay editable (control)');

-- ===== cascades are not blocked ========================================================
select is(tests.stmt('postgres', 'delete from public.organizations where id = {B}'), 'OK', 'deleting a whole organization cascades past LAST_OWNER / SYSTEM_ROLE');
select is((select count(*)::int from public.roles r where r.organization_id = (select id from tests.ids where name = 'B')), 0, 'cascade: roles gone');
select is((select count(*)::int from public.organization_members m where m.organization_id = (select id from tests.ids where name = 'B')), 0, 'cascade: members gone');

select * from finish();
rollback;
