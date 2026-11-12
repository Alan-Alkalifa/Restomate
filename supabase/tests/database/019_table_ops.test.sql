-- MSC-T12: table operations. move_order_to_table, merge_tables / unmerge_table (order_tables), assign_order_waiter,
-- list_assignable_waiters, cross-exclusion triggers, in-use guard, closing frees the whole group, lock order.
-- Contract: docs/contracts/orders.md "Table operations".
begin;
select plan(105);

insert into public.packages (code, name, limits) values ('t-tops', 'TableOps', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'e' || n || '@e.test', now(), now(), now()
from generate_series(1, 7) n;
insert into public.profiles (id, email, full_name)
select ('00000000-0000-0000-0000-0000000000e' || n)::uuid, 'e' || n || '@e.test', 'Staff ' || n from generate_series(1, 7) n
on conflict (id) do update set full_name = excluded.full_name;

create table pg_temp.res (k text primary key, j jsonb);
grant all on pg_temp.res to authenticated;
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org('tops-a') and name = n $$;
create function pg_temp.tbl(l text) returns uuid language sql security definer as $$ select id from public.tables where label = l and organization_id = pg_temp.org('tops-a') $$;
create function pg_temp.itm(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n and organization_id = pg_temp.org('tops-a') $$;
create function pg_temp.ref(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-00000000d' || lpad(n::text, 3, '0'))::uuid $$;
create function pg_temp.ord(k text) returns uuid language sql security definer as $$ select (j ->> 'orderId')::uuid from pg_temp.res where k = $1 $$;
create function pg_temp.tstatus(l text) returns text language sql security definer as $$ select status from public.tables where id = pg_temp.tbl(l) $$;
create function pg_temp.otable(k text) returns text language sql security definer as $$
  select t.label from public.orders o join public.tables t on t.id = o.table_id where o.id = pg_temp.ord(k) $$;
create function pg_temp.round(t text, r int) returns jsonb language sql as $$
  select public.submit_order_round(pg_temp.loc('L1'), pg_temp.tbl(t), 'dine_in',
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.itm('Cola'), 'quantity', 1)), pg_temp.ref(r)) $$;
create function pg_temp.events(k text, ty text) returns bigint language sql security definer as $$
  select count(*) from public.order_events where order_id = pg_temp.ord(k) and event_type = ty $$;
create function pg_temp.group_of(k text) returns text language sql security definer as $$
  select coalesce(string_agg(t.label, ',' order by t.label), '') from public.order_tables ot join public.tables t on t.id = ot.table_id
  where ot.order_id = pg_temp.ord(k) and ot.released_at is null $$;

-- ---- fixtures -------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org Tops A', 'tops-a', '{"name":"L1"}'::jsonb, null, 't-tops');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select public.create_organization('Org Tops B', 'tops-b', '{"name":"B1"}'::jsonb, null, 't-tops');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('tops-a'), 'L2');
-- u1 owner, u2 manager, u3 cashier, u4 waiter, u5 kitchen, u6 waiter scoped to L2, u7 owner of org B
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('tops-a'), pg_temp.uid(2), pg_temp.role('tops-a', 'manager'), true),
  (pg_temp.org('tops-a'), pg_temp.uid(3), pg_temp.role('tops-a', 'cashier'), true),
  (pg_temp.org('tops-a'), pg_temp.uid(4), pg_temp.role('tops-a', 'waiter'),  true),
  (pg_temp.org('tops-a'), pg_temp.uid(5), pg_temp.role('tops-a', 'kitchen'), true),
  (pg_temp.org('tops-a'), pg_temp.uid(6), pg_temp.role('tops-a', 'waiter'),  false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('L2'), m.organization_id from public.organization_members m where m.user_id = pg_temp.uid(6);
insert into public.menu_categories (organization_id, name) values (pg_temp.org('tops-a'), 'Mains');
insert into public.menu_items (organization_id, category_id, name, base_price, is_published)
select pg_temp.org('tops-a'), c.id, 'Cola', 10000, true from public.menu_categories c where c.name = 'Mains' and c.organization_id = pg_temp.org('tops-a');
insert into public.areas (organization_id, location_id, name) values
  (pg_temp.org('tops-a'), pg_temp.loc('L1'), 'Hall'), (pg_temp.org('tops-a'), pg_temp.loc('L2'), 'Hall2');
insert into public.tables (organization_id, location_id, area_id, label, capacity)
select pg_temp.org('tops-a'), pg_temp.loc('L1'), a.id, x.l, 4 from public.areas a,
  (values ('T1'), ('T2'), ('T3'), ('T4'), ('T5'), ('T6'), ('T7'), ('T8'), ('T9'), ('T10'), ('T11'), ('T12')) x(l)
where a.name = 'Hall' and a.organization_id = pg_temp.org('tops-a');
insert into public.tables (organization_id, location_id, area_id, label, capacity)
select pg_temp.org('tops-a'), pg_temp.loc('L2'), a.id, 'X1', 4 from public.areas a where a.name = 'Hall2' and a.organization_id = pg_temp.org('tops-a');

-- ---- seating + waiter default ---------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res select 'A', pg_temp.round('T1', 1);
insert into pg_temp.res select 'TA', public.submit_order_round(pg_temp.loc('L1'), null, 'takeaway',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.itm('Cola'), 'quantity', 1)), pg_temp.ref(2));
reset role;
select is((select waiter_id from public.orders where id = pg_temp.ord('A')), pg_temp.uid(4), 'a dine-in order defaults its waiter to the opener');
select is((select waiter_id from public.orders where id = pg_temp.ord('TA')), null, 'a takeaway order has no waiter');
select is(pg_temp.tstatus('T1'), 'occupied', 'T1 occupied');

