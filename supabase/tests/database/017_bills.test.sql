-- MSC-T07: bills implementation. Golden vectors (SQL mirror of lib/money.ts), permissions, create_bills (none / equal /
-- by_item), the order lock, payments (cap, cash session, idempotency), derived status, completion in both orders of
-- events, refunds, cash sessions, printing, Realtime topic rules, waiter limits, isolation.
-- Contract: docs/contracts/bills.md. REYKI's isolation suite (MSC-T08) is separate.
begin;
select plan(154);

insert into public.packages (code, name, limits) values ('t-bill', 'Bills', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'b' || n || '@b.test', now(), now(), now()
from generate_series(1, 7) n;

create table pg_temp.res (k text primary key, j jsonb);
grant all on pg_temp.res to authenticated;
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000b' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org('bill-a') and name = n $$;
create function pg_temp.tbl(l text) returns uuid language sql security definer as $$ select id from public.tables where label = l and organization_id = pg_temp.org('bill-a') $$;
create function pg_temp.itm(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n and organization_id = pg_temp.org('bill-a') $$;
create function pg_temp.mod(n text) returns uuid language sql security definer as $$ select id from public.modifiers where name = n and organization_id = pg_temp.org('bill-a') $$;
create function pg_temp.ref(n int) returns uuid language sql as $$ select ('00000000-0000-4000-8000-00000000e' || lpad(n::text, 3, '0'))::uuid $$;
create function pg_temp.line(item text, qty int default 1, mods text[] default '{}') returns jsonb language sql as $$
  select jsonb_build_object('item_id', pg_temp.itm(item), 'quantity', qty,
    'modifier_ids', coalesce((select jsonb_agg(pg_temp.mod(m)) from unnest(mods) m), '[]'::jsonb)) $$;
create function pg_temp.order_of(t text) returns uuid language sql security definer as $$
  select id from public.orders where table_id = pg_temp.tbl(t) order by created_at desc limit 1 $$;
create function pg_temp.ostatus(t text) returns text language sql security definer as $$ select status from public.orders where id = pg_temp.order_of(t) $$;
create function pg_temp.tstatus(t text) returns text language sql security definer as $$ select status from public.tables where id = pg_temp.tbl(t) $$;
create function pg_temp.oitem(o uuid, nm text) returns uuid language sql security definer as $$
  select id from public.order_items where order_id = o and item_name = nm and status = 'active' $$;
create function pg_temp.billid(setkey text, n int) returns uuid language sql security definer as $$
  select (b.value ->> 'id')::uuid from pg_temp.res r, jsonb_array_elements(r.j -> 'bills') b
  where r.k = setkey and (b.value ->> 'shareNo')::int = n $$;
create function pg_temp.setid(setkey text) returns uuid language sql as $$ select (j ->> 'billSetId')::uuid from pg_temp.res where k = setkey $$;
create function pg_temp.payid(k2 text) returns uuid language sql as $$ select (j ->> 'paymentId')::uuid from pg_temp.res where k = k2 $$;
create function pg_temp.cnt(q text) returns int language plpgsql security definer as $$
declare n int; begin execute q into n; return n; end $$;

-- ---- permission seeds -------------------------------------------------------------------------------------------------
select ok(exists (select 1 from public.permissions where key = 'bills.print'), 'bills.print exists');
select is((select string_agg(role_key, ',' order by role_key) from public.default_role_permissions where permission_key = 'bills.print'),
  'cashier,manager,waiter', 'bills.print is a default for manager, cashier and waiter (not kitchen)');

-- ---- golden vectors: SQL mirror of lib/money.ts ----------------------------------------------------------------------
select is((select row(service_charge, tax, total)::text from private.calculate_bill(145500, 500, 1000, true)),
  '(7275,15278,168053)', 'calculateBill: net 145.500, service 5%, PB1 10% on net+service = 168.053');
select is((select row(service_charge, tax, total)::text from private.calculate_bill(145500, 500, 1000, false)),
  '(7275,14550,167325)', 'calculateBill: tax on net only when the location says so');
select is(private.allocate(168053, 3), array[56018, 56018, 56017]::bigint[], 'allocate: 168.053 / 3 = 56.018 / 56.018 / 56.017');
select is(private.allocate_by_weights(10500, array[70000, 86000]::bigint[]), array[4712, 5788]::bigint[], 'allocateByWeights: 10.500 by 70.000 / 86.000 = 4.712 / 5.788');
select is(private.allocate_by_weights(10, array[1, 1, 1]::bigint[]), array[4, 3, 3]::bigint[], 'allocateByWeights: ties go to the lower index');
select is(private.allocate_by_weights(7, array[0, 0]::bigint[]), array[4, 3]::bigint[], 'allocateByWeights: all-zero weights fall back to equal shares');
select is((select row(service_charge, tax, total)::text from private.calculate_bill(65288, 500, 1000, true)), '(3264,6855,75407)', 'by-item bill A = 75.407');
select is((select row(service_charge, tax, total)::text from private.calculate_bill(80212, 500, 1000, true)), '(4011,8422,92645)', 'by-item bill B = 92.645');

-- equal split property: every component >= 0, each sums exactly, discount_i <= subtotal_i, share spread <= 3
-- (includes tax 0%, service 0% and service-only locations)
select is((
  select count(*) from (
    select g.sub, g.disc, g.n, g.total,
           min(g.a_sub) a_min, bool_or(g.a_disc > g.a_sub) disc_over, min(g.a_disc) d_min, min(g.a_sc) sc_min, min(g.a_tax) tx_min,
           min(g.a_sub - g.a_disc + g.a_sc + g.a_tax) tot_min, max(g.a_sub - g.a_disc + g.a_sc + g.a_tax) tot_max,
           sum(g.a_sub - g.a_disc + g.a_sc + g.a_tax) tot_sum
    from (
      select c.*, i, (private.allocate(c.sub, c.n))[i] a_sub, (private.allocate(c.disc, c.n))[i] a_disc,
             (private.allocate(c.svc, c.n))[i] a_sc, (private.allocate(c.tax, c.n))[i] a_tax
      from (
        select distinct s.sub::bigint sub, d.disc::bigint disc, n.n, cb.service_charge svc, cb.tax tax, cb.total, sc.bps, t.bps tbps, tos.v
        from generate_series(1, 260, 7) s(sub)
        cross join lateral (values (0), (s.sub / 3), (s.sub)) d(disc)
        cross join (values (0), (500), (1000)) sc(bps) cross join (values (0), (1000)) t(bps)
        cross join (values (true), (false)) tos(v) cross join (values (2), (3), (4), (7), (20)) n(n)
        cross join lateral private.calculate_bill((s.sub - d.disc)::bigint, sc.bps, t.bps, tos.v) cb
      ) c, lateral generate_series(1, c.n) i
    ) g
    group by g.sub, g.disc, g.n, g.total, g.svc, g.tax, g.bps, g.tbps, g.v
  ) z
  where z.a_min < 0 or z.d_min < 0 or z.sc_min < 0 or z.tx_min < 0 or z.disc_over or z.tot_min < 0
     or z.tot_max - z.tot_min > 3 or z.tot_sum <> z.total), 0::bigint,
  'equal split property: components >= 0, exact sums, spread <= 3 over a generated range (tax 0 / service 0 / service-only included)');
select is(array(select (private.allocate(5, 2))[i] - (private.allocate(0, 2))[i] + (private.allocate(1, 2))[i] + (private.allocate(0, 2))[i]
                from generate_series(1, 2) i order by i), array[4, 2]::bigint[],
  'service-only equal split (subtotal 5, service 1, tax 0, n=2): shares 4 / 2');

-- ---- fixtures ---------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org Bill A', 'bill-a', '{"name":"L1"}'::jsonb, null, 't-bill');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select public.create_organization('Org Bill B', 'bill-b', '{"name":"B1"}'::jsonb, null, 't-bill');
reset role;
insert into public.locations (organization_id, name) values (pg_temp.org('bill-a'), 'L2');
update public.locations set service_charge_bps = 500, tax_rate_bps = 1000, tax_on_service_charge = true where id = pg_temp.loc('L1');

-- u1 owner, u2 manager, u3 cashier, u4 waiter, u5 kitchen, u6 cashier scoped to L2, u7 owner of org B
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('bill-a'), pg_temp.uid(2), pg_temp.role('bill-a', 'manager'), true),
  (pg_temp.org('bill-a'), pg_temp.uid(3), pg_temp.role('bill-a', 'cashier'), true),
  (pg_temp.org('bill-a'), pg_temp.uid(4), pg_temp.role('bill-a', 'waiter'),  true),
  (pg_temp.org('bill-a'), pg_temp.uid(5), pg_temp.role('bill-a', 'kitchen'), true),
  (pg_temp.org('bill-a'), pg_temp.uid(6), pg_temp.role('bill-a', 'cashier'), false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('L2'), m.organization_id from public.organization_members m where m.user_id = pg_temp.uid(6);

insert into public.menu_categories (organization_id, name) values (pg_temp.org('bill-a'), 'Mains');
insert into public.menu_items (organization_id, category_id, name, base_price, is_published)
select pg_temp.org('bill-a'), c.id, x.n, x.p, true
from public.menu_categories c, (values ('Nasi Goreng', 35000), ('Es Teh', 8000), ('Sate Ayam', 45000), ('Kopi', 12000), ('Cola', 10000)) x(n, p)
where c.name = 'Mains' and c.organization_id = pg_temp.org('bill-a');
insert into public.modifier_groups (organization_id, name, min_select, max_select) values (pg_temp.org('bill-a'), 'Extras', 0, 2);
insert into public.modifiers (organization_id, group_id, name, price_delta)
select pg_temp.org('bill-a'), g.id, 'Keju', 5000 from public.modifier_groups g where g.name = 'Extras' and g.organization_id = pg_temp.org('bill-a');
insert into public.menu_item_modifier_groups (organization_id, item_id, group_id)
select pg_temp.org('bill-a'), pg_temp.itm('Sate Ayam'), g.id from public.modifier_groups g where g.name = 'Extras' and g.organization_id = pg_temp.org('bill-a');
insert into public.areas (organization_id, location_id, name) values (pg_temp.org('bill-a'), pg_temp.loc('L1'), 'Hall');
insert into public.tables (organization_id, location_id, area_id, label, capacity)
select pg_temp.org('bill-a'), pg_temp.loc('L1'), a.id, x.l, 4 from public.areas a, (values ('T1'), ('T2'), ('T3'), ('T4'), ('T5')) x(l)
where a.name = 'Hall' and a.organization_id = pg_temp.org('bill-a');

create function pg_temp.round(t text, lines jsonb, r int) returns jsonb language sql as $$
  select public.submit_order_round(pg_temp.loc('L1'), pg_temp.tbl(t), 'dine_in', lines, pg_temp.ref(r)) $$;
create function pg_temp.pay(b uuid, m text, a bigint, r int, tend bigint default null, lbl text default null, appr text default null)
returns jsonb language sql as $$
  select public.record_payment(bill_id := b, method := m, amount := a, client_ref := pg_temp.ref(r),
                               tendered := tend, method_label := lbl, approval_code := appr) $$;

-- ---- order A on T1: Nasi Goreng 2, Es Teh 3, Sate Ayam + Keju, Kopi = 156.000; discount 10.500 ---------------------------
select pg_temp.act_as(pg_temp.uid(4));
select is(pg_temp.round('T1', jsonb_build_array(pg_temp.line('Nasi Goreng', 2), pg_temp.line('Es Teh', 3),
  pg_temp.line('Sate Ayam', 1, array['Keju']), pg_temp.line('Kopi', 1)), 1) ->> 'subtotal', '156000', 'order A subtotal 156.000');
reset role;
select is(pg_temp.ostatus('T1'), 'ready', 'order A is ready (all items station-less)');
select pg_temp.act_as(pg_temp.uid(2));
select is(public.apply_order_discount(pg_temp.order_of('T1'), 10500, 'promo') ->> 'discountTotal', '10500', 'manager applies a 10.500 discount');
reset role;

-- ---- non-billable orders ------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.create_bills(%L, %L)$$, gen_random_uuid(), pg_temp.ref(900)), '42501', 'FORBIDDEN', 'unknown order id looks like a missing permission');
reset role;

