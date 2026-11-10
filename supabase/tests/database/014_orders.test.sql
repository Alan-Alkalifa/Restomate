-- MSC-T04: orders + kitchen tickets. Transition matrix, submit_order_round (recompute, idempotency, all-or-nothing),
-- derived statuses, creator self-void, discounts, cancel, numbering, Realtime policy, isolation.
begin;
select plan(95);

insert into public.packages (code, name, limits) values ('t-ord', 'Orders', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'o' || n || '@o.test', now(), now(), now()
from generate_series(1, 7) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(s text, n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org(s) and name = n $$;
create function pg_temp.tbl(l text) returns uuid language sql security definer as $$ select id from public.tables where label = l and organization_id = pg_temp.org('ord-a') $$;
create function pg_temp.itm(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n and organization_id = pg_temp.org('ord-a') $$;
create function pg_temp.var(n text) returns uuid language sql security definer as $$ select id from public.item_variants where name = n and organization_id = pg_temp.org('ord-a') $$;
create function pg_temp.mod(n text) returns uuid language sql security definer as $$ select id from public.modifiers where name = n and organization_id = pg_temp.org('ord-a') $$;
create function pg_temp.ref(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-00000000f' || lpad(n::text, 3, '0'))::uuid $$;
create function pg_temp.line(item text, qty int default 1, mods text[] default '{}', variant text default null, note text default null)
returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.itm(item), 'quantity', qty,
    'modifier_ids', coalesce((select jsonb_agg(pg_temp.mod(m)) from unnest(mods) m), '[]'::jsonb))
    || case when variant is null then '{}'::jsonb else jsonb_build_object('variant_id', pg_temp.var(variant)) end
    || case when note is null then '{}'::jsonb else jsonb_build_object('note', note) end $$;
create function pg_temp.cnt(q text) returns int language plpgsql security definer as $$
declare n int; begin execute q into n; return n; end $$;
create function pg_temp.status_of(n int) returns text language sql security definer as $$
  select status from public.orders where order_number = n and location_id = pg_temp.loc('ord-a', 'L1') $$;
create table pg_temp.res (k text primary key, j jsonb);
grant all on pg_temp.res to authenticated;

-- ---- transition matrix: SQL mirror of lib/orders/transitions.ts ---------------------------------------------------
select is((select string_agg(a || '>' || b, ',' order by a, b)
           from unnest(array['draft','placed','accepted','preparing','ready','served','completed','cancelled']) a,
                unnest(array['draft','placed','accepted','preparing','ready','served','completed','cancelled']) b
           where private.order_transition_ok(a, b)),
  'accepted>cancelled,accepted>preparing,draft>cancelled,draft>placed,placed>accepted,placed>cancelled,preparing>cancelled,preparing>ready,ready>cancelled,ready>served,served>completed',
  'order machine: exactly the contract transitions (no skipping, none out of terminal states, cancel only before served)');
select is((select string_agg(a || '>' || b, ',' order by a, b)
           from unnest(array['new','in_progress','ready','bumped']) a, unnest(array['new','in_progress','ready','bumped']) b
           where private.kot_transition_ok(a, b)),
  'in_progress>ready,new>in_progress,ready>bumped', 'KOT machine: new > in_progress > ready > bumped only');
select is((select string_agg(a || '>' || b, ',' order by a, b)
           from unnest(array['available','reserved','occupied','needs_cleaning']) a,
                unnest(array['available','reserved','occupied','needs_cleaning']) b
           where private.table_transition_ok(a, b)),
  'available>occupied,available>reserved,needs_cleaning>available,occupied>needs_cleaning,reserved>occupied',
  'table machine: available > reserved > occupied > needs_cleaning > available (seat from available or reserved)');

-- ---- fixtures -------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org Ord A', 'ord-a', '{"name":"L1"}'::jsonb, null, 't-ord');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select public.create_organization('Org Ord B', 'ord-b', '{"name":"B1"}'::jsonb, null, 't-ord');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('ord-a'), 'L2');
update public.locations set timezone = 'Pacific/Kiritimati' where id = pg_temp.loc('ord-a', 'L1');

-- u1 owner, u2 manager, u3 cashier, u4 waiter, u5 kitchen (all locations), u6 waiter scoped to L2, u7 owner of org B
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('ord-a'), pg_temp.uid(2), pg_temp.role('ord-a', 'manager'), true),
  (pg_temp.org('ord-a'), pg_temp.uid(3), pg_temp.role('ord-a', 'cashier'), true),
  (pg_temp.org('ord-a'), pg_temp.uid(4), pg_temp.role('ord-a', 'waiter'),  true),
  (pg_temp.org('ord-a'), pg_temp.uid(5), pg_temp.role('ord-a', 'kitchen'), true),
  (pg_temp.org('ord-a'), pg_temp.uid(6), pg_temp.role('ord-a', 'waiter'),  false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('ord-a', 'L2'), m.organization_id from public.organization_members m where m.user_id = pg_temp.uid(6);

insert into public.kitchen_stations (organization_id, location_id, name) values (pg_temp.org('ord-a'), pg_temp.loc('ord-a', 'L1'), 'Grill');
insert into public.menu_categories (organization_id, name) values (pg_temp.org('ord-a'), 'Mains');
insert into public.menu_items (organization_id, category_id, name, base_price, is_published)
select pg_temp.org('ord-a'), c.id, x.n, x.p, x.pub
from public.menu_categories c, (values ('Burger', 50000, true), ('Cola', 10000, true), ('Pizza', 60000, true),
  ('Steak', 90000, true), ('Hidden', 1000, false)) x(n, p, pub) where c.name = 'Mains' and c.organization_id = pg_temp.org('ord-a');
insert into public.item_variants (organization_id, item_id, name, price_delta)
select pg_temp.org('ord-a'), pg_temp.itm('Pizza'), x.n, x.d from (values ('Small', 0), ('Large', 20000)) x(n, d);
insert into public.modifier_groups (organization_id, name, min_select, max_select) values
  (pg_temp.org('ord-a'), 'Extras', 0, 2), (pg_temp.org('ord-a'), 'Doneness', 1, 1);
insert into public.modifiers (organization_id, group_id, name, price_delta)
select pg_temp.org('ord-a'), g.id, x.n, x.d from public.modifier_groups g
join (values ('Extras', 'Cheese', 5000), ('Extras', 'Bacon', 8000), ('Doneness', 'Rare', 0), ('Doneness', 'Well', 0)) x(g, n, d) on x.g = g.name and g.organization_id = pg_temp.org('ord-a');
insert into public.menu_item_modifier_groups (organization_id, item_id, group_id)
select pg_temp.org('ord-a'), pg_temp.itm(x.i), g.id from public.modifier_groups g
join (values ('Burger', 'Extras'), ('Steak', 'Doneness')) x(i, g) on x.g = g.name and g.organization_id = pg_temp.org('ord-a');
-- Burger goes to the Grill; Cola and the rest have no station (skip the KDS)
insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id)
select pg_temp.org('ord-a'), pg_temp.loc('ord-a', 'L1'), pg_temp.itm('Burger'), s.id from public.kitchen_stations s where s.name = 'Grill' and s.organization_id = pg_temp.org('ord-a');
insert into public.areas (organization_id, location_id, name) values (pg_temp.org('ord-a'), pg_temp.loc('ord-a', 'L1'), 'Hall');
insert into public.tables (organization_id, location_id, area_id, label, capacity)
select pg_temp.org('ord-a'), pg_temp.loc('ord-a', 'L1'), a.id, x.l, 4 from public.areas a, (values ('T1'), ('T2'), ('T3')) x(l) where a.name = 'Hall' and a.organization_id = pg_temp.org('ord-a');

-- ---- authorization + shape ------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)),
  '42501', 'FORBIDDEN', 'a member of another org cannot send a round');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)),
  '42501', 'FORBIDDEN', 'a waiter limited to L2 cannot send a round at L1');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)),
  '42501', 'FORBIDDEN', 'kitchen has no orders.create / pos.use');