-- ---- move_order_to_table: authorization + shape -----------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T2')), '42501', 'FORBIDDEN', 'org B cannot move org A''s order');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T2')), '42501', 'FORBIDDEN', 'a waiter scoped to L2 cannot move an L1 order');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T2')), '42501', 'FORBIDDEN', 'kitchen cannot move an order');
reset role;
set local role anon;
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T2')), '42501', null, 'anon cannot execute');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, gen_random_uuid(), pg_temp.tbl('T2')), '42501', 'FORBIDDEN', 'an unknown order looks like a missing permission');
select throws_ok(format($$select public.move_order_to_table(%L, null)$$, pg_temp.ord('A')), '22023', 'INVALID_INPUT', 'a null target is INVALID_INPUT');
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('TA'), pg_temp.tbl('T2')), 'P0001', 'ORDER_NOT_MOVABLE', 'a takeaway order cannot be moved');
reset role;
-- target problems
update public.tables set status = 'reserved' where id = pg_temp.tbl('T6');
update public.tables set is_active = false where id = pg_temp.tbl('T7');
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T6')), 'P0001', 'TABLE_NOT_AVAILABLE', 'a reserved table is refused');
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T7')), 'P0001', 'TABLE_NOT_FOUND', 'an inactive table is TABLE_NOT_FOUND');
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), (select id from public.tables where label = 'X1')), 'P0001', 'TABLE_NOT_FOUND', 'a table of another location is TABLE_NOT_FOUND');
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), gen_random_uuid()), 'P0001', 'TABLE_NOT_FOUND', 'an unknown table is TABLE_NOT_FOUND');
insert into pg_temp.res select 'B', pg_temp.round('T3', 3);
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T3')), 'P0001', 'TABLE_NOT_AVAILABLE', 'an occupied table is refused');
reset role;

-- ---- move: happy path, with an ACTIVE BILL (a bill stores no table) ------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
insert into pg_temp.res select 'billA', public.create_bills(pg_temp.ord('A'), pg_temp.ref(4));
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select is(public.move_order_to_table(pg_temp.ord('A'), pg_temp.tbl('T2')) ->> 'toTableId', pg_temp.tbl('T2')::text, 'move T1 to T2 works while a bill set is active (no BILL_EXISTS)');
reset role;
select is(pg_temp.otable('A'), 'T2', 'the order is now on T2');
select is(pg_temp.tstatus('T2'), 'occupied', 'the target is occupied');
select is(pg_temp.tstatus('T1'), 'needs_cleaning', 'the old table needs cleaning');
select is(pg_temp.events('A', 'order_moved'), 1::bigint, 'one order_moved event');
select is((select count(*) from public.order_events where order_id = pg_temp.ord('A') and event_type = 'table_status_changed' and to_status in ('occupied', 'needs_cleaning')
           and (payload ->> 'table_id')::uuid in (pg_temp.tbl('T1'), pg_temp.tbl('T2'))), 3::bigint, 'two table status events for the move (plus the original seat)');
