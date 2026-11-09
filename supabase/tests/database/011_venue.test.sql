-- MVM-T01: areas, tables, QR tokens — isolation, permissions, integrity, limit, RPCs, audit.
begin;
select plan(95);

insert into public.packages (code, name, limits) values ('t-ven', 'Venue limits', '{"max_tables":4}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@v.test', now(), now(), now()
from generate_series(1, 7) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(s text, n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org(s) and name = n $$;
create function pg_temp.area(n text) returns uuid language sql security definer as $$ select id from public.areas where name = n $$;
create function pg_temp.tbl(l text) returns uuid language sql security definer as $$ select id from public.tables where label = l $$;
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function pg_temp.audits(a text) returns int language sql as $$
  select count(*)::int from public.audit_logs where action = a $$;

-- Org A (owner u1, two locations) and Org B (owner u6)
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org A', 'ven-a', '{"name":"L1"}'::jsonb, null, 't-ven');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select public.create_organization('Org B', 'ven-b', '{"name":"B1"}'::jsonb, null, 't-ven');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('ven-a'), 'L2');

-- u2 manager (all locations), u3 cashier (L1 only), u4 waiter (all), u5 kitchen (all), u7 manager scoped to L2 only
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('ven-a'), pg_temp.uid(2), pg_temp.role('ven-a', 'manager'), true),
  (pg_temp.org('ven-a'), pg_temp.uid(3), pg_temp.role('ven-a', 'cashier'), false),
  (pg_temp.org('ven-a'), pg_temp.uid(4), pg_temp.role('ven-a', 'waiter'),  true),
  (pg_temp.org('ven-a'), pg_temp.uid(5), pg_temp.role('ven-a', 'kitchen'), true),
  (pg_temp.org('ven-a'), pg_temp.uid(7), pg_temp.role('ven-a', 'manager'), false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('ven-a', case m.user_id when pg_temp.uid(3) then 'L1' else 'L2' end), m.organization_id
from public.organization_members m where m.user_id in (pg_temp.uid(3), pg_temp.uid(7));

-- fixtures (superuser)
insert into public.areas (organization_id, location_id, name) values
  (pg_temp.org('ven-a'), pg_temp.loc('ven-a', 'L1'), 'VIndoor'),
  (pg_temp.org('ven-a'), pg_temp.loc('ven-a', 'L2'), 'Garden'),
  (pg_temp.org('ven-b'), pg_temp.loc('ven-b', 'B1'), 'Hall');
insert into public.tables (organization_id, location_id, area_id, label, capacity) values
  (pg_temp.org('ven-a'), pg_temp.loc('ven-a', 'L1'), pg_temp.area('VIndoor'), 'A1', 2),
  (pg_temp.org('ven-a'), pg_temp.loc('ven-a', 'L2'), pg_temp.area('Garden'), 'G1', 2),
  (pg_temp.org('ven-b'), pg_temp.loc('ven-b', 'B1'), pg_temp.area('Hall'),   'H1', 2);
delete from public.audit_logs;

-- ---- generated tokens ---------------------------------------------------------------------------------------
select ok((select bool_and(qr_token ~ '^[A-Za-z0-9_-]{32}$') from public.tables where organization_id in (pg_temp.org('ven-a'), pg_temp.org('ven-b'))), 'server-generated tokens are 32 chars base64url (24 random bytes)');
select is((select count(distinct qr_token)::int from public.tables where organization_id in (pg_temp.org('ven-a'), pg_temp.org('ven-b'))), 3, 'tokens are distinct');

-- ---- reads: tenant + location scope ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select is((select count(*)::int from public.areas),  2, 'manager A reads A''s areas only (not B''s)');
select is((select count(*)::int from public.tables), 2, 'manager A reads A''s tables only (not B''s)');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is((select string_agg(name, ',') from public.areas), 'VIndoor', 'location-scoped cashier sees only L1 areas');
select is((select string_agg(label, ',') from public.tables), 'A1', 'location-scoped cashier sees only L1 tables');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select is((select count(*)::int from public.tables), 2, 'waiter can read tables');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*)::int from public.areas), 2, 'kitchen can read areas');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is((select string_agg(label, ',') from public.tables), 'H1', 'owner B sees only B''s table');
reset role;
set local role anon;
select throws_ok($$select * from public.tables$$, '42501', null, 'anon cannot read tables');
select throws_ok($$select * from public.areas$$, '42501', null, 'anon cannot read areas');
reset role;

-- ---- writes: permissions ---------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'X')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1')),
  '42501', null, 'cashier cannot create an area');
