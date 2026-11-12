-- MCS-T02: storefront foundation. Ordering settings, opening hours, the online-needs-hours rule, the public reads
-- (get_public_location_info, get_pickup_slots, get_storefront ids). Contract: docs/contracts/storefront.md.
begin;
select plan(109);

insert into public.packages (code, name, limits, features) values ('t-sf', 'Storefront', '{}', array['qr_ordering']);
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'sf' || n || '@sf.test', now(), now(), now()
from generate_series(1, 6) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org('sf-a') and name = n $$;
create function pg_temp.sloc() returns uuid language sql security definer as $$ select id from public.locations where organization_id = pg_temp.org('sf-s') limit 1 $$;
create function pg_temp.keys(j jsonb) returns text language sql as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(j) k $$;
create function pg_temp.upd(col text, val text, n_loc text default 'L1') returns int language plpgsql as $$
declare n int;
begin
  execute format('update public.location_ordering_settings set %I = %L where location_id = %L', col, val, pg_temp.loc(n_loc));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- fixtures -------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org SF A', 'sf-a', '{"name":"L1"}'::jsonb, null, 't-sf');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select public.create_organization('Org SF B', 'sf-b', '{"name":"B1"}'::jsonb, null, 't-sf');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select public.create_organization('Org SF S', 'sf-s', '{"name":"S1"}'::jsonb, null, 't-sf');
