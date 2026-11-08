-- MF-T25: a staff.manage holder must not widen their OWN location scope or privileges.
-- (ALAN: S2, fix tracked in MF-T33. These tests fail until that lands.)
begin;
\ir _helpers.inc
select plan(8);

-- make the manager a location-restricted manager of A1 only
update public.organization_members set all_locations = false
 where user_id = (select uid from tests.actors where name = 'ma');
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, (select id from tests.ids where name = 'A1'), m.organization_id
  from public.organization_members m where m.user_id = (select uid from tests.actors where name = 'ma');

select is(tests.scalar('ma', 'public.has_location_access({A1})'), 'true',  'control: restricted manager has A1');
select is(tests.scalar('ma', 'public.has_location_access({A2})'), 'false', 'control: restricted manager lacks A2');

select cmp_ok(tests.aff('ma', 'update public.organization_members set all_locations = true where user_id = {uma}'), '<=', 0::bigint,
  'manager cannot set all_locations on own membership');
select cmp_ok(tests.aff('ma', 'insert into public.location_staff (member_id, location_id, organization_id) select id, {A2}, {A} from public.organization_members where user_id = {uma}'), '<=', 0::bigint,
  'manager cannot add own location_staff row');
select cmp_ok(tests.aff('ma', 'delete from public.location_staff where member_id = (select id from public.organization_members where user_id = {uma})'), '<=', 0::bigint,
  'manager cannot edit own location assignments');
select is(tests.scalar('ma', 'public.has_location_access({A2})'), 'false', 'restricted manager still lacks A2 after attempts');
select is((select all_locations from public.organization_members where user_id = (select uid from tests.actors where name = 'ma')), false, 'all_locations unchanged in DB');

-- control: delegation to OTHER members is still allowed
select is(tests.aff('ma', 'insert into public.location_staff (member_id, location_id, organization_id) select id, {A2}, {A} from public.organization_members where user_id = {uca}'), 1::bigint,
  'manager can still assign the cashier to A2');

select * from finish();
rollback;