select is(pg_temp.affected(format($$update public.tables set label = 'ZZ' where id = pg_temp.tbl('A1')$$)), 0, 'cashier cannot update a table');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'W1', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), '42501', null, 'waiter cannot create a table');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is(pg_temp.affected(format($$update public.areas set name = 'ZZ' where id = pg_temp.area('VIndoor')$$)), 0, 'kitchen cannot update an area');
reset role;

-- manager can write; creating rows works and audits
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$insert into public.areas (organization_id, location_id, name, sort_order) values (%L, %L, 'VTerrace', 2)$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1')),
  'manager creates an area');
select lives_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, shape, pos_x, pos_y) values (%L, %L, %L, 'A2', 4, 'round', 3, 4)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VTerrace')), 'manager creates a table');
select lives_ok($$update public.areas set name = 'Patio' where name = 'VTerrace'$$, 'manager renames an area');
select lives_ok($$update public.tables set label = 'A2b', capacity = 6 where label = 'A2'$$, 'manager edits a table');
reset role;

-- ---- cross-tenant / cross-location writes ---------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'Evil')$$, pg_temp.org('ven-b'), pg_temp.loc('ven-b','B1')),
  '42501', null, 'manager A cannot create an area in org B');
select throws_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'Evil')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-b','B1')),
  '42501', null, 'cannot attach an area to a location of another org');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'E1', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('Hall')), '23503', null, 'table cannot use an area of another org');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'E2', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('Garden')), '23503', null, 'table cannot use an area of another location');
select throws_ok(format($$update public.tables set area_id = %L where id = %L$$, pg_temp.area('Garden'), pg_temp.tbl('A1')),
  '23503', null, 'moving a table into another location''s area is refused');
select is(pg_temp.affected(format($$update public.tables set label = 'HACK' where id = pg_temp.tbl('H1')$$)), 0, 'manager A cannot update B''s table');
select is(pg_temp.affected(format($$update public.areas set name = 'HACK' where id = pg_temp.area('Hall')$$)), 0, 'manager A cannot update B''s area');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is(pg_temp.affected(format($$update public.tables set label = 'HACK' where id = pg_temp.tbl('A1')$$)), 0, 'owner B cannot update A''s table');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'Nope')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1')),
  '42501', null, 'manager scoped to L2 cannot write in L1');
select lives_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'Roof')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L2')),
  'manager scoped to L2 can write in L2');
reset role;

-- ---- column privileges: tokens, ids, no DELETE ---------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, qr_token) values (%L, %L, %L, 'T9', 2, 'chosen')$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), '42501', null, 'client cannot choose a qr_token on insert');
select throws_ok($$update public.tables set qr_token = 'chosen'$$, '42501', null, 'client cannot change qr_token');
select throws_ok($$update public.tables set qr_rotated_at = now()$$, '42501', null, 'client cannot change qr_rotated_at');
select throws_ok(format($$update public.tables set organization_id = %L$$, pg_temp.org('ven-b')), '42501', null, 'client cannot change organization_id');
select throws_ok(format($$update public.tables set location_id = %L$$, pg_temp.loc('ven-a','L2')), '42501', null, 'client cannot change location_id');
select throws_ok(format($$update public.areas set location_id = %L$$, pg_temp.loc('ven-a','L2')), '42501', null, 'client cannot move an area to another location');
select throws_ok($$delete from public.tables$$, '42501', null, 'no client DELETE on tables');
select throws_ok($$delete from public.areas$$, '42501', null, 'no client DELETE on areas');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'Z', 51)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), '23514', null, 'capacity above 50 refused');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, status) values (%L, %L, %L, 'Z', 2, 'broken')$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), '23514', null, 'invalid status refused');
reset role;

-- ---- duplicate names (active only) ----------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'VINDOOR')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1')),
  '23505', null, 'duplicate active area name (case-insensitive) in a location');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'a1', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), '23505', null, 'duplicate active table label (case-insensitive) in a location');
select lives_ok(format($$insert into public.areas (organization_id, location_id, name) values (%L, %L, 'VIndoor')$$, pg_temp.org('ven-a'), pg_temp.loc('ven-a','L2')),
  'same area name in another location is fine');
reset role;

