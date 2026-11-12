-- MVM-T06: menu schema — isolation, permissions, integrity, money types, set_item_sold_out, get_public_menu, audit.
begin;
select plan(135);

insert into public.packages (code, name, limits) values ('t-men', 'Menu limits', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@m.test', now(), now(), now()
from generate_series(1, 7) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(s text, n text) returns uuid language sql security definer as $$
  select id from public.locations where organization_id = pg_temp.org(s) and name = n $$;
create function pg_temp.cat(n text) returns uuid language sql security definer as $$ select id from public.menu_categories where name = n $$;
create function pg_temp.item(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n $$;
create function pg_temp.grp(n text) returns uuid language sql security definer as $$ select id from public.modifier_groups where name = n $$;
create function pg_temp.stn(n text) returns uuid language sql security definer as $$ select id from public.kitchen_stations where name = n $$;
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function pg_temp.audits(a text) returns int language sql security definer as $$
  select count(*)::int from public.audit_logs where action = a $$;

-- Org A (owner u1, L1 Asia/Jakarta, L2 America/Los_Angeles) and Org B (owner u6)
select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Menu A', 'men-a', '{"name":"L1"}'::jsonb, null, 't-men');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select public.create_organization('Menu B', 'men-b', '{"name":"B1"}'::jsonb, null, 't-men');
reset role;
insert into public.locations (organization_id, name, timezone) values (pg_temp.org('men-a'), 'L2', 'America/Los_Angeles');
update public.locations set timezone = 'Asia/Jakarta' where organization_id = pg_temp.org('men-a') and name = 'L1';

-- u2 manager (all), u3 cashier (L1 only), u4 waiter (all), u5 kitchen (all), u7 manager scoped to L2 only
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('men-a'), pg_temp.uid(2), pg_temp.role('men-a', 'manager'), true),
  (pg_temp.org('men-a'), pg_temp.uid(3), pg_temp.role('men-a', 'cashier'), false),
  (pg_temp.org('men-a'), pg_temp.uid(4), pg_temp.role('men-a', 'waiter'),  true),
  (pg_temp.org('men-a'), pg_temp.uid(5), pg_temp.role('men-a', 'kitchen'), true),
  (pg_temp.org('men-a'), pg_temp.uid(7), pg_temp.role('men-a', 'manager'), false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, pg_temp.loc('men-a', case m.user_id when pg_temp.uid(3) then 'L1' else 'L2' end), m.organization_id
from public.organization_members m where m.user_id in (pg_temp.uid(3), pg_temp.uid(7));

-- fixtures (superuser). Names are prefixed Z so they never collide with the seed.
insert into public.menu_categories (organization_id, name, sort_order) values
  (pg_temp.org('men-a'), 'ZCatA', 1), (pg_temp.org('men-a'), 'ZCatEmpty', 2), (pg_temp.org('men-b'), 'ZCatB', 1);
insert into public.menu_items (organization_id, category_id, name, base_price, is_published, sort_order) values
  (pg_temp.org('men-a'), pg_temp.cat('ZCatA'), 'ZItemA1', 10000, true,  1),
  (pg_temp.org('men-a'), pg_temp.cat('ZCatA'), 'ZItemA2', 11000, false, 2),   -- draft
  (pg_temp.org('men-a'), pg_temp.cat('ZCatA'), 'ZItemA3', 5000,  true,  3),   -- sold-out tests
  (pg_temp.org('men-a'), pg_temp.cat('ZCatA'), 'ZItemA4', 6000,  true,  4),   -- switched off at L1
  (pg_temp.org('men-a'), pg_temp.cat('ZCatA'), 'ZItemA5', 7000,  true,  5),   -- inactive
  (pg_temp.org('men-a'), pg_temp.cat('ZCatEmpty'), 'ZItemDraftOnly', 9000, false, 1),
  (pg_temp.org('men-b'), pg_temp.cat('ZCatB'), 'ZItemB1', 20000, true, 1);
update public.menu_items set is_active = false where name = 'ZItemA5';
insert into public.item_variants (organization_id, item_id, name, price_delta) values
  (pg_temp.org('men-a'), pg_temp.item('ZItemA1'), 'ZLarge', 3000), (pg_temp.org('men-b'), pg_temp.item('ZItemB1'), 'ZLargeB', 4000);
insert into public.modifier_groups (organization_id, name, min_select, max_select) values
  (pg_temp.org('men-a'), 'ZGroupA', 0, 2), (pg_temp.org('men-b'), 'ZGroupB', 0, 1);
insert into public.modifiers (organization_id, group_id, name, price_delta) values
  (pg_temp.org('men-a'), pg_temp.grp('ZGroupA'), 'ZMod1', 2000), (pg_temp.org('men-b'), pg_temp.grp('ZGroupB'), 'ZModB', 1000);
insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values
  (pg_temp.org('men-a'), pg_temp.item('ZItemA1'), pg_temp.grp('ZGroupA'));
insert into public.kitchen_stations (organization_id, location_id, name) values
  (pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), 'ZStnL1'), (pg_temp.org('men-a'), pg_temp.loc('men-a', 'L2'), 'ZStnL2'),
  (pg_temp.org('men-b'), pg_temp.loc('men-b', 'B1'), 'ZStnB');
insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override, is_available, kitchen_station_id) values
  (pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA1'), 12000, true, pg_temp.stn('ZStnL1')),
  (pg_temp.org('men-a'), pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA1'), null,  true, null),
  (pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA4'), null,  false, null),
  (pg_temp.org('men-b'), pg_temp.loc('men-b', 'B1'), pg_temp.item('ZItemB1'), null,  true, null);
delete from public.audit_logs;

-- ---- money columns are bigint, never numeric/float ---------------------------------------------------------------
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and column_name in ('base_price', 'price_delta', 'price_override')
             and table_name in ('menu_items', 'item_variants', 'modifiers', 'location_menu_overrides') and data_type = 'bigint'), 4,
  'all four money columns are bigint');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and data_type in ('numeric', 'real', 'double precision')
             and table_name in ('kitchen_stations', 'menu_categories', 'menu_items', 'item_variants', 'modifier_groups',
                                'menu_item_modifier_groups', 'modifiers', 'location_menu_overrides')), 0,
  'no numeric/float columns in the menu tables');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('kitchen_stations', 'menu_categories', 'menu_items', 'item_variants',
             'modifier_groups', 'menu_item_modifier_groups', 'modifiers', 'location_menu_overrides') and c.relrowsecurity), 8,
  'RLS is enabled on all 8 menu tables');