select is((select count(*) from public.audit_logs where action = 'order.moved' and organization_id = pg_temp.org('tops-a')), 1::bigint, 'the move is audited');
select pg_temp.act_as(pg_temp.uid(4));
select is(public.move_order_to_table(pg_temp.ord('A'), pg_temp.tbl('T2')) ->> 'toTableId', pg_temp.tbl('T2')::text, 'moving to the table it is already on is a no-op');
reset role;
select is(pg_temp.events('A', 'order_moved'), 1::bigint, 'and writes no second event');
select is((select count(*) from public.bill_sets where order_id = pg_temp.ord('A') and status = 'active'), 1::bigint, 'the bill set is untouched');
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T1')), 'P0001', 'TABLE_NOT_AVAILABLE', 'the old table is needs_cleaning until cleaned');
select public.mark_table_clean(pg_temp.tbl('T1'));
reset role;
select is(pg_temp.tstatus('T1'), 'available', 'cleaned');

-- ---- merge ----------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T4')] || array[pg_temp.tbl('T4')]), '22023', 'INVALID_INPUT', 'duplicate tables are INVALID_INPUT');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T2')]), '22023', 'INVALID_INPUT', 'the primary table itself is INVALID_INPUT');
select throws_ok(format($$select public.merge_tables(%L, '{}'::uuid[])$$, pg_temp.ord('A')), '22023', 'INVALID_INPUT', 'an empty list is INVALID_INPUT');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), (select array_agg(id) from (select id from public.tables where label in ('T3','T4','T5','T6','T7','T8','T9','T10','T11','T12') ) q)), '22023', 'INVALID_INPUT', 'more than 9 tables is INVALID_INPUT');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('TA'), array[pg_temp.tbl('T4')]), 'P0001', 'ORDER_NOT_MOVABLE', 'a takeaway order cannot be merged');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T4'), pg_temp.tbl('T3')]), 'P0001', 'TABLE_NOT_AVAILABLE', 'one occupied table refuses the whole call');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T4'), pg_temp.tbl('T6')]), 'P0001', 'TABLE_NOT_AVAILABLE', 'a reserved table refuses the whole call');
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T4'), pg_temp.tbl('T7')]), 'P0001', 'TABLE_NOT_FOUND', 'an inactive table refuses the whole call');
reset role;
select is(pg_temp.tstatus('T4'), 'available', 'all-or-nothing: T4 stayed available after the refused merges');
select is(pg_temp.group_of('A'), '', 'and no group rows were created');
select pg_temp.act_as(pg_temp.uid(4));
select is(public.merge_tables(pg_temp.ord('A'), array[pg_temp.tbl('T4'), pg_temp.tbl('T5')]) -> 'tableIds' @> to_jsonb(array[pg_temp.tbl('T4'), pg_temp.tbl('T5')]), true, 'a waiter merges T4 and T5 into the party');
reset role;
select is(pg_temp.group_of('A'), 'T4,T5', 'the group is T4 and T5');
select is(pg_temp.tstatus('T4') || '/' || pg_temp.tstatus('T5'), 'occupied/occupied', 'merged tables are occupied');
select is(pg_temp.events('A', 'tables_merged'), 1::bigint, 'one tables_merged event');
select pg_temp.act_as(pg_temp.uid(4));
select public.merge_tables(pg_temp.ord('A'), array[pg_temp.tbl('T4'), pg_temp.tbl('T8')]);
reset role;
select is(pg_temp.group_of('A'), 'T4,T5,T8', 'merging again is idempotent for tables already in the group and adds the rest');
select is(pg_temp.events('A', 'tables_merged'), 2::bigint, 'and records only the newly added ones');
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.move_order_to_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T9')), 'P0001', 'ORDER_HAS_GROUP', 'a grouped order cannot be moved (unmerge first)');
select throws_ok(format($$select pg_temp.round('T4', 5)$$), 'P0001', 'TABLE_IN_GROUP', 'submit_order_round on a secondary table is TABLE_IN_GROUP');
reset role;
select is(pg_temp.tstatus('T4'), 'occupied', 'and the refused round changed nothing');