reset role;
set local role anon;
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)),
  '42501', null, 'anon cannot execute the RPC');
reset role;

select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), (pg_temp.line('Cola') || '{"price": 1}')::text, pg_temp.ref(1)) ,
  '22023', 'INVALID_INPUT', 'a client price key is rejected (never accepted)');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola') || '{"organization_id":"x"}'::jsonb), pg_temp.ref(1)),
  '22023', 'INVALID_INPUT', 'an organization id key is rejected');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', '[]'::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), pg_temp.ref(1)), '22023', 'INVALID_INPUT', 'empty lines rejected');
select throws_ok(format($$select public.submit_order_round(%L, null, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)), 'P0001', 'TABLE_NOT_FOUND', 'dine_in needs a table');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), gen_random_uuid(), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(1)), 'P0001', 'TABLE_NOT_FOUND', 'unknown table');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Hidden')), pg_temp.ref(1)),
  'P0001', 'ITEM_UNAVAILABLE', 'an unpublished item is refused');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Pizza')), pg_temp.ref(1)),
  'P0001', 'VARIANT_REQUIRED', 'a variant is required when the item has variants');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Steak')), pg_temp.ref(1)),
  'P0001', 'MODIFIER_INVALID', 'min_select of a modifier group is enforced');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Burger', 1, array['Rare'])), pg_temp.ref(1)),
  'P0001', 'MODIFIER_INVALID', 'a modifier of another item is refused');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'),
  jsonb_build_array(pg_temp.line('Cola'), pg_temp.line('Hidden')), pg_temp.ref(1)),
  'P0001', 'ITEM_UNAVAILABLE', 'one bad line rejects the whole round');