-- ---- reads ----------------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select is((select count(*)::int from public.menu_items where name like 'ZItem%' and organization_id = pg_temp.org('men-a')), 6, 'manager A reads A''s items');
select is((select count(*)::int from public.menu_items where name = 'ZItemB1'), 0, 'manager A cannot read B''s items');
select is((select count(*)::int from public.menu_categories where name = 'ZCatB'), 0, 'manager A cannot read B''s categories');
select is((select count(*)::int from public.item_variants where name = 'ZLargeB'), 0, 'manager A cannot read B''s variants');
select is((select count(*)::int from public.modifier_groups where name = 'ZGroupB'), 0, 'manager A cannot read B''s modifier groups');
select is((select count(*)::int from public.modifiers where name = 'ZModB'), 0, 'manager A cannot read B''s modifiers');
select is((select count(*)::int from public.kitchen_stations where name = 'ZStnB'), 0, 'manager A cannot read B''s stations');
select is((select count(*)::int from public.location_menu_overrides where organization_id = pg_temp.org('men-b')), 0, 'manager A cannot read B''s overrides');
select is((select count(*)::int from public.menu_item_modifier_groups where organization_id = pg_temp.org('men-b')), 0, 'manager A cannot read B''s links');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*)::int from public.menu_items where name like 'ZItem%' and organization_id = pg_temp.org('men-a')), 6, 'kitchen can read the menu');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is((select count(*)::int from public.menu_items where organization_id = pg_temp.org('men-a')), 6, 'cashier can read the menu');
select is((select count(*)::int from public.location_menu_overrides where organization_id = pg_temp.org('men-a')), 2, 'cashier (L1 only) sees only L1 overrides');
select is((select count(*)::int from public.kitchen_stations where organization_id = pg_temp.org('men-a')), 1, 'cashier (L1 only) sees only L1 stations');
reset role;
select pg_temp.act_as(pg_temp.uid(7));
select is((select count(*)::int from public.location_menu_overrides where organization_id = pg_temp.org('men-a')), 1, 'manager scoped to L2 sees only L2 overrides');
reset role;
select pg_temp.act_as(pg_temp.uid(6));
select is((select count(*)::int from public.menu_items where organization_id = pg_temp.org('men-a')), 0, 'owner B cannot read A''s items');
select is((select count(*)::int from public.location_menu_overrides where organization_id = pg_temp.org('men-a')), 0, 'owner B cannot read A''s overrides');
reset role;
set local role anon;
select throws_ok($$select * from public.menu_items$$, '42501', null, 'anon cannot read menu_items directly');
select throws_ok($$select * from public.location_menu_overrides$$, '42501', null, 'anon cannot read overrides directly');
reset role;

