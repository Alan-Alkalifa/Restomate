-- MVM-T02: areas + tables write isolation: roles, cross-tenant / cross-location writes, reassignment,
-- qr_token and other server-owned column tampering, constraints and trigger guards.
-- ok = exactly one row changed; blocked = refused (42501), refused by a constraint/trigger, or filtered to 0 rows.
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _venue.inc
select plan(134);

create table tests.write_specs (ord serial, actor text, stmt text, expect text, label text);

insert into tests.write_specs (actor, stmt, expect, label) values
-- ---- areas: who may insert ----
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''N-oa'')','ok','owner creates an area'),
 ('ma','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''N-ma'')','ok','manager creates an area'),
 ('sm','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''N-sm'')','ok','scoped manager creates an area in own location'),
 ('sm','insert into public.areas (organization_id, location_id, name) values ({A}, {A2}, ''N-sm2'')','blocked','scoped manager cannot create an area in another location of the same org'),
 ('ma','insert into public.areas (organization_id, location_id, name) values ({A}, {A2}, ''N-ma2'')','ok','all-locations manager creates an area in A2'),
 ('ca','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-ca'')','blocked','cashier (tables.view only) cannot create an area'),
 ('wa','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-wa'')','blocked','waiter cannot create an area'),
 ('ka','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-ka'')','blocked','kitchen cannot create an area'),
 ('da','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-da'')','blocked','deactivated member cannot create an area'),
 ('ob','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-ob'')','blocked','org B owner cannot create an area in org A'),
 ('out','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-out'')','blocked','non-member cannot create an area'),
 ('anon','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-anon'')','blocked','anon cannot create an area'),
 ('padmin','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''Z-pad'')','blocked','platform admin has read-only access to areas'),
-- ---- areas: cross-tenant / mismatched ids ----
 ('oa','insert into public.areas (organization_id, location_id, name) values ({B}, {B1}, ''Z-x1'')','blocked','owner A cannot create an area in org B'),
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {B1}, ''Z-x2'')','blocked','org A + location of org B (mismatched ids) rejected'),
 ('oa','insert into public.areas (organization_id, location_id, name) values ({B}, {A1}, ''Z-x3'')','blocked','org B + location of org A rejected'),