-- ---- create_bills: none -------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res select 'none', public.create_bills(pg_temp.order_of('T1'), pg_temp.ref(10));
select is((select j ->> 'replayed' from pg_temp.res where k = 'none'), 'false', 'a waiter (bills.print) raises the pre-bill');
select is((select total from public.bills where id = pg_temp.billid('none', 1)), 168053::bigint, 'unsplit bill total = 168.053');
select is((select row(subtotal, discount, service_charge, tax)::text from public.bills where id = pg_temp.billid('none', 1)),
  '(156000,10500,7275,15278)', 'components: subtotal 156.000, discount 10.500, service 7.275, PB1 15.278');
select is((select count(*) from public.bill_items where bill_set_id = pg_temp.setid('none') and bill_id = pg_temp.billid('none', 1)), 4::bigint, 'the 4 order lines are snapshotted onto the bill');
select is((select modifiers_text from public.bill_items where bill_set_id = pg_temp.setid('none') and item_name = 'Sate Ayam'), 'Keju', 'modifier names are snapshotted');
select is(public.create_bills(pg_temp.order_of('T1'), pg_temp.ref(10)) ->> 'replayed', 'true', 'same client_ref and request replays');
select is(public.create_bills(pg_temp.order_of('T1'), pg_temp.ref(10)) -> 'bills' -> 0 ->> 'id', pg_temp.billid('none', 1)::text, 'the replay returns the same bill');
select throws_ok(format($$select public.create_bills(%L, %L, 'equal', 2)$$, pg_temp.order_of('T1'), pg_temp.ref(10)), 'P0001', 'CLIENT_REF_CONFLICT', 'same client_ref with another request is CLIENT_REF_CONFLICT');
select throws_ok(format($$select public.create_bills(%L, %L)$$, pg_temp.order_of('T1'), pg_temp.ref(11)), 'P0001', 'BILL_EXISTS', 'one active set per order');
-- the bill locks the order
select throws_ok(format($$select pg_temp.round('T1', %L::jsonb, 2)$$, jsonb_build_array(pg_temp.line('Cola')), 2), 'P0001', 'BILL_EXISTS', 'an add-on round is refused while a bill is active');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.apply_order_discount(%L, 100, 'more')$$, pg_temp.order_of('T1')), 'P0001', 'BILL_EXISTS', 'a discount cannot be applied while a bill is active');
select throws_ok(format($$select public.remove_order_discount(%L, 'undo')$$, (select id from public.order_discounts where order_id = pg_temp.order_of('T1') limit 1)), 'P0001', 'BILL_EXISTS', 'a discount cannot be removed while a bill is active');
select throws_ok(format($$select public.void_order_item(%L, 'oops')$$, pg_temp.oitem(pg_temp.order_of('T1'), 'Kopi')), 'P0001', 'BILL_EXISTS', 'an item cannot be voided while a bill is active');
reset role;