-- ---- cross-exclusion + unique + in-use guards -------------------------------------------------------------------------------------
select throws_ok(format($$insert into public.order_tables (organization_id, location_id, order_id, table_id) values (%L, %L, %L, %L)$$,
  pg_temp.org('tops-a'), pg_temp.loc('L1'), pg_temp.ord('A'), pg_temp.tbl('T3')), 'P0001', 'TABLE_NOT_AVAILABLE', 'a table that is the primary table of an open order cannot join a group');
select throws_ok(format($$insert into public.order_tables (organization_id, location_id, order_id, table_id) values (%L, %L, %L, %L)$$,
  pg_temp.org('tops-a'), pg_temp.loc('L1'), pg_temp.ord('A'), pg_temp.tbl('T2')), '22023', 'INVALID_INPUT', 'a table cannot be both primary and secondary of the same order');
select throws_ok(format($$insert into public.order_tables (organization_id, location_id, order_id, table_id) values (%L, %L, %L, %L)$$,
  pg_temp.org('tops-a'), pg_temp.loc('L1'), pg_temp.ord('B'), pg_temp.tbl('T4')), '23505', null, 'the unique index forbids two active rows for one table');
select throws_ok(format($$update public.orders set table_id = %L where id = %L$$, pg_temp.tbl('T4'), pg_temp.ord('B')), 'P0001', 'TABLE_IN_GROUP', 'an order cannot be moved onto an active secondary table (trigger backstop)');
select pg_temp.act_as(pg_temp.uid(1));
select throws_ok(format($$update public.tables set is_active = false where id = %L$$, pg_temp.tbl('T2')), 'P0001', 'TABLE_NOT_AVAILABLE', 'a primary table of an open order cannot be deactivated');
select throws_ok(format($$update public.tables set is_active = false where id = %L$$, pg_temp.tbl('T4')), 'P0001', 'TABLE_NOT_AVAILABLE', 'an active secondary table cannot be deactivated');
select lives_ok(format($$update public.tables set is_active = false where id = %L$$, pg_temp.tbl('T12')), 'a free table can be deactivated');
reset role;
select throws_ok(format($$delete from public.tables where id = %L$$, pg_temp.tbl('T4')), 'P0001', 'TABLE_NOT_AVAILABLE', 'and cannot be deleted');

-- ---- unmerge ------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.unmerge_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T2')), 'P0001', 'TABLE_NOT_IN_GROUP', 'the primary table cannot be released');
select throws_ok(format($$select public.unmerge_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T9')), 'P0001', 'TABLE_NOT_IN_GROUP', 'a table outside the group is refused');
select throws_ok(format($$select public.unmerge_table(%L, null)$$, pg_temp.ord('A')), '22023', 'INVALID_INPUT', 'a null table is INVALID_INPUT');
select is(public.unmerge_table(pg_temp.ord('A'), pg_temp.tbl('T8')) ->> 'tableId', pg_temp.tbl('T8')::text, 'a waiter releases T8');
reset role;
select is(pg_temp.group_of('A'), 'T4,T5', 'the group is T4 and T5 again');
select is(pg_temp.tstatus('T8'), 'needs_cleaning', 'the released table needs cleaning');
select is((select count(*) from public.order_tables where order_id = pg_temp.ord('A') and released_at is not null and released_by is not null), 1::bigint, 'the row is kept, released');
select is(pg_temp.events('A', 'table_unmerged'), 1::bigint, 'one table_unmerged event');
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.merge_tables(%L, %L)$$, pg_temp.ord('A'), array[pg_temp.tbl('T9')]), '42501', 'FORBIDDEN', 'kitchen cannot merge');
select throws_ok(format($$select public.unmerge_table(%L, %L)$$, pg_temp.ord('A'), pg_temp.tbl('T4')), '42501', 'FORBIDDEN', 'kitchen cannot unmerge');
reset role;

-- ---- closing frees the WHOLE group (cancel path) ------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select public.cancel_order(pg_temp.ord('A'), 'guests left');
reset role;
select is(pg_temp.tstatus('T2') || '/' || pg_temp.tstatus('T4') || '/' || pg_temp.tstatus('T5'), 'needs_cleaning/needs_cleaning/needs_cleaning', 'cancelling frees the primary and every secondary table');
select is((select count(*) from public.order_tables where order_id = pg_temp.ord('A') and released_at is null), 0::bigint, 'and releases every group row');
select is(pg_temp.group_of('A'), '', 'no active group remains');