reset role;
select is(pg_temp.cnt('select count(*) from public.orders') + pg_temp.cnt('select count(*) from public.order_rounds')
          + pg_temp.cnt('select count(*) from public.order_items'), 0, 'all-or-nothing: failed rounds left no order, round or item');
select is((select status from public.tables where label = 'T1' and organization_id = pg_temp.org('ord-a')), 'available', 'a failed round does not seat the table');

-- ---- first round: recompute, tickets per station, numbering ---------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res values ('r1', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), 'dine_in',
  jsonb_build_array(pg_temp.line('Burger', 2, array['Cheese'], null, 'no onion'), pg_temp.line('Cola')), pg_temp.ref(10), 'Ayu', 3));
reset role;
select is((select (j ->> 'subtotal')::bigint from pg_temp.res where k = 'r1'), 120000::bigint,
  'subtotal recomputed server-side: (50000 + 5000) x 2 + 10000');
select is((select (j ->> 'orderNumber')::int from pg_temp.res where k = 'r1'), 1, 'first order of the day is number 1');
select is((select jsonb_array_length(j -> 'ticketIds') from pg_temp.res where k = 'r1'), 1, 'one ticket (the Grill); Cola is station-less and skips the KDS');
select is((select count(*)::int from public.kitchen_ticket_items), 1, 'only the Burger line is on a ticket');
select is((select modifiers_text || '|' || note from public.kitchen_ticket_items), 'Cheese|no onion', 'ticket item carries modifier text and note');
select is((select string_agg(item_name || ':' || unit_price || ':' || modifiers_total || ':' || line_total || ':' || tax_rate_bps, ',' order by item_name)
           from public.order_items), 'Burger:50000:5000:110000:1000,Cola:10000:0:10000:1000', 'items snapshot name, prices and the location tax rate');
select is(pg_temp.status_of(1), 'accepted', 'order is accepted with a live (new) ticket');
select is((select status from public.tables where label = 'T1' and organization_id = pg_temp.org('ord-a')), 'occupied', 'the first round seats the table');
select is((select business_date from public.orders where order_number = 1), (now() at time zone 'Pacific/Kiritimati')::date,
  'business_date uses the location timezone, not UTC');
select is((select string_agg(event_type || coalesce(':' || to_status, ''), ',' order by id) from public.order_events),
  'order_status_changed:placed,order_status_changed:accepted,table_status_changed:occupied,round_sent',
  'events: placed, accepted, seated, round_sent');

-- ---- idempotency ----------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res values ('r1b', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), 'dine_in',
  jsonb_build_array(pg_temp.line('Burger', 2, array['Cheese'], null, 'no onion'), pg_temp.line('Cola')), pg_temp.ref(10), 'Ayu', 3));
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola', 5)), pg_temp.ref(10)),
  'P0001', 'CLIENT_REF_CONFLICT', 'the same client_ref with a different body is a conflict');