-- ---- plan limit: max_tables = 4; org A has A1, G1, A2b active (3) ----------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'A3', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), 'table up to the limit is created');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'A4', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), 'P0001', 'PLAN_LIMIT:max_tables', 'table over the limit raises PLAN_LIMIT:max_tables');
select lives_ok($$update public.tables set is_active = false where label = 'A3'$$, 'deactivating frees a slot');
select lives_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'A4', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), 'inactive tables do not count');
select throws_ok($$update public.tables set is_active = true where label = 'A3'$$, 'P0001', 'PLAN_LIMIT:max_tables', 'reactivating at the limit raises (no bypass)');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'A3', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('VIndoor')), 'P0001', 'PLAN_LIMIT:max_tables', 'a freed label is still subject to the limit');
reset role;
select is((select count(*)::int from public.tables where organization_id = pg_temp.org('ven-b') and is_active), 1, 'org B''s count is separate (limit is per org)');

-- ---- AREA_NOT_EMPTY ----------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$update public.areas set is_active = false where name = 'VIndoor' and location_id = (select location_id from public.tables where label = 'A1')$$,
  'P0001', 'AREA_NOT_EMPTY', 'area with active tables cannot be deactivated');
select lives_ok($$update public.areas set is_active = false where name = 'Roof'$$, 'an empty area can be deactivated');
reset role;

-- ---- RPC: rotate_table_qr_token ----------------------------------------------------------------------------------
create temp table old_tok as select qr_token from public.tables where label = 'A1';
grant select on old_tok to anon, authenticated;
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.rotate_table_qr_token(%L)$$, pg_temp.tbl('A1')), '42501', 'FORBIDDEN', 'cashier cannot rotate');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.rotate_table_qr_token(%L)$$, pg_temp.tbl('A1')), '42501', 'FORBIDDEN', 'waiter cannot rotate');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.rotate_table_qr_token(%L)$$, pg_temp.tbl('H1')), '42501', 'FORBIDDEN', 'manager A cannot rotate B''s table');
select throws_ok($$select public.rotate_table_qr_token(gen_random_uuid())$$, '42501', 'FORBIDDEN', 'unknown id looks the same as forbidden');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select public.rotate_table_qr_token(%L)$$, pg_temp.tbl('A1')), '42501', 'FORBIDDEN', 'manager scoped to L2 cannot rotate an L1 table');
reset role;
set local role anon;
select throws_ok(format($$select public.rotate_table_qr_token(%L)$$, pg_temp.tbl('A1')), '42501', null, 'anon cannot rotate');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
create temp table new_tok (t text);
grant all on new_tok to anon, authenticated;
insert into new_tok select public.rotate_table_qr_token(pg_temp.tbl('A1'));
reset role;
select ok((select t ~ '^[A-Za-z0-9_-]{32}$' and t <> (select qr_token from old_tok) from new_tok), 'rotation returns a fresh 32-char token');
select is((select qr_token from public.tables where label = 'A1'), (select t from new_tok), 'the new token is stored');
select isnt((select qr_rotated_at from public.tables where label = 'A1'), null, 'qr_rotated_at is set');

create temp table a3_tok as select qr_token from public.tables where label = 'A3';
grant select on a3_tok to anon, authenticated;
-- ---- RPC: resolve_table_qr (anon) ---------------------------------------------------------------------------------
set local role anon;
select is((select count(*)::int from public.resolve_table_qr((select qr_token from old_tok))), 0, 'the old token no longer resolves');
select is((select count(*)::int from public.resolve_table_qr((select t from new_tok))), 1, 'the new token resolves');
select is((select org_slug || '/' || label from public.resolve_table_qr((select t from new_tok))), 'ven-a/A1', 'resolve returns the org slug and label');
select is((select count(*)::int from public.resolve_table_qr('nope')), 0, 'unknown token resolves to nothing');
select is((select count(*)::int from public.resolve_table_qr('')), 0, 'empty token resolves to nothing');
select is((select count(*)::int from public.resolve_table_qr(null)), 0, 'null token resolves to nothing');
reset role;
select is((select proargnames from pg_proc where proname = 'resolve_table_qr' and pronamespace = 'public'::regnamespace),
  '{token,org_slug,location_id,table_id,label}'::text[], 'resolve_table_qr exposes only org slug, location id, table id and label');
select is((select count(*)::int from public.tables where label = 'A3' and is_active = false), 1, 'fixture: A3 is inactive');
set local role anon;
select is((select count(*)::int from public.resolve_table_qr((select qr_token from a3_tok))), 0, 'inactive table token does not resolve');
reset role;
update public.organizations set status = 'suspended' where slug = 'ven-a';
set local role anon;
select is((select count(*)::int from public.resolve_table_qr((select t from new_tok))), 0, 'tokens of a suspended org do not resolve');
reset role;
update public.organizations set status = 'active' where slug = 'ven-a';