-- ---- waiter limits (bills.print only) -------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 1000, 800)$$, pg_temp.billid('none', 1)), '42501', 'FORBIDDEN', 'waiter cannot record a payment');
select throws_ok(format($$select public.record_refund(%L, 1000, 'nope', %L)$$, gen_random_uuid(), pg_temp.ref(801)), '42501', 'FORBIDDEN', 'waiter cannot refund');
select throws_ok(format($$select public.open_cash_session(%L, 1000)$$, pg_temp.loc('L1')), '42501', 'FORBIDDEN', 'waiter cannot open a cash session');
select throws_ok(format($$select public.close_cash_session(%L, 1000)$$, gen_random_uuid()), '42501', 'FORBIDDEN', 'waiter cannot close a cash session');
select throws_ok(format($$select public.void_bill_set(%L, 'no way')$$, pg_temp.setid('none')), '42501', 'FORBIDDEN', 'waiter cannot void a bill set');
select ok((select count(*) from public.bills) > 0 and (select count(*) from public.bill_sets) > 0 and (select count(*) from public.bill_items) > 0, 'waiter reads bills, sets and lines');
select is((select count(*) from public.payments), 0::bigint, 'waiter reads no payments');
select is((select count(*) from public.refunds), 0::bigint, 'waiter reads no refunds');
select is((select count(*) from public.cash_sessions), 0::bigint, 'waiter reads no cash sessions');
select is((select count(*) from public.bill_events), 0::bigint, 'waiter reads no bill events');
select is((select count(*) from public.bill_balances), 0::bigint, 'bill_balances is empty for a bills.print-only user');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*) from public.bills), 0::bigint, 'kitchen reads no bills');
select throws_ok(format($$select public.create_bills(%L, %L)$$, pg_temp.order_of('T1'), pg_temp.ref(802)), '42501', 'FORBIDDEN', 'kitchen cannot create a bill');
reset role;