reset role;
select is((select (j ->> 'replayed')::boolean from pg_temp.res where k = 'r1b'), true, 'replay is flagged');
select is((select j ->> 'orderId' from pg_temp.res where k = 'r1b'), (select j ->> 'orderId' from pg_temp.res where k = 'r1'), 'replay returns the same order');
select is((select count(*)::int from public.orders) || '/' || (select count(*)::int from public.order_items), '1/2', 'replay created nothing');

-- ---- RLS: reads and no direct writes --------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*)::int from public.orders), 1, 'kitchen (orders.view) can read orders');
select is((select count(*)::int from public.kitchen_tickets), 1, 'kitchen can read tickets');
select is((select count(*)::int from public.order_events), 0, 'kitchen cannot read the audit trail');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select is((select count(*)::int from public.orders) + (select count(*)::int from public.order_items) + (select count(*)::int from public.kitchen_tickets), 0,
  'org B cannot read org A orders, items or tickets');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is((select count(*)::int from public.orders), 0, 'a waiter limited to L2 cannot read L1 orders');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$update public.orders set subtotal = 1$$, '42501', null, 'no direct UPDATE on orders, even for a manager');
select throws_ok($$delete from public.order_items$$, '42501', null, 'no direct DELETE on order_items');
select throws_ok(format($$insert into public.order_discounts (organization_id, location_id, order_id, amount, reason) values (%L, %L, %L, 1, 'abc')$$,
  pg_temp.org('ord-a'), pg_temp.loc('ord-a', 'L1'), (select id from public.orders limit 1)), '42501', null, 'no direct INSERT on order_discounts');
select throws_ok($$select * from public.order_counters$$, '42501', null, 'order_counters is not readable by clients');
select is((select count(*)::int from public.order_events), 4, 'a manager reads the audit trail');
reset role;

-- ---- creator self-void ----------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.void_order_item(%L, 'wrong item')$$, (select id from public.order_items where item_name = 'Burger')),
  '42501', 'FORBIDDEN', 'a cashier cannot void a waiter''s item');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.void_order_item(%L, 'oops')$$, (select id from public.order_items where item_name = 'Cola')),
  '42501', 'FORBIDDEN', 'station-less items always need orders.void (no self-void)');
select throws_ok(format($$select public.void_order_item(%L, 'x')$$, (select id from public.order_items where item_name = 'Burger')),
  '22023', 'INVALID_INPUT', 'a void needs a reason of at least 3 characters');
reset role;
-- the kitchen starts a second order's ticket so the creator can no longer self-void it
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res values ('r2', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T2'), 'dine_in',
  jsonb_build_array(pg_temp.line('Burger'), pg_temp.line('Cola')), pg_temp.ref(11)));
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.update_kot_status(%L, 'ready')$$, (select j -> 'ticketIds' ->> 0 from pg_temp.res where k = 'r2')),
  'P0001', 'INVALID_TRANSITION', 'a KOT cannot skip new > in_progress');
select is((public.update_kot_status((select (j -> 'ticketIds' ->> 0)::uuid from pg_temp.res where k = 'r2'), 'in_progress')) ->> 'status', 'in_progress', 'kitchen starts the ticket');
reset role;
select is(pg_temp.status_of(2), 'preparing', 'derived: first ticket in_progress moves the order to preparing');
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.void_order_item(%L, 'too late')$$, (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.order_number = 2 and oi.item_name = 'Burger')),
  '42501', 'FORBIDDEN', 'self-void is refused once the ticket is in_progress');
-- the creator voids their own Burger on order 1 while its ticket is still new
select lives_ok(format($$select public.void_order_item(%L, 'customer changed mind')$$, (select id from public.order_items where item_name = 'Burger' limit 1)),
  'the creator can void their own item while its ticket is new');
reset role;
select is((select count(*)::int from public.order_items where status = 'void' and void_reason = 'customer changed mind'), 1, 'void is recorded with reason');
select is((select status from public.kitchen_tickets where order_id = (select id from public.orders where order_number = 1)), 'bumped', 'the emptied ticket is bumped (system)');
select is(pg_temp.status_of(1), 'ready', 'derived: no live tickets left, so the order walks to ready in the same transaction');
select is((select count(*)::int from public.order_events where actor_id is null and event_type = 'order_status_changed' and to_status in ('preparing','ready')
           and order_id = (select id from public.orders where order_number = 1)), 2, 'two system events, no state skipped');
