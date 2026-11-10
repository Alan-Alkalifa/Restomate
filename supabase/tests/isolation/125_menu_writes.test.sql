-- MVM-T07: menu writes: roles, cross-tenant and cross-org links, price tampering, sold_out_until, constraints, no deletes.
-- ok = exactly one row changed; blocked = refused (42501), constraint/trigger, or filtered to 0 rows.
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _menu.inc
select plan(146);

create table tests.write_specs (ord serial, actor text, stmt text, expect text, label text);

insert into tests.write_specs (actor, stmt, expect, label) values
-- ---- who may write org-level menu tables (menu.manage = owner, manager) ----
 ('oa','insert into public.menu_categories (organization_id, name) values ({A}, ''C-oa'')','ok','owner creates a category'),
 ('ma','insert into public.menu_categories (organization_id, name) values ({A}, ''C-ma'')','ok','manager creates a category'),
 ('sm','insert into public.menu_categories (organization_id, name) values ({A}, ''C-sm'')','ok','location-scoped manager creates a category (menu is org-level)'),
 ('ca','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-ca'')','blocked','cashier cannot create a category'),
 ('wa','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-wa'')','blocked','waiter cannot create a category'),
 ('ka','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-ka'')','blocked','kitchen cannot create a category'),
 ('da','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-da'')','blocked','deactivated cashier cannot create'),
 ('ob','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-ob'')','blocked','org B owner cannot create a category in org A'),
 ('out','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-out'')','blocked','non-member cannot create'),
 ('anon','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-anon'')','blocked','anon cannot create'),
 ('padmin','insert into public.menu_categories (organization_id, name) values ({A}, ''Z-pad'')','blocked','platform admin has read-only menu access'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''I-oa'', 15000)','ok','owner creates an item'),
 ('ma','insert into public.menu_items (organization_id, category_id, name, base_price, is_published) values ({A}, {CA1}, ''I-ma'', 15000, true)','ok','manager creates and publishes an item'),
 ('ca','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''Z-i1'', 1)','blocked','cashier cannot create an item'),
 ('wa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''Z-i2'', 1)','blocked','waiter cannot create an item'),
 ('ka','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''Z-i3'', 1)','blocked','kitchen cannot create an item'),
 ('oa','insert into public.item_variants (organization_id, item_id, name, price_delta) values ({A}, {IA1}, ''V-oa'', -1000)','ok','owner creates a variant (negative delta allowed)'),
 ('ca','insert into public.item_variants (organization_id, item_id, name) values ({A}, {IA1}, ''Z-v'')','blocked','cashier cannot create a variant'),
 ('oa','insert into public.modifier_groups (organization_id, name, min_select, max_select) values ({A}, ''G-oa'', 1, 2)','ok','owner creates a modifier group'),
 ('wa','insert into public.modifier_groups (organization_id, name) values ({A}, ''Z-g'')','blocked','waiter cannot create a modifier group'),
 ('oa','insert into public.modifiers (organization_id, group_id, name, price_delta) values ({A}, {GA}, ''Mod-oa'', 500)','ok','owner creates a modifier'),
 ('ka','insert into public.modifiers (organization_id, group_id, name) values ({A}, {GA}, ''Z-m'')','blocked','kitchen cannot create a modifier'),
 ('oa','insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values ({A}, {IA2}, {GA})','ok','owner links a group to an item'),
 ('ca','insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values ({A}, {IA2}, {GA})','blocked','cashier cannot link groups'),