-- ---- writes: only menu.manage -----------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$insert into public.menu_categories (organization_id, name) values (%L, 'ZNope')$$, pg_temp.org('men-a')), '42501', null, 'cashier cannot create a category');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, 'ZNope', 1)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '42501', null, 'cashier cannot create an item');
select is(pg_temp.affected($$update public.menu_items set base_price = 1 where name = 'ZItemA1'$$), 0, 'cashier cannot change a price');
select is(pg_temp.affected($$update public.location_menu_overrides set price_override = 1$$), 0, 'cashier cannot change an override price');
select throws_ok(format($$insert into public.kitchen_stations (organization_id, location_id, name) values (%L, %L, 'ZNope')$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1')), '42501', null, 'cashier cannot create a station');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$insert into public.modifier_groups (organization_id, name) values (%L, 'ZNope')$$, pg_temp.org('men-a')), '42501', null, 'waiter cannot create a modifier group');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is(pg_temp.affected($$update public.modifiers set price_delta = 1$$), 0, 'kitchen cannot change a modifier price');
reset role;

-- manager success
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$insert into public.menu_categories (organization_id, name, description) values (%L, 'ZCatNew', 'x')$$, pg_temp.org('men-a')), 'manager creates a category');
select lives_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, dietary_tags) values (%L, %L, 'ZItemNew', 15000, array['halal','spicy'])$$,
  pg_temp.org('men-a'), pg_temp.cat('ZCatNew')), 'manager creates an item');