select is((select subtotal from public.orders where order_number = 1), 10000::bigint, 'subtotal drops the voided line');
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.void_order_item(%L, 'again please')$$, (select id from public.order_items where status = 'void' limit 1)),
  'P0001', 'ALREADY_VOID', 'voiding twice is refused');
reset role;

-- ---- add-on round on a ready order, KOT flow, served ----------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res values ('r3', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), 'dine_in',
  jsonb_build_array(pg_temp.line('Burger')), pg_temp.ref(12)));
reset role;
select is((select (j ->> 'roundNo')::int from pg_temp.res where k = 'r3'), 2, 'an add-on round on the open table order is round 2');
select is(pg_temp.status_of(1), 'preparing', 'add-on round moves a ready order back to preparing');
select pg_temp.act_as(pg_temp.uid(5));
select lives_ok(format($$select public.update_kot_status(%L, 'in_progress')$$, (select j -> 'ticketIds' ->> 0 from pg_temp.res where k = 'r3')), 'start');
select lives_ok(format($$select public.update_kot_status(%L, 'ready')$$, (select j -> 'ticketIds' ->> 0 from pg_temp.res where k = 'r3')), 'ready');
select is((public.update_kot_status((select (j -> 'ticketIds' ->> 0)::uuid from pg_temp.res where k = 'r3'), 'ready')) ->> 'status', 'ready', 'setting the current status again is a no-op');
reset role;
select is(pg_temp.status_of(1), 'ready', 'derived: all live tickets ready, so the order is ready');
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.update_kot_status(%L, 'bumped')$$, (select j -> 'ticketIds' ->> 0 from pg_temp.res where k = 'r3')),
  '42501', 'FORBIDDEN', 'a waiter cannot bump tickets');
select throws_ok(format($$select public.set_order_status(%L, 'completed')$$, (select id from public.orders where order_number = 1)),
  'P0001', 'INVALID_TRANSITION', 'completed is not a manual transition');
select is((public.set_order_status((select id from public.orders where order_number = 1), 'served')) ->> 'status', 'served', 'a waiter marks the order served');
select throws_ok(format($$select public.submit_order_round(%L, %L, 'dine_in', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(13)),
  'P0001', 'ORDER_CLOSED', 'no new round on a served order');
reset role;

-- ---- discounts ------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.apply_order_discount(%L, 1000, 'staff meal')$$, (select id from public.orders where order_number = 2)),
  '42501', 'FORBIDDEN', 'a cashier has no pos.discount');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
insert into pg_temp.res values ('d1', public.apply_order_discount((select id from public.orders where order_number = 2), 20000, 'loyal guest'));
select throws_ok(format($$select public.apply_order_discount(%L, 40001, 'too much')$$, (select id from public.orders where order_number = 2)),
  'P0001', 'DISCOUNT_EXCEEDS_SUBTOTAL', 'discounts cannot exceed the subtotal');
select throws_ok(format($$select public.void_order_item(%L, 'manager void')$$, (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.order_number = 2 and oi.item_name = 'Burger')),
  'P0001', 'DISCOUNT_EXCEEDS_SUBTOTAL', 'a void that would leave the discount above the subtotal is refused until the discount is removed');
select is((public.remove_order_discount((select (j ->> 'discountId')::uuid from pg_temp.res where k = 'd1'), 'applied by mistake')) ->> 'discountTotal', '0', 'removing a discount recomputes the total');
select throws_ok(format($$select public.remove_order_discount(%L, 'again')$$, (select (j ->> 'discountId')::uuid from pg_temp.res where k = 'd1')),
  'P0001', 'ALREADY_REMOVED', 'a discount is removed once');
select lives_ok(format($$select public.void_order_item(%L, 'manager void')$$, (select oi.id from public.order_items oi join public.orders o on o.id = oi.order_id where o.order_number = 2 and oi.item_name = 'Burger')),
  'orders.void can void after the kitchen started');