-- ---- closing frees the WHOLE group (paid + served path) --------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res select 'C', pg_temp.round('T9', 10);
select public.merge_tables(pg_temp.ord('C'), array[pg_temp.tbl('T10'), pg_temp.tbl('T11')]);
select public.set_order_status(pg_temp.ord('C'), 'served');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
insert into pg_temp.res select 'billC', public.create_bills(pg_temp.ord('C'), pg_temp.ref(11));
select public.record_payment(bill_id := (select (j -> 'bills' -> 0 ->> 'id')::uuid from pg_temp.res where k = 'billC'), method := 'edc_card', amount := 11000, client_ref := pg_temp.ref(12));
reset role;
select is((select status from public.orders where id = pg_temp.ord('C')), 'completed', 'paid + served completes the grouped order');
select is(pg_temp.tstatus('T9') || '/' || pg_temp.tstatus('T10') || '/' || pg_temp.tstatus('T11'), 'needs_cleaning/needs_cleaning/needs_cleaning', 'completion frees the primary and every secondary table');
select is((select count(*) from public.order_tables where order_id = pg_temp.ord('C') and released_at is null), 0::bigint, 'and releases the group rows');

-- ---- waiter assignment -----------------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res select 'D', pg_temp.round('T1', 20);
select is(public.assign_order_waiter(pg_temp.ord('D'), pg_temp.uid(4)) ->> 'waiterId', pg_temp.uid(4)::text, 'assigning yourself again is a no-op');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), pg_temp.uid(3)), '42501', 'FORBIDDEN', 'a waiter cannot assign someone else');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is(public.assign_order_waiter(pg_temp.ord('D'), pg_temp.uid(3)) ->> 'waiterId', pg_temp.uid(3)::text, 'a cashier takes the table (orders.create)');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.assign_order_waiter(%L, null)$$, pg_temp.ord('D')), '42501', 'FORBIDDEN', 'a waiter cannot clear someone else''s assignment');
-- assignment gates nothing: the previous waiter can still add a round on the same order
select lives_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$, pg_temp.loc('L1'), pg_temp.tbl('T1'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.itm('Cola'), 'quantity', 1)), pg_temp.ref(21)), 'a non-assigned waiter can still add a round (assignment gates nothing)');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select is(public.assign_order_waiter(pg_temp.ord('D'), pg_temp.uid(4)) ->> 'waiterId', pg_temp.uid(4)::text, 'a manager (tables.manage) reassigns to another waiter');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), pg_temp.uid(5)), 'P0001', 'INVALID_ASSIGNEE', 'kitchen (no orders.create) is not assignable');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), pg_temp.uid(6)), 'P0001', 'INVALID_ASSIGNEE', 'a waiter without access to the location is not assignable');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), pg_temp.uid(7)), 'P0001', 'INVALID_ASSIGNEE', 'a user of another org is not assignable (same error)');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), gen_random_uuid()), 'P0001', 'INVALID_ASSIGNEE', 'an unknown user is not assignable (same error)');
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('A'), pg_temp.uid(4)), 'P0001', 'ORDER_CLOSED', 'a closed order cannot be assigned');
select is(public.assign_order_waiter(pg_temp.ord('D'), null) ->> 'waiterId', null, 'a manager clears the assignment');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select public.assign_order_waiter(%L, %L)$$, pg_temp.ord('D'), pg_temp.uid(7)), '42501', 'FORBIDDEN', 'org B cannot assign on org A''s order');
reset role;
select ok(pg_temp.events('D', 'waiter_assigned') >= 3, 'assignments are recorded as events');
select is((select count(*) from public.audit_logs where action = 'order.waiter_assigned'), 2::bigint, 'assigning or clearing someone else is audited (self-service is not)');

-- ---- list_assignable_waiters --------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select is((select jsonb_agg(w ->> 'userId' order by w ->> 'userId') from jsonb_array_elements(public.list_assignable_waiters(pg_temp.loc('L1'))) w),
  to_jsonb(array[pg_temp.uid(1), pg_temp.uid(2), pg_temp.uid(3), pg_temp.uid(4)]::text[]), 'only members with orders.create and access to the location are listed');