select lives_ok(format($$insert into public.item_variants (organization_id, item_id, name, price_delta) values (%L, %L, 'ZSmall', -2000)$$, pg_temp.org('men-a'), pg_temp.item('ZItemNew')), 'a variant may have a negative price_delta');
select lives_ok(format($$insert into public.modifier_groups (organization_id, name, min_select, max_select) values (%L, 'ZGroupNew', 0, 3)$$, pg_temp.org('men-a')), 'manager creates a modifier group');
select lives_ok(format($$insert into public.modifiers (organization_id, group_id, name, price_delta) values (%L, %L, 'ZModNew', 3000)$$, pg_temp.org('men-a'), pg_temp.grp('ZGroupNew')), 'manager creates a modifier');
select lives_ok(format($$insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.item('ZItemNew'), pg_temp.grp('ZGroupNew')), 'manager links a group to an item');
select lives_ok(format($$insert into public.kitchen_stations (organization_id, location_id, name) values (%L, %L, 'ZStnNew')$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1')), 'manager creates a station');
select lives_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override, kitchen_station_id) values (%L, %L, %L, 16000, %L)$$,
  pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemNew'), pg_temp.stn('ZStnNew')), 'manager creates an override with a station of the same location');
select lives_ok($$update public.menu_items set base_price = 17000 where name = 'ZItemNew'$$, 'manager changes a price');
select lives_ok($$update public.location_menu_overrides set price_override = 18000 where price_override = 16000$$, 'manager changes an override price');
select lives_ok($$update public.item_variants set price_delta = -1500 where name = 'ZSmall'$$, 'manager changes a variant price');
select lives_ok($$update public.menu_items set is_active = false where name = 'ZItemNew'$$, 'manager deactivates an item');
select lives_ok($$update public.menu_items set is_active = true where name = 'ZItemNew'$$, 'manager reactivates an item');
select lives_ok($$update public.menu_items set name = 'ZItemNew2' where name = 'ZItemNew'$$, 'manager renames an item');
reset role;

-- manager scoped to L2 cannot write L1 overrides/stations
select pg_temp.act_as(pg_temp.uid(7));
select throws_ok(format($$insert into public.kitchen_stations (organization_id, location_id, name) values (%L, %L, 'ZNope')$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1')), '42501', null, 'manager scoped to L2 cannot create a station in L1');
select is(pg_temp.affected($$update public.location_menu_overrides set price_override = 1 where price_override = 12000$$), 0, 'manager scoped to L2 cannot change an L1 override');
reset role;

-- ---- cross-org / cross-location links are rejected ------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, 'ZX', 1)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatB')), '23503', null, 'item cannot use another org''s category');
select throws_ok(format($$update public.menu_items set category_id = %L where name = 'ZItemA1'$$, pg_temp.cat('ZCatB')), '23503', null, 'item cannot move to another org''s category');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, 'ZX', 1)$$, pg_temp.org('men-b'), pg_temp.cat('ZCatB')), '42501', null, 'manager A cannot create items in org B');
select throws_ok(format($$insert into public.item_variants (organization_id, item_id, name) values (%L, %L, 'ZX')$$, pg_temp.org('men-a'), pg_temp.item('ZItemB1')), '23503', null, 'variant cannot attach to another org''s item');
select throws_ok(format($$insert into public.modifiers (organization_id, group_id, name) values (%L, %L, 'ZX')$$, pg_temp.org('men-a'), pg_temp.grp('ZGroupB')), '23503', null, 'modifier cannot join another org''s group');
select throws_ok(format($$insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.item('ZItemA3'), pg_temp.grp('ZGroupB')), '23503', null, 'link cannot use another org''s group');
select throws_ok(format($$insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.item('ZItemB1'), pg_temp.grp('ZGroupA')), '23503', null, 'link cannot use another org''s item');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id) values (%L, %L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA3'), pg_temp.stn('ZStnL1')), '23503', null, 'override cannot use a station from another location');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id) values (%L, %L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3'), pg_temp.stn('ZStnB')), '23503', null, 'override cannot use another org''s station');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemB1')), '23503', null, 'override cannot target another org''s item');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.loc('men-b', 'B1'), pg_temp.item('ZItemA3')), '42501', null, 'override cannot target another org''s location');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id) values (%L, %L, %L)$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA1')), '23505', null, 'one override per (location, item)');
select is(pg_temp.affected(format($$update public.menu_items set base_price = 1 where id = %L$$, pg_temp.item('ZItemB1'))), 0, 'manager A cannot update B''s item');
select is(pg_temp.affected(format($$update public.kitchen_stations set name = 'ZHack' where id = %L$$, pg_temp.stn('ZStnB'))), 0, 'manager A cannot update B''s station');
select is(pg_temp.affected(format($$update public.modifier_groups set name = 'ZHack' where id = %L$$, pg_temp.grp('ZGroupB'))), 0, 'manager A cannot update B''s modifier group');
reset role;