-- ---- void_bill_set (never paid -> payments.take) -> by_item -------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.void_bill_set(%L, 'x')$$, pg_temp.setid('none')), '22023', 'INVALID_INPUT', 'a void needs a reason of 3+ characters');
select is(public.void_bill_set(pg_temp.setid('none'), 'customer wants to split') ->> 'status', 'void', 'a cashier voids an unpaid set');
select throws_ok(format($$select public.void_bill_set(%L, 'again please')$$, pg_temp.setid('none')), 'P0001', 'BILL_VOID', 'voiding twice is BILL_VOID');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.create_bills(%L, %L, 'by_item', null, %L::jsonb)$$, pg_temp.order_of('T1'), pg_temp.ref(12),
  jsonb_build_array(jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Nasi Goreng')))), 'P0001', 'INVALID_SPLIT', 'by_item needs at least 2 bills');
select throws_ok(format($$select public.create_bills(%L, %L, 'by_item', null, %L::jsonb)$$, pg_temp.order_of('T1'), pg_temp.ref(13),
  jsonb_build_array(jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Nasi Goreng')),
                    jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Es Teh')))), 'P0001', 'INVALID_SPLIT', 'by_item must cover every active line');
select throws_ok(format($$select public.create_bills(%L, %L, 'by_item', null, %L::jsonb)$$, pg_temp.order_of('T1'), pg_temp.ref(14),
  jsonb_build_array(jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Nasi Goreng'), pg_temp.oitem(pg_temp.order_of('T1'), 'Es Teh')),
                    jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Es Teh'), pg_temp.oitem(pg_temp.order_of('T1'), 'Sate Ayam'), pg_temp.oitem(pg_temp.order_of('T1'), 'Kopi')))),
  'P0001', 'INVALID_SPLIT', 'by_item rejects a line that appears twice');
select throws_ok(format($$select public.create_bills(%L, %L, 'by_item', null, %L::jsonb)$$, pg_temp.order_of('T1'), pg_temp.ref(15),
  jsonb_build_array(jsonb_build_array(gen_random_uuid()), jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Nasi Goreng')))),
  'P0001', 'INVALID_SPLIT', 'by_item rejects a foreign or unknown line id');
select throws_ok(format($$select public.create_bills(%L, %L, 'equal', 1)$$, pg_temp.order_of('T1'), pg_temp.ref(16)), 'P0001', 'INVALID_SPLIT', 'equal needs 2..20 shares');
select throws_ok(format($$select public.create_bills(%L, %L, 'equal', 21)$$, pg_temp.order_of('T1'), pg_temp.ref(17)), 'P0001', 'INVALID_SPLIT', 'equal allows at most 20 shares');
insert into pg_temp.res select 'byitem', public.create_bills(pg_temp.order_of('T1'), pg_temp.ref(18), 'by_item', null,
  jsonb_build_array(jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Nasi Goreng')),
                    jsonb_build_array(pg_temp.oitem(pg_temp.order_of('T1'), 'Es Teh'), pg_temp.oitem(pg_temp.order_of('T1'), 'Sate Ayam'), pg_temp.oitem(pg_temp.order_of('T1'), 'Kopi'))));
select is((select array_agg(total order by share_no) from public.bills where bill_set_id = pg_temp.setid('byitem')), array[75407, 92645]::bigint[], 'by-item bills: 75.407 and 92.645');
select is((select total from public.bill_sets where id = pg_temp.setid('byitem')), 168052::bigint, 'by-item set total = sum of its bills = 168.052 (documented 1 rupiah drift)');
select is((select array_agg(discount order by share_no) from public.bills where bill_set_id = pg_temp.setid('byitem')), array[4712, 5788]::bigint[], 'the discount is spread by weight: 4.712 / 5.788');
select is((select count(*) from public.bill_items where bill_set_id = pg_temp.setid('byitem') and bill_id = pg_temp.billid('byitem', 1)), 1::bigint, 'bill A holds the Nasi Goreng line only');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select public.void_bill_set(pg_temp.setid('byitem'), 'split equally instead');
reset role;

-- ---- equal split: 168.053 / 3 ---------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
insert into pg_temp.res select 'equal', public.create_bills(pg_temp.order_of('T1'), pg_temp.ref(19), 'equal', 3);
select is((select array_agg(total order by share_no) from public.bills where bill_set_id = pg_temp.setid('equal')), array[56018, 56018, 56017]::bigint[], '3-way equal split: 56.018 / 56.018 / 56.017');
select is((select sum(total)::bigint from public.bills where bill_set_id = pg_temp.setid('equal')), 168053::bigint, 'the shares sum to the unsplit total exactly');
select is((select array_agg(tax order by share_no) from public.bills where bill_set_id = pg_temp.setid('equal')), array[5093, 5093, 5092]::bigint[], 'taxes 5.093 / 5.093 / 5.092');
select is((select count(*) from public.bill_items where bill_set_id = pg_temp.setid('equal') and bill_id is null), 4::bigint, 'equal split: items belong to the set, not to one bill');
select is((select count(distinct bill_number) from public.bills where bill_set_id = pg_temp.setid('equal')), 3::bigint, 'each share has its own bill number');
-- printing
select is(public.record_bill_print(pg_temp.billid('equal', 1)) ->> 'duplicate', 'false', 'first print is not a duplicate');
select is(public.record_bill_print(pg_temp.billid('equal', 1)) ->> 'duplicate', 'true', 'a reprint is a duplicate');
select is((select print_count from public.bills where id = pg_temp.billid('equal', 1)), 2, 'print_count counts every print');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.record_bill_print(%L)$$, pg_temp.billid('equal', 1)), '42501', 'FORBIDDEN', 'kitchen cannot print a bill');
reset role;

-- ---- payments + cash sessions ---------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select pg_temp.pay(%L, 'cash', 30000, 20, 50000)$$, pg_temp.billid('equal', 1)), 'P0001', 'NO_OPEN_SESSION', 'cash needs an open cash session');
select is(public.open_cash_session(pg_temp.loc('L1'), 500000) ->> 'status', 'open', 'a cashier opens a session with a 500.000 float');
select throws_ok(format($$select public.open_cash_session(%L, 1000)$$, pg_temp.loc('L1')), 'P0001', 'SESSION_ALREADY_OPEN', 'one open session per location');
select throws_ok(format($$select pg_temp.pay(%L, 'cash', 30000, 21, 10000)$$, pg_temp.billid('equal', 1)), 'P0001', 'TENDERED_TOO_LOW', 'tendered below the amount is refused');
select throws_ok(format($$select pg_temp.pay(%L, 'doku', 1000, 22)$$, pg_temp.billid('equal', 1)), 'P0001', 'METHOD_NOT_ALLOWED', 'doku is reserved for M5');
select throws_ok(format($$select pg_temp.pay(%L, 'other', 1000, 23)$$, pg_temp.billid('equal', 1)), '22023', 'INVALID_INPUT', 'other needs a label');
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 1000, 24, null, null, '1234567890123456')$$, pg_temp.billid('equal', 1)), '22023', 'INVALID_INPUT', 'an approval code is 4-12 alphanumerics (never a card number)');
select throws_ok(format($$select pg_temp.pay(%L, 'cash', 0, 25, 1000)$$, pg_temp.billid('equal', 1)), '22023', 'INVALID_INPUT', 'amount must be positive');
insert into pg_temp.res select 'pay_cash', pg_temp.pay(pg_temp.billid('equal', 1), 'cash', 30000, 26, 50000);
select is((select j ->> 'changeGiven' from pg_temp.res where k = 'pay_cash'), '20000', 'partial cash payment: tendered 50.000, change 20.000');
select is((select j ->> 'paymentStatus' from pg_temp.res where k = 'pay_cash'), 'partially_paid', 'status partially_paid');
select is((select j ->> 'outstanding' from pg_temp.res where k = 'pay_cash'), '26018', 'outstanding 26.018');
select is(pg_temp.pay(pg_temp.billid('equal', 1), 'cash', 30000, 26, 50000) ->> 'replayed', 'true', 'the same client_ref replays');
select is((select count(*) from public.payments where bill_id = pg_temp.billid('equal', 1)), 1::bigint, 'the replay created no second payment');
select throws_ok(format($$select pg_temp.pay(%L, 'cash', 29000, 26, 50000)$$, pg_temp.billid('equal', 1)), 'P0001', 'CLIENT_REF_CONFLICT', 'a different body with the same client_ref conflicts');
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 26019, 27)$$, pg_temp.billid('equal', 1)), 'P0001', 'PAYMENT_EXCEEDS_OUTSTANDING', 'a payment above the outstanding amount is refused');
insert into pg_temp.res select 'pay_edc', pg_temp.pay(pg_temp.billid('equal', 1), 'edc_card', 26018, 28, null, null, 'A1B2C3');
select is((select j ->> 'paymentStatus' from pg_temp.res where k = 'pay_edc'), 'paid', 'the card payment completes the share: paid');
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 1, 29)$$, pg_temp.billid('equal', 1)), 'P0001', 'PAYMENT_EXCEEDS_OUTSTANDING', 'a paid bill takes no more payments');
select is((select payment_status from public.bill_balances where bill_id = pg_temp.billid('equal', 1)), 'paid', 'bill_balances derives paid');
select is((select count(*) from public.bill_events where bill_id = pg_temp.billid('equal', 1) and event_type = 'bill_paid'), 0::bigint, 'a cashier reads no bill_events (0 rows)');
-- the other two shares: voucher + card. The order is not served yet, so it must not complete.
select is(pg_temp.pay(pg_temp.billid('equal', 2), 'other', 56018, 30, null, 'Voucher') ->> 'paymentStatus', 'paid', 'share 2 paid with a voucher');
select is(pg_temp.pay(pg_temp.billid('equal', 3), 'edc_card', 56017, 31) ->> 'orderCompleted', 'false', 'all shares paid but not served: the order is not completed yet');
reset role;
select is(pg_temp.ostatus('T1'), 'ready', 'order A is still ready');
select is(pg_temp.tstatus('T1'), 'occupied', 'table T1 is still occupied');
select pg_temp.act_as(pg_temp.uid(4));
select is(public.set_order_status(pg_temp.order_of('T1'), 'served') ->> 'status', 'completed', 'serving a fully paid order completes it (paid first, served last)');
reset role;
select is(pg_temp.ostatus('T1'), 'completed', 'order A is completed');
select is(pg_temp.tstatus('T1'), 'needs_cleaning', 'table T1 moves to needs_cleaning in the same transaction');
select is((select count(*) from public.order_events where order_id = pg_temp.order_of('T1') and event_type = 'order_status_changed' and to_status = 'completed' and actor_id is null), 1::bigint, 'one system completion event');