select is((select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(w) k from jsonb_array_elements(public.list_assignable_waiters(pg_temp.loc('L1'))) w) q),
  'displayName,userId', 'and only userId + displayName are exposed');
select is((select count(*) from jsonb_array_elements(public.list_assignable_waiters(pg_temp.loc('L2'))) w where w ->> 'userId' = pg_temp.uid(6)::text), 1::bigint, 'the L2-scoped waiter is assignable at L2');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is(jsonb_array_length(public.list_assignable_waiters(pg_temp.loc('L1'))), 4, 'kitchen (orders.view) may list');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select public.list_assignable_waiters(%L)$$, pg_temp.loc('L1')), '42501', 'FORBIDDEN', 'org B cannot list org A''s staff');
reset role;

-- ---- invariants + isolation + hygiene ------------------------------------------------------------------------------------------------
select is((select count(*) from (select table_id from public.orders where table_id is not null and status not in ('completed', 'cancelled')
           group by table_id having count(*) > 1) d), 0::bigint, 'one open order per table still holds');
select is((select count(*) from public.orders o join public.order_tables ot on ot.table_id = o.table_id and ot.released_at is null
           where o.status not in ('completed', 'cancelled')), 0::bigint, 'no table is both a primary and an active secondary table');
select is((select count(*) from public.order_tables ot join public.tables t on t.id = ot.table_id
           where ot.released_at is null and t.status <> 'occupied'), 0::bigint, 'every active secondary table is occupied');
select pg_temp.act_as(pg_temp.uid(7));
select is((select count(*) from public.order_tables), 0::bigint, 'org B reads no order_tables of org A');
select throws_ok($$insert into public.order_tables (organization_id, location_id, order_id, table_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'authenticated cannot insert into order_tables');
select throws_ok($$update public.orders set waiter_id = null$$, '42501', null, 'authenticated cannot update orders.waiter_id directly');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select ok((select count(*) from public.order_tables) > 0, 'a waiter reads the group rows (orders.view)');
reset role;

-- ---- Realtime: no new events, waiter_id is never published ---------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname like 'broadcast\_%' and pg_get_functiondef(p.oid) ilike '%waiter%'), 0::bigint,
  'no broadcast function mentions the waiter: waiter_id is not in any Realtime payload');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname in ('broadcast_order_change', 'broadcast_ticket_change', 'broadcast_ticket_item_change', 'broadcast_table_change')
             and pg_get_functiondef(p.oid) ~* '(amount|price|subtotal|discount|total)'), 0::bigint,
  'and the orders-channel broadcast functions carry no money');

-- ---- lock order: tables (sorted by id) before the order --------------------------------------------------------------------------------
select ok(strpos(pg_get_functiondef('public.move_order_to_table(uuid,uuid)'::regprocedure), 'private.lock_tables(')
          between 1 and strpos(pg_get_functiondef('public.move_order_to_table(uuid,uuid)'::regprocedure), 'for update') - 1, 'move_order_to_table locks the tables before the order');
select ok(strpos(pg_get_functiondef('public.merge_tables(uuid,uuid[])'::regprocedure), 'private.lock_tables(')
          between 1 and strpos(pg_get_functiondef('public.merge_tables(uuid,uuid[])'::regprocedure), 'for update') - 1, 'merge_tables locks the tables before the order');
select ok(strpos(pg_get_functiondef('public.unmerge_table(uuid,uuid)'::regprocedure), 'private.lock_tables(')
          between 1 and strpos(pg_get_functiondef('public.unmerge_table(uuid,uuid)'::regprocedure), 'for update') - 1, 'unmerge_table locks the tables before the order');
select ok(pg_get_functiondef('private.lock_tables(uuid[])'::regprocedure) ~* 'order by t\.id for update', 'lock_tables takes the row locks in id order');
select ok(pg_get_functiondef('private.lock_order_table(uuid)'::regprocedure) ~* 'order by x\.t', 'lock_order_table collects every table of the order sorted by id');
select ok(pg_get_functiondef('private.lock_order_table(uuid)'::regprocedure) ilike '%order_tables%', 'and includes the active secondary tables');

select * from finish();
rollback;