-- ---- cross-tenant / cross-org links ----
 ('oa','insert into public.menu_categories (organization_id, name) values ({B}, ''X1'')','blocked','owner A cannot create a category in org B'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CB}, ''X2'', 1)','blocked','item of org A in a category of org B rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({B}, {CA1}, ''X3'', 1)','blocked','item of org B in a category of org A rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({B}, {CB}, ''X4'', 1)','blocked','owner A cannot create an item in org B'),
 ('ob','insert into public.menu_items (organization_id, category_id, name, base_price) values ({B}, {CA1}, ''X5'', 1)','blocked','owner B pointing at a category of org A rejected'),
 ('oa','insert into public.item_variants (organization_id, item_id, name) values ({A}, {IB}, ''X6'')','blocked','variant of org A on an item of org B rejected'),
 ('oa','insert into public.item_variants (organization_id, item_id, name) values ({B}, {IA1}, ''X7'')','blocked','variant of org B on an item of org A rejected'),
 ('oa','insert into public.modifiers (organization_id, group_id, name) values ({A}, {GB}, ''X8'')','blocked','modifier of org A in a group of org B rejected'),
 ('oa','insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values ({A}, {IA1}, {GB})','blocked','link item A to group B rejected'),
 ('oa','insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values ({A}, {IB}, {GA})','blocked','link item B to group A rejected'),
 ('oa','insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values ({B}, {IB}, {GB})','blocked','owner A cannot create links in org B'),
 ('oa','insert into public.kitchen_stations (organization_id, location_id, name) values ({A}, {B1}, ''X9'')','blocked','station of org A in a location of org B rejected'),
 ('oa','insert into public.kitchen_stations (organization_id, location_id, name) values ({B}, {B1}, ''X10'')','blocked','owner A cannot create a station in org B'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id) values ({A}, {A1}, {IB})','blocked','override for an item of org B rejected'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id) values ({A}, {B1}, {IA2})','blocked','override at a location of org B rejected'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id) values ({B}, {B1}, {IB})','blocked','owner A cannot create an override in org B (duplicate and foreign)'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id) values ({A}, {A1}, {IA2}, {KA2})','blocked','station of another location (same org) rejected'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id) values ({A}, {A1}, {IA2}, {KB})','blocked','station of org B rejected'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id) values ({A}, {A1}, {IA2}, {KA1})','ok','override with a station of the same location'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id) values ({A}, {A1}, {IA2})','blocked','duplicate (location, item) override rejected'),
-- ---- updates across tenants / immutable columns ----
 ('oa','update public.menu_items set name = ''pwn'' where id = {IB}','blocked','owner A cannot edit an item of org B'),
 ('oa','update public.menu_items set base_price = 1 where id = {IB}','blocked','owner A cannot reprice an item of org B'),
 ('oa','update public.menu_categories set is_active = false where id = {CB}','blocked','owner A cannot deactivate a category of org B'),
 ('oa','update public.item_variants set price_delta = 0 where id = {VB}','blocked','owner A cannot reprice a variant of org B'),
 ('oa','update public.modifiers set price_delta = 0 where id = {MB}','blocked','owner A cannot reprice a modifier of org B'),
 ('oa','update public.location_menu_overrides set price_override = 1 where id = {OB}','blocked','owner A cannot reprice an override of org B'),
 ('oa','update public.kitchen_stations set name = ''pwn'' where id = {KB}','blocked','owner A cannot rename a station of org B'),
 ('ob','update public.menu_items set name = ''Tea 2'' where id = {IB}','ok','owner B edits own item'),
 ('oa','update public.menu_items set organization_id = {B} where id = {IA1}','blocked','item cannot change organization'),
 ('oa','update public.menu_items set category_id = {CB} where id = {IA1}','blocked','item cannot move to a category of org B'),
 ('oa','update public.menu_items set id = gen_random_uuid() where id = {IA1}','blocked','item id immutable'),
 ('oa','update public.item_variants set item_id = {IB} where id = {VA}','blocked','variant cannot move to another item/org'),
 ('oa','update public.modifiers set group_id = {GB} where id = {MA}','blocked','modifier cannot move to a group of org B'),
 ('oa','update public.menu_item_modifier_groups set group_id = {GB} where item_id = {IA1}','blocked','link target cannot be changed'),
 ('oa','update public.location_menu_overrides set location_id = {A2} where id = {OA1}','blocked','override cannot move to another location'),
 ('oa','update public.location_menu_overrides set item_id = {IA2} where id = {OA1}','blocked','override cannot move to another item'),
 ('oa','update public.location_menu_overrides set organization_id = {B} where id = {OA1}','blocked','override cannot change organization'),
 ('oa','update public.location_menu_overrides set kitchen_station_id = {KA2} where id = {OA1}','blocked','override station must stay in the same location'),
 ('oa','update public.location_menu_overrides set kitchen_station_id = {KB} where id = {OA1}','blocked','override cannot point at a station of org B'),
 ('oa','update public.kitchen_stations set location_id = {A2} where id = {KA1}','blocked','station cannot move to another location'),