-- ---- refunds -------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.record_refund(%L, 1000, 'wrong order', %L)$$, pg_temp.payid('pay_edc'), pg_temp.ref(40)), '42501', 'FORBIDDEN', 'a cashier cannot refund');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.record_refund(%L, 1000, 'x', %L)$$, pg_temp.payid('pay_edc'), pg_temp.ref(41)), '22023', 'INVALID_INPUT', 'a refund needs a reason of 3+ characters');
select is(public.record_refund(pg_temp.payid('pay_edc'), 10000, 'Wrong order', pg_temp.ref(42)) ->> 'paymentStatus', 'partially_refunded', 'refunding 10.000 of the card payment: partially_refunded');
select is(public.record_refund(pg_temp.payid('pay_edc'), 10000, 'Wrong order', pg_temp.ref(42)) ->> 'replayed', 'true', 'a refund replays on the same client_ref');
select throws_ok(format($$select public.record_refund(%L, 16019, 'too much', %L)$$, pg_temp.payid('pay_edc'), pg_temp.ref(43)), 'P0001', 'REFUND_EXCEEDS_PAID', 'refunds cannot exceed the payment (26.018 - 10.000 = 16.018 left)');
select is((select outstanding from public.bill_balances where bill_id = pg_temp.billid('equal', 1)), 0::bigint, 'a refund never re-opens a bill: outstanding stays 0');
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 1, 44)$$, pg_temp.billid('equal', 1)), 'P0001', 'PAYMENT_EXCEEDS_OUTSTANDING', 'no further payment after a refund');
select is(public.record_refund(pg_temp.payid('pay_cash'), 5000, 'Cash back', pg_temp.ref(45)) ->> 'paymentStatus', 'partially_refunded', 'a cash refund while a session is open');
select ok((select count(*) from public.bill_events) > 5, 'a manager reads bill_events');
reset role;
select is((select count(*) from public.audit_logs where action = 'refund.recorded' and organization_id = pg_temp.org('bill-a')), 2::bigint, 'refunds are audited');
select is(pg_temp.ostatus('T1'), 'completed', 'a refund does not un-complete the order');