reset role;
update public.organizations set status = 'suspended' where slug = 'sf-s';
insert into public.locations (organization_id, name) values (pg_temp.org('sf-a'), 'L2'), (pg_temp.org('sf-a'), 'L3');
insert into public.locations (organization_id, name, is_active) values (pg_temp.org('sf-a'), 'L4', false);
update public.locations set timezone = 'Asia/Jakarta' where organization_id = pg_temp.org('sf-a');
-- u1 owner, u2 manager (no locations.manage), u3 cashier, u4 manager scoped to L2, u5 owner of B
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('sf-a'), pg_temp.uid(2), pg_temp.role('sf-a', 'manager'), true),
  (pg_temp.org('sf-a'), pg_temp.uid(3), pg_temp.role('sf-a', 'cashier'), true),
  (pg_temp.org('sf-a'), pg_temp.uid(4), pg_temp.role('sf-a', 'manager'), false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('L2'), m.organization_id from public.organization_members m where m.user_id = pg_temp.uid(4);

-- ---- settings: defaults + a row for every location ----------------------------------------------------------------------
select is((select count(*) from public.locations l where not exists (select 1 from public.location_ordering_settings s where s.location_id = l.id)),
  0::bigint, 'every location has an ordering-settings row (backfill + trigger)');
select is((select row(qr_enabled, online_enabled, accepting_orders, auto_accept_qr, auto_accept_online, pickup_lead_minutes,
                      pickup_slot_minutes, pickup_max_orders_per_slot, min_order_amount, pending_ttl_minutes)::text
           from public.location_ordering_settings where location_id = pg_temp.loc('L1')),
  '(t,f,t,f,f,20,15,,0,15)', 'defaults: qr on, online off, accepting, no auto-accept, lead 20, slot 15, no capacity, min 0, ttl 15');
select is((select count(*) from public.location_ordering_settings where location_id = pg_temp.loc('L2')), 1::bigint, 'a location created later gets its default row');

-- ---- settings: RLS + column grants ----------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select is((select count(*) from public.location_ordering_settings where location_id = pg_temp.loc('L1')), 1::bigint, 'a member reads the settings');
select is(pg_temp.upd('min_order_amount', '25000'), 1, 'the owner (locations.manage) updates the settings');
select throws_ok(format($$update public.location_ordering_settings set organization_id = %L where location_id = %L$$, pg_temp.org('sf-b'), pg_temp.loc('L1')), '42501', null, 'organization_id is not writable');
select throws_ok(format($$update public.location_ordering_settings set pickup_lead_minutes = 4 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'lead below 5 is rejected');
select throws_ok(format($$update public.location_ordering_settings set pickup_lead_minutes = 241 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'lead above 240 is rejected');
select throws_ok(format($$update public.location_ordering_settings set pickup_slot_minutes = 4 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'slot below 5 is rejected');
select throws_ok(format($$update public.location_ordering_settings set pickup_slot_minutes = 61 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'slot above 60 is rejected');
select throws_ok(format($$update public.location_ordering_settings set pickup_max_orders_per_slot = 0 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'capacity 0 is rejected');
select throws_ok(format($$update public.location_ordering_settings set min_order_amount = -1 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'a negative minimum is rejected');
select throws_ok(format($$update public.location_ordering_settings set pending_ttl_minutes = 61 where location_id = %L$$, pg_temp.loc('L1')), '23514', null, 'ttl above 60 is rejected');
select throws_ok(format($$delete from public.location_ordering_settings where location_id = %L$$, pg_temp.loc('L1')), '42501', null, 'no delete grant');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select is(pg_temp.upd('min_order_amount', '1'), 0, 'a manager without locations.manage updates nothing');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is(pg_temp.upd('min_order_amount', '1'), 0, 'a cashier updates nothing');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*) from public.location_ordering_settings where organization_id = pg_temp.org('sf-a')), 0::bigint, 'org B reads none of org A''s settings');
select is(pg_temp.upd('min_order_amount', '1'), 0, 'org B cannot write org A''s settings');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select is((select count(*) from public.location_ordering_settings where location_id = pg_temp.loc('L1')), 0::bigint, 'a member scoped to L2 does not see L1''s settings');
select is((select count(*) from public.location_ordering_settings where location_id = pg_temp.loc('L2')), 1::bigint, 'but sees L2''s');
reset role;
set local role anon;
select throws_ok($$select * from public.location_ordering_settings$$, '42501', null, 'anon cannot read settings');
select throws_ok($$select * from public.location_hours$$, '42501', null, 'anon cannot read hours');
reset role;
select is((select min_order_amount from public.location_ordering_settings where location_id = pg_temp.loc('L1')), 25000::bigint, 'only the owner''s write landed');

-- ---- online pickup needs hours ------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok(format($$update public.location_ordering_settings set online_enabled = true where location_id = %L$$, pg_temp.loc('L1')), 'P0001', 'HOURS_REQUIRED', 'online_enabled without hours is refused');
reset role;

-- ---- save_location_hours ------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.save_location_hours(%L, '[]')$$, pg_temp.loc('L1')), '42501', 'FORBIDDEN', 'a manager without locations.manage cannot save hours');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.save_location_hours(%L, '[]')$$, pg_temp.loc('L1')), '42501', 'FORBIDDEN', 'org B cannot save org A''s hours');
reset role;
set local role anon;
select throws_ok(format($$select public.save_location_hours(%L, '[]')$$, pg_temp.loc('L1')), '42501', null, 'anon cannot execute save_location_hours');
reset role;
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":7,"opensMin":600,"closesMin":700}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'day 7 is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":700,"closesMin":700}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'opens must be before closes');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":600,"closesMin":1441}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'closes above 1440 is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":1440,"closesMin":1440}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'opens at 1440 is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":600.5,"closesMin":700}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'a fractional minute is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":600,"closesMin":700,"extra":1}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'an unknown key is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '{"day":1}')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'a non-array is rejected');
select throws_ok(format($$select public.save_location_hours(%L, %L)$$, pg_temp.loc('L1'),
  (select jsonb_agg(jsonb_build_object('day', d, 'opensMin', 0 + 60 * i, 'closesMin', 30 + 60 * i)) from generate_series(0, 6) d, generate_series(0, 4) i)::text),
  '22023', 'INVALID_INPUT', 'more than 28 intervals is rejected');
select throws_ok(format($$select public.save_location_hours(%L, '[{"day":1,"opensMin":600,"closesMin":840},{"day":1,"opensMin":800,"closesMin":900}]')$$, pg_temp.loc('L1')), '22023', 'INVALID_INPUT', 'overlapping intervals on a day are rejected');
select is(public.save_location_hours(pg_temp.loc('L1'), '[{"day":1,"opensMin":600,"closesMin":840},{"day":1,"opensMin":840,"closesMin":900}]') ->> 'count', '2', 'touching intervals are allowed');
select is(public.save_location_hours(pg_temp.loc('L1'),
  '[{"day":1,"opensMin":600,"closesMin":840},{"day":1,"opensMin":1020,"closesMin":1320},{"day":6,"opensMin":1080,"closesMin":1440},{"day":0,"opensMin":0,"closesMin":120}]') ->> 'count', '4',
  'the owner saves two intervals on Monday and a Saturday-night span past midnight');