-- ---- price tampering by non-managers ----
 ('ca','update public.menu_items set base_price = 1 where id = {IA1}','blocked','cashier cannot change base_price'),
 ('wa','update public.menu_items set base_price = 1 where id = {IA1}','blocked','waiter cannot change base_price'),
 ('ka','update public.menu_items set base_price = 1 where id = {IA1}','blocked','kitchen cannot change base_price'),
 ('da','update public.menu_items set base_price = 1 where id = {IA1}','blocked','deactivated cannot change base_price'),
 ('ca','update public.item_variants set price_delta = -25000 where id = {VA}','blocked','cashier cannot change a variant price'),
 ('wa','update public.modifiers set price_delta = 0 where id = {MA}','blocked','waiter cannot change a modifier price'),
 ('ca','update public.location_menu_overrides set price_override = 1 where id = {OA1}','blocked','cashier cannot change price_override'),
 ('wa','update public.location_menu_overrides set price_override = 1 where id = {OA1}','blocked','waiter cannot change price_override'),
 ('ca','update public.location_menu_overrides set is_available = false where id = {OA1}','blocked','cashier cannot switch availability directly'),
 ('ca','insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override) values ({A}, {A1}, {IA2}, 1)','blocked','cashier cannot create a price override'),
 ('wa','insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override) values ({A}, {A1}, {IA2}, 1)','blocked','waiter cannot create a price override'),
 ('ca','update public.menu_items set is_published = true where id = {IA2}','blocked','cashier cannot publish an item'),
 ('wa','update public.menu_items set is_active = false where id = {IA1}','blocked','waiter cannot deactivate an item'),
 ('anon','update public.menu_items set base_price = 1 where id = {IA1}','blocked','anon cannot change base_price'),
 ('padmin','update public.menu_items set base_price = 1 where id = {IA1}','blocked','platform admin cannot change base_price'),
 ('out','update public.menu_items set base_price = 1 where id = {IA1}','blocked','non-member cannot change base_price'),
-- ---- sold_out_until is only writable through set_item_sold_out (even for owners) ----
 ('oa','update public.location_menu_overrides set sold_out_until = now() + interval ''1 day'' where id = {OA1}','blocked','owner cannot write sold_out_until directly'),
 ('ma','update public.location_menu_overrides set sold_out_until = now() + interval ''1 day'' where id = {OA1}','blocked','manager cannot write sold_out_until directly'),
 ('ca','update public.location_menu_overrides set sold_out_until = now() + interval ''1 day'' where id = {OA1}','blocked','cashier cannot write sold_out_until directly'),
 ('wa','update public.location_menu_overrides set sold_out_until = now() + interval ''1 day'' where id = {OA1}','blocked','waiter cannot write sold_out_until directly'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id, sold_out_until) values ({A}, {A2}, {IA1}, now() + interval ''1 day'')','blocked','owner cannot insert with sold_out_until'),
 ('oa','update public.location_menu_overrides set sold_out_until = null where id = {OA1}','blocked','nor clear it directly'),
-- ---- location scope on per-location tables ----
 ('sm','insert into public.kitchen_stations (organization_id, location_id, name) values ({A}, {A1}, ''St-sm'')','ok','scoped manager creates a station in own location'),
 ('sm','insert into public.kitchen_stations (organization_id, location_id, name) values ({A}, {A2}, ''St-sm2'')','blocked','scoped manager cannot create a station in another location'),
 ('ma','insert into public.kitchen_stations (organization_id, location_id, name) values ({A}, {A2}, ''St-ma'')','ok','all-locations manager creates a station in A2'),
 ('ca','insert into public.kitchen_stations (organization_id, location_id, name) values ({A}, {A1}, ''Z-st'')','blocked','cashier cannot create a station'),
 ('sm','update public.kitchen_stations set name = ''pwn'' where id = {KA2}','blocked','scoped manager cannot rename a station of another location'),
 ('sm','insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override) values ({A}, {A2}, {IA2}, 1)','blocked','scoped manager cannot override at another location'),
 ('ma','insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override) values ({A}, {A2}, {IA2}, 31000)','ok','all-locations manager overrides a price at A2'),
 ('sm','update public.location_menu_overrides set price_override = 26000 where id = {OA1}','ok','scoped manager reprices at own location'),