-- ---- close the session ---------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.close_cash_session(%L, 524000)$$, (select id from public.cash_sessions where status = 'open' and location_id = pg_temp.loc('L1'))), '22023', 'INVALID_INPUT', 'a variance needs a note');
insert into pg_temp.res select 'close', public.close_cash_session((select id from public.cash_sessions where status = 'open' and location_id = pg_temp.loc('L1')), 524000, 'short 1k');
select is((select j ->> 'expectedCash' from pg_temp.res where k = 'close'), '525000', 'expected = float 500.000 + cash 30.000 - cash refund 5.000 (change is not counted)');
select is((select j ->> 'variance' from pg_temp.res where k = 'close'), '-1000', 'variance = counted - expected = -1.000');
select is(public.close_cash_session((select id from public.cash_sessions where location_id = pg_temp.loc('L1') order by opened_at limit 1), 524000, 'short 1k') ->> 'replayed', 'true', 'closing again with the same figures is idempotent');
select throws_ok(format($$select public.close_cash_session(%L, 1)$$, (select id from public.cash_sessions where location_id = pg_temp.loc('L1') order by opened_at limit 1)), 'P0001', 'SESSION_CLOSED', 'closing with other figures is SESSION_CLOSED');
reset role;
select is((select count(*) from public.audit_logs where action = 'cash_session.variance'), 1::bigint, 'a non-zero variance is audited');
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.record_refund(%L, 1000, 'late cash', %L)$$, pg_temp.payid('pay_cash'), pg_temp.ref(46)), 'P0001', 'NO_OPEN_SESSION', 'a cash refund needs an open session');
reset role;