-- ---- column privileges, constraints, no DELETE -----------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$update public.menu_items set organization_id = %L where name = 'ZItemA3'$$, pg_temp.org('men-b')), '42501', null, 'client cannot change an item''s organization_id');
select throws_ok($$update public.location_menu_overrides set sold_out_until = now() + interval '1 day'$$, '42501', null, 'client cannot write sold_out_until directly');
select throws_ok(format($$insert into public.location_menu_overrides (organization_id, location_id, item_id, sold_out_until) values (%L, %L, %L, now())$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA3')), '42501', null, 'client cannot insert sold_out_until');
select throws_ok($$update public.location_menu_overrides set location_id = location_id$$, '42501', null, 'client cannot change an override''s location');
select throws_ok($$delete from public.menu_items$$, '42501', null, 'no client DELETE on menu_items');
select throws_ok($$delete from public.menu_categories$$, '42501', null, 'no client DELETE on menu_categories');
select throws_ok($$delete from public.location_menu_overrides$$, '42501', null, 'no client DELETE on overrides');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, 'ZNeg', -1)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '23514', null, 'negative base_price is rejected');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, '', 1)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '23514', null, 'empty item name is rejected');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price) values (%L, %L, %L, 1)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA'), repeat('x', 81)), '23514', null, 'item name over 80 chars is rejected');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, description) values (%L, %L, 'ZD', 1, %L)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA'), repeat('x', 501)), '23514', null, 'description over 500 chars is rejected');
select lives_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, description) values (%L, %L, 'ZD500', 1, %L)$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA'), repeat('x', 500)), '500-char description is accepted');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, dietary_tags) values (%L, %L, 'ZT', 1, array['vegan','bogus'])$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '23514', null, 'unknown dietary tag is rejected');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values (%L, %L, 'ZI', 1, '../secrets/x.png')$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '23514', null, 'image_path with .. is rejected');
select throws_ok(format($$insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values (%L, %L, 'ZI', 1, 'https://evil.test/x.png')$$, pg_temp.org('men-a'), pg_temp.cat('ZCatA')), '23514', null, 'image_path must be a storage path, not a URL');
select throws_ok(format($$insert into public.modifiers (organization_id, group_id, name, price_delta) values (%L, %L, 'ZNeg', -1)$$, pg_temp.org('men-a'), pg_temp.grp('ZGroupA')), '23514', null, 'negative modifier price is rejected');
select throws_ok(format($$insert into public.modifier_groups (organization_id, name, min_select, max_select) values (%L, 'ZBad1', 2, 1)$$, pg_temp.org('men-a')), '23514', null, 'max_select < min_select is rejected');
select throws_ok(format($$insert into public.modifier_groups (organization_id, name, min_select, max_select) values (%L, 'ZBad2', 0, 0)$$, pg_temp.org('men-a')), '23514', null, 'max_select 0 is rejected');
select throws_ok(format($$insert into public.modifier_groups (organization_id, name, min_select, max_select) values (%L, 'ZBad3', -1, 1)$$, pg_temp.org('men-a')), '23514', null, 'negative min_select is rejected');
select throws_ok($$update public.location_menu_overrides set price_override = -5 where price_override = 12000$$, '23514', null, 'negative price_override is rejected');
select throws_ok(format($$insert into public.menu_categories (organization_id, name) values (%L, 'zcata')$$, pg_temp.org('men-a')), '23505', null, 'duplicate active category name (case-insensitive) is rejected');
select throws_ok(format($$insert into public.kitchen_stations (organization_id, location_id, name) values (%L, %L, 'zstnl1')$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L1')), '23505', null, 'duplicate active station name in a location is rejected');
select lives_ok(format($$insert into public.kitchen_stations (organization_id, location_id, name) values (%L, %L, 'ZStnL1')$$, pg_temp.org('men-a'), pg_temp.loc('men-a', 'L2')), 'the same station name in another location is fine');
select throws_ok(format($$insert into public.item_variants (organization_id, item_id, name) values (%L, %L, 'zlarge')$$, pg_temp.org('men-a'), pg_temp.item('ZItemA1')), '23505', null, 'duplicate active variant name on an item is rejected');
select lives_ok(format($$delete from public.menu_item_modifier_groups where item_id = %L$$, pg_temp.item('ZItemA1')), 'manager can unlink a modifier group (link rows only)');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is(pg_temp.affected($$delete from public.menu_item_modifier_groups$$), 0, 'cashier cannot unlink modifier groups');
reset role;

select pg_temp.act_as(pg_temp.uid(6));
select lives_ok(format($$insert into public.menu_categories (organization_id, name) values (%L, 'ZCatA')$$, pg_temp.org('men-b')), 'the same category name in another org is fine');
reset role;

-- ---- set_item_sold_out ---------------------------------------------------------------------------------------------------
create temp table so (k text, until timestamptz);
grant all on so to authenticated;
select pg_temp.act_as(pg_temp.uid(3));
insert into so select 'cashier-l1', public.set_item_sold_out(pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3'), true);
select ok((select until from so where k = 'cashier-l1') > now() and (select until from so where k = 'cashier-l1') <= now() + interval '25 hours',
  'cashier sets sold out for the rest of the day (within 25h)');
select is(((select until from so where k = 'cashier-l1') at time zone 'Asia/Jakarta')::time, '00:00:00'::time, 'L1: sold out until local midnight in Asia/Jakarta');
select is((select until from so where k = 'cashier-l1'),
          ((((now() at time zone 'Asia/Jakarta')::date + 1)::timestamp) at time zone 'Asia/Jakarta'), 'L1: equals the start of the next local day');
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA3')), '42501', 'FORBIDDEN', 'cashier cannot set sold out at a location they are not scoped to');
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-b', 'B1'), pg_temp.item('ZItemB1')), '42501', 'FORBIDDEN', 'cashier cannot set sold out in another org');
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemB1')), '42501', 'FORBIDDEN', 'cashier cannot sell out another org''s item');
select throws_ok($$select public.set_item_sold_out(gen_random_uuid(), gen_random_uuid(), true)$$, '42501', 'FORBIDDEN', 'unknown ids look the same as forbidden');
select throws_ok(format($$select public.set_item_sold_out(%L, %L, null)$$, pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3')), '42501', 'FORBIDDEN', 'null sold_out is refused');
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA5')), '42501', 'FORBIDDEN', 'an inactive item cannot be sold out');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select lives_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA3')), 'waiter (orders.create) can set sold out at an accessible location');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA1')), '42501', 'FORBIDDEN', 'kitchen cannot set sold out');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
insert into so select 'manager-l2', public.set_item_sold_out(pg_temp.loc('men-a', 'L2'), pg_temp.item('ZItemA3'), true);
select is(((select until from so where k = 'manager-l2') at time zone 'America/Los_Angeles')::time, '00:00:00'::time, 'L2: sold out until local midnight in America/Los_Angeles');
select isnt((select until from so where k = 'manager-l2'), (select until from so where k = 'cashier-l1'), 'the two locations get different instants');
reset role;
select is((select count(*)::int from public.location_menu_overrides where item_id = pg_temp.item('ZItemA3') and sold_out_until is not null), 2, 'sold_out_until is stored on the overrides');
select is(pg_temp.audits('menu_override.sold_out'), 2, 'audit: sold-out toggles are logged (cashier at L1, waiter at L2; the manager''s repeat changes nothing)');

-- clearing
select pg_temp.act_as(pg_temp.uid(3));
insert into so select 'cleared', public.set_item_sold_out(pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3'), false);
select is((select until from so where k = 'cleared'), null, 'clearing returns null');
reset role;
select is((select sold_out_until from public.location_menu_overrides where item_id = pg_temp.item('ZItemA3') and location_id = pg_temp.loc('men-a', 'L1')), null, 'sold_out_until is cleared');
select is(pg_temp.audits('menu_override.sold_out_cleared'), 1, 'audit: clearing a sold-out is logged');

-- suspended org
update public.organizations set status = 'suspended' where id = pg_temp.org('men-a');
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.set_item_sold_out(%L, %L, true)$$, pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3')), '42501', 'FORBIDDEN', 'a suspended org cannot change sold-out');
reset role;
update public.organizations set status = 'active' where id = pg_temp.org('men-a');

-- ---- get_public_menu (anon) ------------------------------------------------------------------------------------------------
create temp table pm (k text, m jsonb);
grant all on pm to anon;
set local role anon;
insert into pm select 'l1', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
insert into pm select 'l2', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L2'));
insert into pm select 'slug-case', public.get_public_menu('  MEN-A ', pg_temp.loc('men-a', 'L1'));
insert into pm select 'unknown-slug', public.get_public_menu('no-such-org', pg_temp.loc('men-a', 'L1'));
insert into pm select 'wrong-org', public.get_public_menu('men-b', pg_temp.loc('men-a', 'L1'));
insert into pm select 'unknown-loc', public.get_public_menu('men-a', gen_random_uuid());
reset role;
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].name') from pm where k = 'l1'), '["ZItemA1", "ZItemA3"]'::jsonb,
  'L1 public menu: only published, active, available items (no draft, inactive, switched-off)');
select is((select jsonb_path_query_array(m, '$.categories[*].name') from pm where k = 'l1'), '["ZCatA"]'::jsonb, 'categories without visible items are omitted');
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].price') from pm where k = 'l1'), '[12000, 5000]'::jsonb, 'L1: effective price is the override, else the base price');
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].price') from pm where k = 'l2'), '[10000, 6000]'::jsonb, 'L2: no override means the base price');
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].name') from pm where k = 'l2'), '["ZItemA1", "ZItemA4"]'::jsonb, 'L2: A4 is only switched off at L1, A3 is sold out at L2');
select is((select m ->> 'currency' from pm where k = 'l1'), 'IDR', 'currency comes from the location');
select is((select jsonb_path_query_array(m, '$.categories[*].items[*] ? (@.name == "ZItemA1").variants[*].name') from pm where k = 'l1'), '["ZLarge"]'::jsonb, 'active variants are included');
select is((select m::text ~ '(organization_id|sold_out|kitchen_station|is_published|is_active|base_price|price_override|created_at|updated_at|location_id)' from pm where k = 'l1'), false, 'no internal fields leak');
select is((select m from pm where k = 'unknown-slug'), null, 'unknown slug returns null');
select is((select m from pm where k = 'wrong-org'), null, 'a location of another org returns null');
select is((select m from pm where k = 'unknown-loc'), null, 'unknown location returns null');
select isnt((select m from pm where k = 'slug-case'), null, 'slug is matched case-insensitively and trimmed');