-- ---- areas: names ----
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, ''INDOOR'')','blocked','duplicate active name differing only by case rejected'),
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {A2}, ''Indoor'')','ok','same name in another location is fine'),
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, '''')','blocked','empty area name rejected'),
 ('oa','insert into public.areas (organization_id, location_id, name) values ({A}, {A1}, repeat(''x'', 61))','blocked','61-char area name rejected'),
-- ---- areas: update ----
 ('oa','update public.areas set name = ''Indoor2'' where id = {AR1}','ok','owner renames an area'),
 ('sm','update public.areas set name = ''Indoor3'' where id = {AR1}','ok','scoped manager renames an area in own location'),
 ('sm','update public.areas set name = ''pwn'' where id = {AR2}','blocked','scoped manager cannot rename an area in another location'),
 ('ma','update public.areas set sort_order = 5 where id = {AR2}','ok','manager reorders an area'),
 ('ca','update public.areas set name = ''pwn'' where id = {AR1}','blocked','cashier cannot rename'),
 ('wa','update public.areas set name = ''pwn'' where id = {AR1}','blocked','waiter cannot rename'),
 ('ka','update public.areas set name = ''pwn'' where id = {AR1}','blocked','kitchen cannot rename'),
 ('da','update public.areas set name = ''pwn'' where id = {AR1}','blocked','deactivated cannot rename'),
 ('out','update public.areas set name = ''pwn'' where id = {AR1}','blocked','non-member cannot rename'),
 ('anon','update public.areas set name = ''pwn'' where id = {AR1}','blocked','anon cannot rename'),
 ('padmin','update public.areas set name = ''pwn'' where id = {AR1}','blocked','platform admin cannot rename'),
 ('oa','update public.areas set name = ''pwn'' where id = {ARB}','blocked','owner A cannot rename an area of org B'),
 ('oa','update public.areas set is_active = false where id = {ARB}','blocked','owner A cannot deactivate an area of org B'),
 ('ob','update public.areas set name = ''Bar B'' where id = {ARB}','ok','owner B renames own area'),
-- ---- areas: server-owned / immutable columns ----
 ('oa','update public.areas set location_id = {A2} where id = {AR1}','blocked','area cannot be moved to another location'),
 ('oa','update public.areas set organization_id = {B} where id = {AR1}','blocked','area cannot be reassigned to another org'),
 ('oa','update public.areas set organization_id = {B}, location_id = {B1} where id = {AR1}','blocked','area cannot be moved wholesale into org B'),
 ('oa','update public.areas set id = gen_random_uuid() where id = {AR1}','blocked','area id is immutable'),
 ('oa','update public.areas set created_at = now() - interval ''1 year'' where id = {AR1}','blocked','created_at not client-writable'),
-- ---- areas: deactivate guard ----
 ('oa','update public.areas set is_active = false where id = {AR1}','blocked','AREA_NOT_EMPTY: cannot deactivate an area with active tables'),
 ('ma','update public.areas set is_active = false where id = {AR2}','blocked','AREA_NOT_EMPTY: same for A2'),
 ('oa','update public.areas set is_active = true where id = {ARX}','ok','owner reactivates an empty inactive area'),
 ('oa','update public.areas set is_active = false where id = {ARX}','ok','owner deactivates an empty area'),
-- ---- areas: no delete for anyone ----
 ('oa','delete from public.areas where id = {AR1}','blocked','owner cannot delete an area'),
 ('ma','delete from public.areas where id = {ARX}','blocked','manager cannot delete an area'),
 ('padmin','delete from public.areas where id = {AR1}','blocked','platform admin cannot delete an area'),
 ('ob','delete from public.areas where id = {AR1}','blocked','org B cannot delete an org A area'),
-- ---- tables: who may insert ----
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''N1'', 4)','ok','owner creates a table'),
 ('ma','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''N2'', 4)','ok','manager creates a table'),
 ('sm','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''N3'', 4)','ok','scoped manager creates a table in own location'),
 ('sm','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A2}, {AR2}, ''N4'', 4)','blocked','scoped manager cannot create a table in another location'),
 ('ma','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A2}, {AR2}, ''N5'', 4)','ok','all-locations manager creates a table in A2'),
 ('ca','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z1'', 4)','blocked','cashier cannot create a table'),
 ('wa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z2'', 4)','blocked','waiter cannot create a table'),
 ('ka','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z3'', 4)','blocked','kitchen cannot create a table'),
 ('da','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z4'', 4)','blocked','deactivated member cannot create a table'),
 ('ob','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z5'', 4)','blocked','org B owner cannot create a table in org A'),
 ('out','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z6'', 4)','blocked','non-member cannot create a table'),
 ('anon','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z7'', 4)','blocked','anon cannot create a table'),
 ('padmin','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''Z8'', 4)','blocked','platform admin cannot create a table'),
-- ---- tables: cross-tenant / cross-location references ----
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({B}, {B1}, {ARB}, ''Z9'', 4)','blocked','owner A cannot create a table in org B'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {ARB}, ''Z10'', 4)','blocked','table in A1 pointing at an area of org B rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR2}, ''Z11'', 4)','blocked','table in A1 pointing at an area of A2 (same org) rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {B1}, {ARB}, ''Z12'', 4)','blocked','org A + location/area of org B rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({B}, {A1}, {AR1}, ''Z13'', 4)','blocked','org B + location/area of org A rejected'),
 ('ob','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({B}, {B1}, {AR1}, ''Z14'', 4)','blocked','owner B pointing at an area of org A rejected'),
-- ---- tables: qr_token and server-owned columns on insert ----
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, qr_token) values ({A}, {A1}, {AR1}, ''Z15'', 4, ''chosen-by-client'')','blocked','client cannot choose a qr_token'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, qr_rotated_at) values ({A}, {A1}, {AR1}, ''Z16'', 4, now())','blocked','client cannot set qr_rotated_at'),
 ('oa','insert into public.tables (id, organization_id, location_id, area_id, label, capacity) values (gen_random_uuid(), {A}, {A1}, {AR1}, ''Z17'', 4)','blocked','client cannot choose the table id'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, qr_token) values ({A}, {A1}, {AR1}, ''Z18'', 4, ''tok-b'')','blocked','client cannot reuse another tenant''s token'),
-- ---- tables: values and guards ----
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {ARX}, ''Z19'', 4)','blocked','AREA_INACTIVE: active table in an inactive area'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, is_active) values ({A}, {A1}, {ARX}, ''N6'', 4, false)','ok','inactive table in an inactive area is allowed'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''n1'', 4)','blocked','duplicate active label N1 differing by case rejected'),
 ('ma','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A2}, {AR2}, ''N1'', 4)','ok','same label in another location is fine'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''N7'', 0)','blocked','capacity 0 rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, ''N8'', 51)','blocked','capacity 51 rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, shape) values ({A}, {A1}, {AR1}, ''N9'', 4, ''triangle'')','blocked','unknown shape rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity, status) values ({A}, {A1}, {AR1}, ''N10'', 4, ''bogus'')','blocked','unknown status rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, '''', 4)','blocked','empty label rejected'),
 ('oa','insert into public.tables (organization_id, location_id, area_id, label, capacity) values ({A}, {A1}, {AR1}, repeat(''x'', 21), 4)','blocked','21-char label rejected'),