-- ---- order B (T2): served first, paid last --------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select pg_temp.round('T2', jsonb_build_array(pg_temp.line('Cola')), 50);
select public.set_order_status(pg_temp.order_of('T2'), 'served');
reset role;
select is(pg_temp.ostatus('T2'), 'served', 'order B served, unpaid: stays served');
select pg_temp.act_as(pg_temp.uid(3));
select public.open_cash_session(pg_temp.loc('L1'), 100000);
insert into pg_temp.res select 'b_set', public.create_bills(pg_temp.order_of('T2'), pg_temp.ref(51));
select is((select total from public.bills where id = pg_temp.billid('b_set', 1)), 11550::bigint, 'Cola 10.000 + service 500 + PB1 1.050 = 11.550');
select is(pg_temp.pay(pg_temp.billid('b_set', 1), 'cash', 11550, 52, 20000) ->> 'orderCompleted', 'true', 'paying the last bill of a served order completes it (served first, paid last)');
reset role;
select is(pg_temp.ostatus('T2'), 'completed', 'order B completed');
select is(pg_temp.tstatus('T2'), 'needs_cleaning', 'table T2 needs cleaning');

-- ---- order C (T3): money held blocks void / cancel until refunded ---------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select pg_temp.round('T3', jsonb_build_array(pg_temp.line('Cola')), 60);
reset role;
select pg_temp.act_as(pg_temp.uid(3));
insert into pg_temp.res select 'c_set', public.create_bills(pg_temp.order_of('T3'), pg_temp.ref(61));
insert into pg_temp.res select 'c_pay', pg_temp.pay(pg_temp.billid('c_set', 1), 'cash', 5000, 62, 5000);
select throws_ok(format($$select public.void_bill_set(%L, 'cancel it')$$, pg_temp.setid('c_set')), '42501', 'FORBIDDEN', 'a set with payment history needs payments.refund to void');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.void_bill_set(%L, 'cancel it')$$, pg_temp.setid('c_set')), 'P0001', 'BILL_HAS_PAYMENTS', 'a set that holds money cannot be voided');
select throws_ok(format($$select public.cancel_order(%L, 'guest left')$$, pg_temp.order_of('T3')), 'P0001', 'BILL_HAS_PAYMENTS', 'cancel_order is refused while money is held');
select public.record_refund(pg_temp.payid('c_pay'), 5000, 'guest left', pg_temp.ref(63));
select is(public.void_bill_set(pg_temp.setid('c_set'), 'refunded in full') ->> 'status', 'void', 'after refunding in full, a manager voids the set');
select is(public.cancel_order(pg_temp.order_of('T3'), 'guest left') ->> 'orderId', pg_temp.order_of('T3')::text, 'and the order can be cancelled');
reset role;
select is(pg_temp.ostatus('T3'), 'cancelled', 'order C cancelled');
select is(pg_temp.tstatus('T3'), 'needs_cleaning', 'table T3 needs cleaning');