-- ---- constraints ----
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''N-neg'', -1)','blocked','negative base_price rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''N-max'', 9223372036854775807)','ok','bigint-max price fits the column (the app caps at 1e12; DB has no upper bound)'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, dietary_tags) values ({A}, {CA1}, ''N-tag'', 1, ''{kosher}'')','blocked','unknown dietary tag rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, dietary_tags) values ({A}, {CA1}, ''N-tag2'', 1, ''{vegan,halal}'')','ok','known dietary tags accepted'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values ({A}, {CA1}, ''N-img1'', 1, ''../secret.png'')','blocked','image_path with .. rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values ({A}, {CA1}, ''N-img2'', 1, ''/etc/passwd'')','blocked','absolute image_path rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values ({A}, {CA1}, ''N-img3'', 1, ''https://evil.test/x.png'')','blocked','URL image_path rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values ({A}, {CA1}, ''N-img4'', 1, ''a b.png'')','blocked','image_path with space rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, image_path) values ({A}, {CA1}, ''N-img5'', 1, ''org/items/n5.png'')','ok','relative image_path accepted'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, '''', 1)','blocked','empty item name rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, repeat(''x'', 81), 1)','blocked','81-char item name rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price, description) values ({A}, {CA1}, ''N-desc'', 1, repeat(''x'', 501))','blocked','501-char description rejected'),
 ('oa','insert into public.menu_items (organization_id, category_id, name, base_price) values ({A}, {CA1}, ''NASI'', 1)','ok','duplicate item names are allowed (no unique index on items by design)'),
 ('oa','insert into public.menu_categories (organization_id, name) values ({A}, ''MAINS'')','blocked','duplicate active category name (case-insensitive) rejected'),
 ('oa','insert into public.item_variants (organization_id, item_id, name) values ({A}, {IA1}, ''LARGE'')','blocked','duplicate active variant name on an item rejected'),
 ('oa','insert into public.modifier_groups (organization_id, name) values ({A}, ''SPICE'')','blocked','duplicate active group name rejected'),
 ('oa','insert into public.modifiers (organization_id, group_id, name) values ({A}, {GA}, ''hot'')','blocked','duplicate active modifier name in a group rejected'),
 ('oa','insert into public.modifiers (organization_id, group_id, name, price_delta) values ({A}, {GA}, ''Neg'', -1)','blocked','negative modifier price rejected'),
 ('oa','insert into public.modifier_groups (organization_id, name, min_select, max_select) values ({A}, ''G-bad1'', 2, 1)','blocked','min_select > max_select rejected'),
 ('oa','insert into public.modifier_groups (organization_id, name, min_select, max_select) values ({A}, ''G-bad2'', 0, 0)','blocked','max_select 0 rejected'),
 ('oa','insert into public.modifier_groups (organization_id, name, min_select, max_select) values ({A}, ''G-bad3'', -1, 1)','blocked','negative min_select rejected'),
 ('oa','insert into public.location_menu_overrides (organization_id, location_id, item_id, price_override) values ({A}, {A2}, {IAX}, -5)','blocked','negative price_override rejected'),
-- ---- deletes: nobody, except unlinking a modifier group ----
 ('oa','delete from public.menu_items where id = {IA1}','blocked','owner cannot delete an item'),
 ('ma','delete from public.menu_categories where id = {CA1}','blocked','manager cannot delete a category'),
 ('oa','delete from public.item_variants where id = {VA}','blocked','owner cannot delete a variant'),
 ('oa','delete from public.modifiers where id = {MA}','blocked','owner cannot delete a modifier'),
 ('oa','delete from public.modifier_groups where id = {GA}','blocked','owner cannot delete a group'),
 ('oa','delete from public.location_menu_overrides where id = {OA1}','blocked','owner cannot delete an override'),
 ('oa','delete from public.kitchen_stations where id = {KA1}','blocked','owner cannot delete a station'),
 ('padmin','delete from public.menu_items where id = {IA1}','blocked','platform admin cannot delete an item'),
 ('ca','delete from public.menu_item_modifier_groups where item_id = {IA1}','blocked','cashier cannot unlink'),
 ('ob','delete from public.menu_item_modifier_groups where item_id = {IA1}','blocked','org B cannot unlink an org A link'),
 ('oa','delete from public.menu_item_modifier_groups where item_id = {IB}','blocked','owner A cannot unlink an org B link'),
 ('ma','delete from public.menu_item_modifier_groups where item_id = {IA2} and group_id = {GA}','ok','manager unlinks a group (the only permitted delete)');

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

-- ---- state after the attacks ----
select is((select base_price from public.menu_items where id = (select id from tests.ids where name = 'IA1')), 25000::bigint, 'IA1 base price untouched');
select is((select price_delta from public.item_variants where id = (select id from tests.ids where name = 'VA')), 5000::bigint, 'variant price untouched');
select is((select price_delta from public.modifiers where id = (select id from tests.ids where name = 'MA')), 0::bigint, 'modifier price untouched');
select is((select price_override from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), 26000::bigint, 'override changed only by the scoped manager at own location');
select is((select sold_out_until from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), null, 'sold_out_until never set by direct writes');
select is((select count(*)::int from public.location_menu_overrides where sold_out_until is not null and organization_id in (select id from tests.ids where name in ('A', 'B'))), 0, 'no fixture override carries sold_out_until');
select is((select base_price from public.menu_items where id = (select id from tests.ids where name = 'IB')), 10000::bigint, 'org B item price untouched');
select is((select name from public.menu_items where id = (select id from tests.ids where name = 'IB')), 'Tea 2', 'org B item changed only by its owner');
select is((select count(*)::int from public.menu_items where organization_id = (select id from tests.ids where name = 'B')), 1, 'org B still has one item');
select is((select count(*)::int from public.menu_categories where organization_id = (select id from tests.ids where name = 'B')), 1, 'org B still has one category');
select is((select count(*)::int from public.menu_items where name like 'Z-%' or name like 'X%' or name = 'pwn'), 0, 'no attacker-created items');
select is((select count(*)::int from public.menu_items i where not exists (select 1 from public.menu_categories c where c.id = i.category_id and c.organization_id = i.organization_id)), 0, 'every item: category in the same org');
select is((select count(*)::int from public.location_menu_overrides o where not exists (select 1 from public.menu_items i where i.id = o.item_id and i.organization_id = o.organization_id) or not exists (select 1 from public.locations l where l.id = o.location_id and l.organization_id = o.organization_id)), 0, 'every override: item and location in the same org');
select is((select count(*)::int from public.location_menu_overrides o where o.kitchen_station_id is not null and not exists (select 1 from public.kitchen_stations s where s.id = o.kitchen_station_id and s.location_id = o.location_id)), 0, 'every override station lives in the override location');
select is((select count(*)::int from public.menu_item_modifier_groups where item_id = (select id from tests.ids where name = 'IA1')), 1, 'the IA1 link survived the unauthorised unlink attempts');
select is((select count(*)::int from public.audit_logs where action = 'menu_item.price_changed'), 0, 'no price change slipped through (none audited)');
select cmp_ok((select count(*)::int from public.audit_logs where action = 'menu_override.price_changed' and actor_id = (select id from tests.ids where name = 'usm')), '>=', 1, 'the legitimate override change was audited with the actor');
select cmp_ok((select count(*)::int from public.audit_logs where action = 'menu_item.created' and actor_id = (select id from tests.ids where name = 'uoa')), '>=', 1, 'menu_item.created audited');

select * from finish();
rollback;