-- ---- tables: update ----
 ('oa','update public.tables set label = ''T1b'' where id = {TA1}','ok','owner renames a table'),
 ('sm','update public.tables set capacity = 6 where id = {TA1}','ok','scoped manager edits a table in own location'),
 ('sm','update public.tables set capacity = 6 where id = {TA2}','blocked','scoped manager cannot edit a table in another location'),
 ('ma','update public.tables set pos_x = 10, pos_y = 20 where id = {TA2}','ok','manager saves table position'),
 ('ca','update public.tables set label = ''pwn'' where id = {TA1}','blocked','cashier cannot edit a table'),
 ('wa','update public.tables set status = ''occupied'' where id = {TA1}','blocked','waiter cannot change table status through this table (needs tables.manage)'),
 ('ka','update public.tables set label = ''pwn'' where id = {TA1}','blocked','kitchen cannot edit a table'),
 ('da','update public.tables set label = ''pwn'' where id = {TA1}','blocked','deactivated cannot edit a table'),
 ('out','update public.tables set label = ''pwn'' where id = {TA1}','blocked','non-member cannot edit a table'),
 ('anon','update public.tables set label = ''pwn'' where id = {TA1}','blocked','anon cannot edit a table'),
 ('padmin','update public.tables set label = ''pwn'' where id = {TA1}','blocked','platform admin cannot edit a table'),
 ('oa','update public.tables set label = ''pwn'' where id = {TB}','blocked','owner A cannot edit a table of org B'),
 ('oa','update public.tables set is_active = false where id = {TB}','blocked','owner A cannot deactivate a table of org B'),
 ('ob','update public.tables set label = ''T1B-ob'' where id = {TB}','ok','owner B edits own table'),
-- ---- tables: reassignment across areas / locations / orgs ----
 ('oa','update public.tables set area_id = {ARB} where id = {TA1}','blocked','table cannot be moved to an area of org B'),
 ('oa','update public.tables set area_id = {AR2} where id = {TA1}','blocked','table cannot be moved to an area of another location'),
 ('oa','update public.tables set area_id = {ARX} where id = {TA1}','blocked','AREA_INACTIVE: table cannot be moved into an inactive area'),
 ('oa','update public.tables set area_id = (select id from public.areas where name = ''N-oa'' and location_id = {A1}) where id = {TA1}','ok','table moves to another active area of the same location'),
 ('oa','update public.tables set location_id = {A2} where id = {TA1}','blocked','table cannot change location'),
 ('oa','update public.tables set location_id = {A2}, area_id = {AR2} where id = {TA1}','blocked','table cannot change location together with area'),
 ('oa','update public.tables set organization_id = {B} where id = {TA1}','blocked','table cannot change organization'),
 ('oa','update public.tables set organization_id = {B}, location_id = {B1}, area_id = {ARB} where id = {TA1}','blocked','table cannot be moved wholesale into org B'),
 ('ob','update public.tables set organization_id = {A}, location_id = {A1}, area_id = {AR1} where id = {TB}','blocked','org B cannot move its table into org A'),
-- ---- tables: qr_token tampering ----
 ('oa','update public.tables set qr_token = ''chosen'' where id = {TA1}','blocked','owner cannot set qr_token'),
 ('ma','update public.tables set qr_token = ''chosen'' where id = {TA2}','blocked','manager cannot set qr_token'),
 ('oa','update public.tables set qr_token = ''tok-a2'' where id = {TA1}','blocked','cannot clone another table''s token (owner)'),
 ('oa','update public.tables set qr_token = ''tok-b'' where id = {TA1}','blocked','cannot take over org B''s token'),
 ('ob','update public.tables set qr_token = ''tok-a1'' where id = {TB}','blocked','org B cannot take over org A''s token'),
 ('oa','update public.tables set qr_rotated_at = null where id = {TA1}','blocked','cannot reset qr_rotated_at'),
 ('oa','update public.tables set id = gen_random_uuid() where id = {TA1}','blocked','table id is immutable'),
 ('oa','update public.tables set created_at = now() - interval ''1 year'' where id = {TA1}','blocked','created_at not client-writable'),