-- ---- order D (T4): a 100% discount is a zero bill, already paid ---------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select pg_temp.round('T4', jsonb_build_array(pg_temp.line('Cola')), 70);
select public.set_order_status(pg_temp.order_of('T4'), 'served');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select public.apply_order_discount(pg_temp.order_of('T4'), 10000, 'staff meal');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
insert into pg_temp.res select 'd_set', public.create_bills(pg_temp.order_of('T4'), pg_temp.ref(71));
select is((select total from public.bills where id = pg_temp.billid('d_set', 1)), 0::bigint, 'a fully discounted bill totals 0');
reset role;
select is(pg_temp.ostatus('T4'), 'completed', 'a zero-total bill completes a served order at once');

-- ---- order E (T5): cancel voids an unpaid set ---------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(4));
select pg_temp.round('T5', jsonb_build_array(pg_temp.line('Cola')), 80);
insert into pg_temp.res select 'e_set', public.create_bills(pg_temp.order_of('T5'), pg_temp.ref(81));
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select public.cancel_order(pg_temp.order_of('T5'), 'guest left');
reset role;
select is((select status from public.bill_sets where id = pg_temp.setid('e_set')), 'void', 'cancel_order voided the unpaid set');
select is(pg_temp.ostatus('T5'), 'cancelled', 'order E cancelled');

-- ---- Realtime topic rules: exact matching -------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select ok(public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'a cashier (payments.view) may join the payments topic');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text), 'the payments policy refuses the bare orders topic');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments:x'), 'location:{A}:payments:x is refused');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || 'x'), 'location:{A}x is refused');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':'), 'a trailing colon is refused');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':PAYMENTS'), 'an uppercase suffix is refused');
select ok(not public.can_receive_payments_topic('location:' || upper(pg_temp.loc('L1')::text) || ':payments'), 'an uppercase uuid is refused');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments' || chr(10)), 'a trailing newline is refused');
select ok(not public.can_receive_payments_topic(null), 'null is refused');
select ok(not public.can_receive_location_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'the orders policy refuses the payments topic');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select ok(public.can_receive_location_topic('location:' || pg_temp.loc('L1')::text), 'kitchen joins the orders topic');
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'kitchen cannot join the payments topic');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'a waiter (bills.print only) does not subscribe to payment signals');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'a cashier scoped to L2 cannot join L1''s payments topic');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select ok(not public.can_receive_payments_topic('location:' || pg_temp.loc('L1')::text || ':payments'), 'a member of org B cannot join org A''s payments topic');
reset role;

-- ---- isolation + hygiene ---------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(7));
select is((select count(*) from public.bills), 0::bigint, 'org B reads no bills of org A');
select is((select count(*) from public.payments), 0::bigint, 'org B reads no payments of org A');
select throws_ok(format($$select public.create_bills(%L, %L)$$, pg_temp.order_of('T1'), pg_temp.ref(900)), '42501', 'FORBIDDEN', 'org B cannot bill an order of org A');
select throws_ok(format($$select public.record_bill_print(%L)$$, pg_temp.billid('equal', 1)), '42501', 'FORBIDDEN', 'org B cannot print a bill of org A');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is((select count(*) from public.bills), 0::bigint, 'a cashier scoped to L2 reads no L1 bills');
select throws_ok(format($$select pg_temp.pay(%L, 'edc_card', 1, 901)$$, pg_temp.billid('equal', 1)), '42501', 'FORBIDDEN', 'and cannot take a payment at L1');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok($$insert into public.payments (organization_id, location_id, bill_id, method, amount, client_ref, request_hash) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'edc_card', 1, gen_random_uuid(), 'x')$$, '42501', null, 'authenticated cannot insert payments directly');
select throws_ok($$update public.bills set total = 1$$, '42501', null, 'authenticated cannot update bills directly');
reset role;
set local role anon;
select throws_ok($$select public.record_bill_print(gen_random_uuid())$$, '42501', null, 'anon cannot execute the RPCs');
reset role;
select throws_ok(format($$update public.payments set amount = 1 where id = %L$$, pg_temp.payid('pay_cash')), 'P0001', null, 'payments are append-only');
select throws_ok($$update public.refunds set amount = 1$$, 'P0001', null, 'refunds are append-only');
select throws_ok($$update public.bill_events set event_type = 'bill_paid'$$, 'P0001', null, 'bill_events are append-only');
select is((select count(*) from (select location_id, business_date, bill_number from public.bills group by 1, 2, 3 having count(*) > 1) d), 0::bigint, 'bill numbers are unique per location and day');
select is((select count(*) from public.bill_sets where status = 'active' group by order_id having count(*) > 1), null, 'at most one active set per order');

select * from finish();
rollback;