-- ---- audit ----------------------------------------------------------------------------------------------------------
select is(pg_temp.audits('area.created'), 3, 'audit: area.created (manager Terrace, scoped manager Roof, Indoor@L2)');
select is(pg_temp.audits('area.renamed'), 1, 'audit: area.renamed');
select is(pg_temp.audits('area.deactivated'), 1, 'audit: area.deactivated');
select is(pg_temp.audits('table.created'), 3, 'audit: table.created (A2, A3, A4)');
select is(pg_temp.audits('table.renamed'), 1, 'audit: table.renamed');
select is(pg_temp.audits('table.deactivated'), 1, 'audit: table.deactivated');
select is(pg_temp.audits('table.qr_rotated'), 1, 'audit: table.qr_rotated');
select is((select actor_id from public.audit_logs where action = 'table.qr_rotated'), pg_temp.uid(2), 'audit: rotation records the actor');
select is((select count(*)::int from public.audit_logs where metadata::text like '%' || (select t from new_tok) || '%' or metadata::text like '%' || (select qr_token from old_tok) || '%'), 0, 'audit: token values are never logged');

-- ---- get_table_qr_tokens: tokens are tables.manage-only -----------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok($$select qr_token from public.tables$$, '42501', null, 'cashier cannot select qr_token directly');
select lives_ok($$select id, label, status from public.tables$$, 'cashier can still select the other table columns');
select throws_ok(format($$select * from public.get_table_qr_tokens(%L)$$, pg_temp.loc('ven-a','L1')), '42501', 'FORBIDDEN', 'cashier cannot call get_table_qr_tokens');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$select qr_token from public.tables$$, '42501', null, 'even a manager cannot select qr_token directly');
select throws_ok(format($$select * from public.get_table_qr_tokens(%L)$$, pg_temp.loc('ven-b','L1')), '42501', 'FORBIDDEN', 'manager A cannot read B''s tokens');
select throws_ok($$select * from public.get_table_qr_tokens(gen_random_uuid())$$, '42501', 'FORBIDDEN', 'unknown location looks the same as forbidden');
select ok((select count(*) from public.get_table_qr_tokens(pg_temp.loc('ven-a','L1'))) > 0
  and (select bool_and(qr_token ~ '^[A-Za-z0-9_-]{32}$' and area_name is not null and label is not null) from public.get_table_qr_tokens(pg_temp.loc('ven-a','L1'))),
  'manager gets tokens with label and area for the location');
select is((select count(*)::int from public.get_table_qr_tokens(pg_temp.loc('ven-a','L1'), array[pg_temp.tbl('A1')])), 1, 'table_ids narrows the result');
select is((select count(*)::int from public.get_table_qr_tokens(pg_temp.loc('ven-a','L1'), array[pg_temp.tbl('A3')])), 0, 'inactive tables are not returned');
select is((select count(*)::int from public.get_table_qr_tokens(pg_temp.loc('ven-a','L1'), array[pg_temp.tbl('H1')])), 0, 'another org''s table id returns nothing');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select * from public.get_table_qr_tokens(%L)$$, pg_temp.loc('ven-a','L1')), '42501', 'FORBIDDEN', 'manager scoped to L2 cannot read L1 tokens');
reset role;
set local role anon;
select throws_ok(format($$select * from public.get_table_qr_tokens(%L)$$, pg_temp.loc('ven-a','L1')), '42501', null, 'anon cannot call get_table_qr_tokens');
reset role;

-- ---- AREA_INACTIVE: no active table in an inactive area -------------------------------------------------------------
insert into public.areas (organization_id, location_id, name, is_active) values (pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), 'Closed', false);
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity) values (%L, %L, %L, 'C1', 2)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('Closed')), 'P0001', 'AREA_INACTIVE', 'cannot add an active table to an inactive area');
select lives_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, is_active) values (%L, %L, %L, 'C2', 2, false)$$,
  pg_temp.org('ven-a'), pg_temp.loc('ven-a','L1'), pg_temp.area('Closed')), 'an inactive table may sit in an inactive area');
select throws_ok($$update public.tables set is_active = true where label = 'C2'$$, 'P0001', 'AREA_INACTIVE', 'cannot reactivate a table whose area is inactive');
select throws_ok(format($$update public.tables set area_id = %L where id = %L$$, pg_temp.area('Closed'), pg_temp.tbl('A1')), 'P0001', 'AREA_INACTIVE', 'cannot move an active table into an inactive area');
reset role;

select * from finish();
rollback;
