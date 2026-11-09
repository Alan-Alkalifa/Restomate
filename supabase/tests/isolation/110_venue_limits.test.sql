-- MVM-T02: package limit max_tables (active tables per organization) and its bypass routes:
-- reactivation, insert-inactive-then-activate, bulk reactivation, role/location variants, cap lowered under usage.
-- Single-session test: the advisory-lock race between two concurrent inserts cannot be exercised here (see PR notes).
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _venue.inc
select plan(35);

create function tests.active_tables(org text) returns int language sql stable as $$
  select count(*)::int from public.tables where is_active and organization_id = (select id from tests.ids where name = org)
$$;
create function tests.ins(label text, loc text, area text, active boolean default true) returns text language sql stable as $$
  select format('insert into public.tables (organization_id, location_id, area_id, label, capacity, is_active) values ({A}, {%s}, {%s}, %L, 4, %L)', loc, area, label, active)
$$;
grant execute on function tests.active_tables(text), tests.ins(text, text, text, boolean) to public;

-- org A: cap 3. Fixture already holds 2 active (TA1, TA2) and 1 inactive (TX).
update public.packages set limits = jsonb_set(limits, '{max_tables}', '3') where code = 'iso-old';
insert into tests.ids values ('AR3', '00000000-0000-4000-8000-00000000ae04');
insert into public.areas (id, organization_id, location_id, name)
values ((select id from tests.ids where name = 'AR3'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), 'Second');

select is(tests.active_tables('A'), 2, 'start: 2 active tables, cap 3');
select is(tests.stmt('oa', tests.ins('L3', 'A1', 'AR1')), 'OK', 'limit: owner creates table #3 (at the cap)');
select is(tests.active_tables('A'), 3, 'limit: 3 active');
select is(tests.stmt('oa', tests.ins('L4', 'A1', 'AR1')), 'PLAN_LIMIT:max_tables|P0001', 'limit: owner blocked at #4');
select is(tests.stmt('ma', tests.ins('L5', 'A2', 'AR2')), 'PLAN_LIMIT:max_tables|P0001', 'limit: manager blocked, even in another location (cap is per organization)');
select is(tests.stmt('sm', tests.ins('L6', 'A1', 'AR1')), 'PLAN_LIMIT:max_tables|P0001', 'limit: scoped manager blocked');

-- bypass 1: reactivate an inactive table
select is(tests.stmt('oa', 'update public.tables set is_active = true where id = {TX}'), 'PLAN_LIMIT:max_tables|P0001', 'bypass: reactivating an inactive table at the cap is blocked');
select is((select is_active from public.tables where id = (select id from tests.ids where name = 'TX')), false, 'bypass: TX stays inactive');
-- bypass 2: insert inactive, then activate
select is(tests.stmt('oa', tests.ins('L7', 'A1', 'AR1', false)), 'OK', 'bypass: inserting an inactive table is allowed');
select is(tests.stmt('oa', $$update public.tables set is_active = true where label = 'L7' and organization_id = {A}$$), 'PLAN_LIMIT:max_tables|P0001', 'bypass: activating that table at the cap is blocked');
-- bypass 3: bulk reactivation in one statement
select is(tests.stmt('oa', 'update public.tables set is_active = false where id = {TA2}'), 'OK', 'free one slot: deactivate TA2');
select is(tests.active_tables('A'), 2, 'one slot free');
select is(tests.stmt('oa', $$update public.tables set is_active = true where organization_id = {A} and not is_active$$), 'PLAN_LIMIT:max_tables|P0001', 'bypass: bulk reactivation of 3 inactive tables into 1 free slot is blocked');
select is(tests.active_tables('A'), 2, 'bypass: bulk statement changed nothing (all-or-nothing)');
-- bypass 4: moving an inactive table's activation together with an area change
select is(tests.stmt('oa', $$update public.tables set is_active = true, area_id = {AR3} where id = {TX}$$), 'OK', 'exactly one reactivation into the free slot succeeds');
select is(tests.active_tables('A'), 3, 'back at the cap');
select is(tests.stmt('oa', $$update public.tables set is_active = true, label = 'L7x' where label = 'L7' and organization_id = {A}$$), 'PLAN_LIMIT:max_tables|P0001', 'bypass: combined edit + activation is still blocked');

-- edits that do not add an active table are never blocked, even at the cap
select is(tests.stmt('oa', $$update public.tables set label = 'T1-edit' where id = {TA1}$$), 'OK', 'at cap: renaming an active table is fine');
select is(tests.stmt('oa', $$update public.tables set capacity = 8, pos_x = 1, pos_y = 2 where id = {TA1}$$), 'OK', 'at cap: capacity/position edits are fine');
select is(tests.stmt('oa', $$update public.tables set area_id = {AR3} where id = {TA1}$$), 'OK', 'at cap: moving an active table to another area is fine');
select is(tests.stmt('oa', $$update public.tables set is_active = false where id = {TA1}$$), 'OK', 'at cap: deactivating is fine');
select is(tests.stmt('oa', tests.ins('L8', 'A1', 'AR1')), 'OK', 'a deactivated table frees its slot');
select is(tests.active_tables('A'), 3, 'at the cap again');

-- cap lowered below current usage: existing tables keep working, nothing new activates
update public.packages set limits = jsonb_set(limits, '{max_tables}', '1') where code = 'iso-old';
select is(tests.active_tables('A'), 3, 'downgrade: 3 active under a cap of 1');
select is(tests.stmt('oa', $$update public.tables set label = 'T2-edit' where id = {TA2}$$), 'OK', 'downgrade: editing an inactive table is fine');
select is(tests.stmt('oa', $$update public.tables set capacity = 5 where id = {TX}$$), 'OK', 'downgrade: editing an active table over the cap is fine');
select is(tests.stmt('oa', tests.ins('L9', 'A1', 'AR1')), 'PLAN_LIMIT:max_tables|P0001', 'downgrade: no new table');
select is(tests.stmt('oa', $$update public.tables set is_active = true where id = {TA1}$$), 'PLAN_LIMIT:max_tables|P0001', 'downgrade: no reactivation');

-- other tenants are independent
select is(tests.stmt('ob', format('insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({B}, {B1}, {ARB}, %L, 4)', 'B-extra')), 'OK', 'org B (cap 100) is unaffected by org A being over its cap');
select is(tests.active_tables('B'), 2, 'org B count independent');

-- unlimited plan (limits has no max_tables)
update public.subscriptions set package_id = (select id from public.packages where code = 'iso-priv') where organization_id = (select id from tests.ids where name = 'A');
select is(tests.stmt('oa', tests.ins('U1', 'A1', 'AR1')), 'OK', 'unlimited plan: no cap');
select is(tests.stmt('oa', $$update public.tables set is_active = true where id = {TA1}$$), 'OK', 'unlimited plan: reactivation allowed');

-- suspended org cannot write at all
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(right(tests.stmt('oa', tests.ins('S1', 'A1', 'AR1')), 5), '42501', 'suspended org: owner cannot create tables (RLS)');
select is(tests.aff('oa', $$update public.tables set label = 'S2' where id = {TA1}$$) <= 0, true, 'suspended org: owner cannot edit tables');
select is(tests.cnt('oa', 'select 1 from public.tables where organization_id = {A}'), 0::bigint, 'suspended org: owner cannot read tables either');

select * from finish();
rollback;