reset role;
select is((select count(*)::int from public.audit_logs where action in ('order.discount_applied', 'order.discount_removed', 'order.item_voided')), 4, 'discounts and voids are audit-logged');

-- ---- cancel, table clean, takeaway, numbering -----------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res values ('r4', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), pg_temp.tbl('T3'), 'dine_in',
  jsonb_build_array(pg_temp.line('Burger')), pg_temp.ref(14)));
select throws_ok(format($$select public.cancel_order(%L, 'guest left')$$, (j ->> 'orderId')) , '42501', 'FORBIDDEN', 'a waiter cannot cancel an order') from pg_temp.res where k = 'r4';
select throws_ok(format($$select public.mark_table_clean(%L)$$, pg_temp.tbl('T3')), 'P0001', 'INVALID_TRANSITION', 'only a table that needs cleaning can be cleaned');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$select public.cancel_order(%L, 'guest left')$$, (select j ->> 'orderId' from pg_temp.res where k = 'r4')), 'a manager cancels an order');
select throws_ok(format($$select public.cancel_order(%L, 'again')$$, (select j ->> 'orderId' from pg_temp.res where k = 'r4')), 'P0001', 'ORDER_CLOSED', 'a cancelled order is closed');
select throws_ok(format($$select public.cancel_order(%L, 'too late')$$, (select id from public.orders where order_number = 1)), 'P0001', 'ORDER_CLOSED', 'a served order cannot be cancelled');
reset role;
select is((select status from public.tables where label = 'T3' and organization_id = pg_temp.org('ord-a')), 'needs_cleaning', 'cancel frees the table: occupied > needs_cleaning');
select is((select status || '/' || subtotal from public.orders where id = (select (j ->> 'orderId')::uuid from pg_temp.res where k = 'r4')), 'cancelled/0', 'cancelled order is zeroed');
select pg_temp.act_as(pg_temp.uid(4));
select is((public.mark_table_clean(pg_temp.tbl('T3'))) ->> 'status', 'available', 'a waiter marks the table clean');
insert into pg_temp.res values ('r5', public.submit_order_round(pg_temp.loc('ord-a', 'L1'), null, 'takeaway',
  jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(15)));
reset role;
select is((select (j ->> 'orderNumber')::int from pg_temp.res where k = 'r5'), 4, 'order numbers are gapless within the day');
select is(pg_temp.status_of(4), 'ready', 'a takeaway of station-less items goes accepted > preparing > ready at once');
select is(private.next_counter(pg_temp.loc('ord-a', 'L1'), (now() at time zone 'Pacific/Kiritimati')::date + 1, 'order'), 1, 'numbers restart on a new business date');

-- ---- plan limit -----------------------------------------------------------------------------------------------------
update public.packages set limits = '{"max_orders_per_month":1}' where code = 't-ord';
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.submit_order_round(%L, null, 'takeaway', %L::jsonb, %L)$$,
  pg_temp.loc('ord-a', 'L1'), jsonb_build_array(pg_temp.line('Cola')), pg_temp.ref(16)),
  'P0001', 'PLAN_LIMIT:max_orders_per_month', 'the monthly order limit is enforced when a new order opens');
reset role;

-- ---- Realtime -------------------------------------------------------------------------------------------------------
select ok(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L1')) is not null, 'topic check runs');
select pg_temp.act_as(pg_temp.uid(4));
select is(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L1')), true, 'a waiter of L1 may join location:{L1}');
select is(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L1') || 'x'), false, 'a malformed topic is refused');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select is(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L1')), false, 'a member of org B cannot join location:{A}');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L1')), false, 'a staff member limited to L2 cannot join location:{L1}');
select is(public.can_receive_location_topic('location:' || pg_temp.loc('ord-a', 'L2')), true, 'but can join location:{L2}');
reset role;
select ok(not has_function_privilege('anon', 'public.can_receive_location_topic(text)', 'execute'), 'anon cannot call the topic check');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'orders_location_receive'),
  'realtime.messages has the private-channel receive policy');
select ok(not has_function_privilege('anon', 'public.void_order_item(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.update_kot_status(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.cancel_order(uuid, text)', 'execute'), 'anon cannot execute the order RPCs');

select * from finish();
rollback;