-- sold out hides the item; an expired sold-out shows it again
select pg_temp.act_as(pg_temp.uid(3));
select public.set_item_sold_out(pg_temp.loc('men-a', 'L1'), pg_temp.item('ZItemA3'), true);
reset role;
set local role anon;
insert into pm select 'soldout', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
reset role;
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].name') from pm where k = 'soldout'), '["ZItemA1"]'::jsonb, 'a sold-out item disappears from the public menu');
update public.location_menu_overrides set sold_out_until = now() - interval '1 minute' where item_id = pg_temp.item('ZItemA3') and location_id = pg_temp.loc('men-a', 'L1');
set local role anon;
insert into pm select 'expired', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
reset role;
select is((select jsonb_path_query_array(m, '$.categories[*].items[*].name') from pm where k = 'expired'), '["ZItemA1", "ZItemA3"]'::jsonb, 'an expired sold-out no longer hides the item');

-- modifier groups appear only with active modifiers
insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values (pg_temp.org('men-a'), pg_temp.item('ZItemA1'), pg_temp.grp('ZGroupA'));
set local role anon;
insert into pm select 'groups', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
reset role;
select is((select jsonb_path_query_array(m, '$.categories[*].items[*] ? (@.name == "ZItemA1").modifier_groups[*].modifiers[*].name') from pm where k = 'groups'), '["ZMod1"]'::jsonb, 'modifier groups with their active modifiers are included');
update public.modifiers set is_active = false where name = 'ZMod1';
set local role anon;
insert into pm select 'nomods', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
reset role;
select is((select jsonb_array_length(jsonb_path_query_array(m, '$.categories[*].items[*] ? (@.name == "ZItemA1").modifier_groups[*]')) from pm where k = 'nomods'), 0, 'a group without active modifiers is omitted');