select is((select count(*) from public.location_hours where location_id = pg_temp.loc('L1')), 4::bigint, 'the list was replaced, not appended');
reset role;
select is((select count(*) from public.audit_logs where action = 'location.hours_saved'), 2::bigint, 'each successful save is audited (refused saves are not)');
select pg_temp.act_as(pg_temp.uid(4));
select is((select count(*) from public.location_hours where location_id = pg_temp.loc('L1')), 0::bigint, 'a member scoped to L2 does not see L1''s hours');
reset role;

-- ---- online_enabled with hours; the last row cannot disappear while online ---------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select is(pg_temp.upd('online_enabled', 'true'), 1, 'online_enabled works once hours exist');
select throws_ok(format($$select public.save_location_hours(%L, '[]')$$, pg_temp.loc('L1')), 'P0001', 'HOURS_REQUIRED', 'saving an empty list while online is on is refused');
reset role;
select is((select count(*) from public.location_hours where location_id = pg_temp.loc('L1')), 4::bigint, 'and the refused save changed nothing');
-- backstop for a direct delete of the last row (superuser: no client delete grant exists)
create table pg_temp.keep as select id from public.location_hours where location_id = pg_temp.loc('L1') order by day_of_week, opens_min limit 1;
delete from public.location_hours where location_id = pg_temp.loc('L1') and id not in (select id from pg_temp.keep);
select throws_ok(format($$delete from public.location_hours where location_id = %L$$, pg_temp.loc('L1')), 'P0001', 'HOURS_REQUIRED', 'deleting the last hours row of an online-enabled location is refused');
select pg_temp.act_as(pg_temp.uid(1));
select is(pg_temp.upd('online_enabled', 'false'), 1, 'online off');
select is(public.save_location_hours(pg_temp.loc('L1'), '[]') ->> 'count', '0', 'then hours can be cleared');
select is(public.save_location_hours(pg_temp.loc('L1'),
  '[{"day":1,"opensMin":600,"closesMin":840},{"day":1,"opensMin":1020,"closesMin":1320},{"day":6,"opensMin":1080,"closesMin":1440},{"day":0,"opensMin":0,"closesMin":120}]') ->> 'count', '4', 'and set again');
select is(pg_temp.upd('online_enabled', 'true'), 1, 'online on again');
reset role;
-- cascade: deleting a location must not trip the guard
update public.location_ordering_settings set online_enabled = false where location_id = pg_temp.loc('L3');
insert into public.location_hours (organization_id, location_id, day_of_week, opens_min, closes_min) values (pg_temp.org('sf-a'), pg_temp.loc('L3'), 1, 600, 700);
update public.location_ordering_settings set online_enabled = true where location_id = pg_temp.loc('L3');
select lives_ok(format($$delete from public.locations where id = %L$$, pg_temp.loc('L3')), 'deleting an online-enabled location cascades without HOURS_REQUIRED');

-- ---- openNow across timezones, two intervals a day, a span past midnight, no rows ------------------------------------------------
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 03:00:00+00'), true, 'Mon 10:00 Jakarta: open (opens inclusive)');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 02:59:00+00'), false, 'Mon 09:59 Jakarta: closed');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 06:59:00+00'), true, 'Mon 13:59 Jakarta: open');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 07:00:00+00'), false, 'Mon 14:00 Jakarta: closed (closes exclusive)');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 08:00:00+00'), false, 'Mon 15:00 Jakarta: closed in the gap between two intervals');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 11:00:00+00'), true, 'Mon 18:00 Jakarta: open in the second interval');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 15:00:00+00'), false, 'Mon 22:00 Jakarta: closed');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-21 16:59:00+00'), true, 'Sat 23:59 Jakarta: open (first half of the span)');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-21 17:30:00+00'), true, 'Sun 00:30 Jakarta: open (second half of the span, past midnight)');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-21 19:00:00+00'), false, 'Sun 02:00 Jakarta: closed');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-22 03:00:00+00'), false, 'Sun 10:00 Jakarta: closed (no Sunday daytime hours)');
update public.locations set timezone = 'America/New_York' where id = pg_temp.loc('L1');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 03:00:00+00'), false, 'the same instant is Sun 22:00 in New York: closed');
update public.locations set timezone = 'Pacific/Kiritimati' where id = pg_temp.loc('L1');
select is(private.location_open_at(pg_temp.loc('L1'), '2026-11-16 03:00:00+00'), true, 'the same instant is Mon 17:00 in Kiritimati: open (another day, another zone)');
update public.locations set timezone = 'Asia/Jakarta' where id = pg_temp.loc('L1');
select is(private.location_open_at(pg_temp.loc('L2'), '2026-11-16 20:00:00+00'), true, 'a location with no hours rows is open (QR is not hour-limited)');
select is(private.location_open_at(gen_random_uuid(), now()), false, 'an unknown location is not open');