-- ---- tables: no delete ----
 ('oa','delete from public.tables where id = {TA1}','blocked','owner cannot delete a table'),
 ('ma','delete from public.tables where id = {TX}','blocked','manager cannot delete a table'),
 ('padmin','delete from public.tables where id = {TA1}','blocked','platform admin cannot delete a table'),
 ('ob','delete from public.tables where id = {TA1}','blocked','org B cannot delete an org A table');

create function tests.run_writes() returns setof text language plpgsql as $$
declare s record; n bigint;
begin
  for s in select * from tests.write_specs order by ord loop
    n := tests.aff(s.actor, s.stmt);
    if s.expect = 'ok' then
      return next is(n, 1::bigint, s.actor || ': ' || s.label);
    else
      return next cmp_ok(n, '<=', 0::bigint, s.actor || ': ' || s.label);
    end if;
  end loop;
end $$;
select * from tests.run_writes();

-- ---- state after the attacks (checked as postgres) ----
select is((select qr_token from public.tables where id = (select id from tests.ids where name = 'TA1')), 'tok-a1', 'TA1 token untouched');
select is((select qr_token from public.tables where id = (select id from tests.ids where name = 'TA2')), 'tok-a2', 'TA2 token untouched');
select is((select qr_token from public.tables where id = (select id from tests.ids where name = 'TB')), 'tok-b', 'TB token untouched');
select is((select label from public.tables where id = (select id from tests.ids where name = 'TB')), 'T1B-ob', 'TB changed only by its own owner');
select is((select name from public.areas where id = (select id from tests.ids where name = 'ARB')), 'Bar B', 'ARB changed only by its own owner');
select is((select count(*)::int from public.areas where organization_id = (select id from tests.ids where name = 'B')), 1, 'org B still has exactly one area');
select is((select count(*)::int from public.tables where organization_id = (select id from tests.ids where name = 'B')), 1, 'org B still has exactly one table');
select is((select is_active from public.tables where id = (select id from tests.ids where name = 'TB')), true, 'TB still active');
select is((select count(*)::int from public.areas a where not exists (select 1 from public.locations l where l.id = a.location_id and l.organization_id = a.organization_id)), 0, 'every area: location belongs to the same org');
select is((select count(*)::int from public.tables t where not exists (select 1 from public.areas a where a.id = t.area_id and a.location_id = t.location_id and a.organization_id = t.organization_id)), 0, 'every table: area is in the same location and org');
select is((select count(*)::int from public.tables where label like 'Z%' or label = 'pwn'), 0, 'no attacker-created or attacker-renamed tables');
select is((select count(*)::int from public.areas where name like 'Z-%' or name = 'pwn'), 0, 'no attacker-created or attacker-renamed areas');
select is((select count(*)::int from public.tables where location_id = (select id from tests.ids where name = 'A1') and lower(label) = 'n1'), 1, 'exactly one active N1 in A1');
-- server-generated token for client-created tables
select ok((select bool_and(qr_token ~ '^[A-Za-z0-9_-]{32}$') from public.tables where label in ('N1','N2','N3','N5')), 'client-created tables got a 32-char base64url token');
select is((select count(distinct qr_token)::int from public.tables where label in ('N1','N2','N3','N5')), 5, 'generated tokens are distinct (N1 exists in A1 and A2)');
select is((select count(*)::int from public.tables where qr_token = 'chosen-by-client' or qr_token = 'chosen'), 0, 'no client-chosen token stored');
-- audit
select cmp_ok((select count(*)::int from public.audit_logs where action = 'area.created' and actor_id = (select id from tests.ids where name = 'uoa')), '>=', 1, 'area.created audited with the actor');
select cmp_ok((select count(*)::int from public.audit_logs where action = 'table.created' and actor_id = (select id from tests.ids where name = 'uma')), '>=', 1, 'table.created audited with the actor');
select is((select count(*)::int from public.audit_logs where entity_type = 'table' and metadata::text like '%tok-%'), 0, 'audit metadata never contains a token value');

select * from finish();
rollback;