-- inactive category, inactive location, suspended org
update public.menu_categories set is_active = false where name = 'ZCatA';
set local role anon;
insert into pm select 'catoff', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L1'));
reset role;
select is((select jsonb_array_length(m -> 'categories') from pm where k = 'catoff'), 0, 'an inactive category hides its items');
update public.menu_categories set is_active = true where name = 'ZCatA';
update public.locations set is_active = false where id = pg_temp.loc('men-a', 'L2');
update public.organizations set status = 'suspended' where id = pg_temp.org('men-b');
set local role anon;
insert into pm select 'locoff', public.get_public_menu('men-a', pg_temp.loc('men-a', 'L2'));
insert into pm select 'suspended', public.get_public_menu('men-b', pg_temp.loc('men-b', 'B1'));
reset role;
select is((select m from pm where k = 'locoff'), null, 'an inactive location returns null');
select is((select m from pm where k = 'suspended'), null, 'a suspended org returns null');
update public.organizations set status = 'past_due' where id = pg_temp.org('men-b');
set local role anon;
insert into pm select 'pastdue', public.get_public_menu('men-b', pg_temp.loc('men-b', 'B1'));
reset role;
select is((select m from pm where k = 'pastdue'), null, 'only active orgs are public');
update public.organizations set status = 'active' where id = pg_temp.org('men-b');

-- ---- audit ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.audits('menu_item.created'), 2, 'audit: item created (ZItemNew, ZD500)');
select is(pg_temp.audits('menu_item.price_changed'), 1, 'audit: item price change logged once');
select is((select metadata ->> 'from' || '>' || (metadata ->> 'to') from public.audit_logs where action = 'menu_item.price_changed'), '15000>17000', 'audit: price change records from/to');
select is(pg_temp.audits('menu_item.deactivated'), 1, 'audit: item deactivated');
select is(pg_temp.audits('menu_item.reactivated'), 1, 'audit: item reactivated');
select is(pg_temp.audits('menu_item.updated'), 1, 'audit: item renamed counts as updated');
select is(pg_temp.audits('menu_override.price_changed'), 1, 'audit: override price change');
select is(pg_temp.audits('item_variant.price_changed'), 1, 'audit: variant price change');
select is(pg_temp.audits('menu_override.created') >= 1, true, 'audit: override created');
select is((select count(*)::int from public.audit_logs where action like 'menu_item.%' and organization_id <> pg_temp.org('men-a')), 0, 'audit rows belong to the acting org');

select * from finish();
rollback;