-- ---- pickup slots ------------------------------------------------------------------------------------------------------------
select is((private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:00:00+00') -> 0) #>> '{}', '2026-11-16T03:00:00Z', 'Mon 09:00 now + 20 min lead: the first slot is 10:00 (09:30 is closed)');
select is(jsonb_array_length(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:00:00+00')), 24, 'at most 24 slots');
select is((private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:00:00+00') -> 23) #>> '{}', '2026-11-16T11:45:00Z', 'the 24th slot is 18:45 Jakarta (the gap 14:00-17:00 has none)');
select is(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:40:00+00') -> 0, to_jsonb('2026-11-16T03:00:00Z'::text), 'a slot exactly the lead time away is included');
select is(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 03:05:00+00') -> 0, to_jsonb('2026-11-16T03:30:00Z'::text), 'Mon 10:05 now + lead: the next grid slot is 10:30');
select is(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 14:50:00+00'), '[]'::jsonb, 'Mon 21:50: nothing left today');
update public.location_ordering_settings set pickup_slot_minutes = 30 where location_id = pg_temp.loc('L1');
select is(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:00:00+00') ->> 1, '2026-11-16T03:30:00Z', 'a 30 minute slot length changes the grid');
update public.location_ordering_settings set pickup_slot_minutes = 15 where location_id = pg_temp.loc('L1');
update public.location_ordering_settings set online_enabled = false where location_id = pg_temp.loc('L1');
select is(private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-16 02:00:00+00'), '[]'::jsonb, 'online off: no slots');
update public.location_ordering_settings set online_enabled = true where location_id = pg_temp.loc('L1');
select is(private.pickup_slots_at(pg_temp.loc('L2'), '2026-11-16 02:00:00+00'), '[]'::jsonb, 'no hours: no slots');
update public.locations set timezone = 'Pacific/Kiritimati' where id = pg_temp.loc('L1');
select is((private.pickup_slots_at(pg_temp.loc('L1'), '2026-11-15 19:00:00+00') -> 0) #>> '{}', '2026-11-15T20:00:00Z', 'slots follow the location timezone (Kiritimati: Mon 10:00 local is Sun 20:00 UTC)');
update public.locations set timezone = 'Asia/Jakarta' where id = pg_temp.loc('L1');

-- ---- public reads (anon) -----------------------------------------------------------------------------------------------------
set local role anon;
select is(pg_temp.keys(public.get_public_location_info('sf-a', pg_temp.loc('L1'))),
  'address,city,currency,hours,minOrderAmount,name,openNow,ordering,phone,pickup,serviceChargeBps,taxOnServiceCharge,taxRateBps,timezone',
  'anon sees exactly the whitelisted fields');
select is(pg_temp.keys(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'ordering'), 'accepting,online,qr', 'ordering exposes only qr / online / accepting');
select is(pg_temp.keys(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'pickup'), 'leadMinutes,slotMinutes', 'pickup exposes only lead and slot');
select is(public.get_public_location_info(' SF-A ', pg_temp.loc('L1')) ->> 'name', 'L1', 'the slug is normalised');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'hours' -> 0, '{"day":0,"opens":"00:00","closes":"02:00"}'::jsonb, 'hours are HH:MM strings per weekday');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'hours' -> 2, '{"day":1,"opens":"17:00","closes":"22:00"}'::jsonb, 'two Monday intervals, ordered');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'hours' -> 3, '{"day":6,"opens":"18:00","closes":"24:00"}'::jsonb, 'a span to midnight closes at 24:00');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'minOrderAmount', '25000'::jsonb, 'minimum order is public');
select ok(public.get_public_location_info('sf-a', pg_temp.loc('L1'))::text !~* '(organization|created_by|auto_accept|ttl|capacity|qr_token)', 'nothing internal leaks into the payload');
select is(public.get_public_location_info('nope', pg_temp.loc('L1')), null, 'unknown slug: null');
select is(public.get_public_location_info('sf-b', pg_temp.loc('L1')), null, 'a location of another org under this slug: null');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L4')), null, 'an inactive location: null');
select is(public.get_public_location_info('sf-a', gen_random_uuid()), null, 'an unknown location: null');
select is(public.get_public_location_info('sf-s', pg_temp.sloc()), null, 'a suspended organization: null');
select is(public.get_pickup_slots('nope', pg_temp.loc('L1')), '[]'::jsonb, 'slots: unknown slug is empty');
select is(public.get_pickup_slots('sf-b', pg_temp.loc('L1')), '[]'::jsonb, 'slots: another org''s location is empty');
select is(public.get_pickup_slots('sf-a', pg_temp.loc('L4')), '[]'::jsonb, 'slots: an inactive location is empty');
select is(jsonb_typeof(public.get_pickup_slots('sf-a', pg_temp.loc('L1'))), 'array', 'slots: always an array');
reset role;
-- ordering flags: package gate, switches
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'ordering', '{"qr":true,"online":true,"accepting":true}'::jsonb, 'package with qr_ordering, switches on, hours present: qr and online are on');
update public.location_ordering_settings set qr_enabled = false, accepting_orders = false where location_id = pg_temp.loc('L1');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'ordering', '{"qr":false,"online":true,"accepting":false}'::jsonb, 'qr off and ordering paused are reflected');
update public.location_ordering_settings set qr_enabled = true, accepting_orders = true where location_id = pg_temp.loc('L1');
update public.packages set features = '{}' where code = 't-sf';
select is(public.get_public_location_info('sf-a', pg_temp.loc('L1')) -> 'ordering', '{"qr":false,"online":false,"accepting":true}'::jsonb, 'a package without qr_ordering turns both channels off');
select is(public.get_pickup_slots('sf-a', pg_temp.loc('L1')), '[]'::jsonb, 'and offers no pickup slots');
update public.packages set features = array['qr_ordering'] where code = 't-sf';
select is(public.get_public_location_info('sf-a', pg_temp.loc('L2')) -> 'ordering' ->> 'online', 'false', 'a location without hours never reports online ordering (even if enabled)');
select is(public.get_public_location_info('sf-a', pg_temp.loc('L2')) ->> 'openNow', 'true', 'and is open now for QR');

-- ---- get_storefront: location ids ------------------------------------------------------------------------------------------------
set local role anon;
select is((public.get_storefront('sf-a') -> 'locations' -> 0 ->> 'id')::uuid, pg_temp.loc('L1'), 'get_storefront includes each active location''s id');
select is(pg_temp.keys(public.get_storefront('sf-a') -> 'locations' -> 0), 'address,city,id,name,phone,timezone', 'and nothing else new');
select is(jsonb_array_length(public.get_storefront('sf-a') -> 'locations'), 2, 'inactive locations are not listed (L1, L2 remain; L3 deleted, L4 inactive)');
select is(public.get_storefront('sf-s'), '{"status":"unavailable"}'::jsonb, 'a suspended organization is unavailable');
select is(public.get_storefront('nope'), null, 'an unknown slug is null');
reset role;

-- ---- privilege surface -------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.get_public_location_info(text,uuid)', 'execute') and has_function_privilege('anon', 'public.get_pickup_slots(text,uuid)', 'execute'),
  'anon can execute the two public reads');
select ok(not has_function_privilege('anon', 'public.save_location_hours(uuid,jsonb)', 'execute'), 'anon cannot execute save_location_hours');
select ok(has_function_privilege('authenticated', 'public.save_location_hours(uuid,jsonb)', 'execute'), 'authenticated can (the function checks locations.manage itself)');
select ok(not has_function_privilege('anon', 'private.location_open_at(uuid,timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'private.pickup_slots_at(uuid,timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'private.org_has_feature(uuid,text)', 'execute'), 'the private time and package helpers are not callable by clients');
select ok(not has_table_privilege('anon', 'public.location_ordering_settings', 'select') and not has_table_privilege('authenticated', 'public.location_hours', 'insert'),
  'no anon read of settings; no client write of hours');

select * from finish();
rollback;
