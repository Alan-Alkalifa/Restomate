-- MVM-T07: read matrix for the 8 menu tables.
-- Actor order: oa ma ca wa ka da ob out padmin anon  (+ sm = manager limited to A1)
-- Org-level tables (categories, items, variants, groups, modifiers, links): every active org member reads, regardless of location.
-- Per-location tables (kitchen_stations, location_menu_overrides): location access required.
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _menu.inc
select plan(214);

create table tests.read_specs (ord serial, label text, q text, exp int[]);
--                                                                                         oa ma ca wa ka da ob out pad anon
insert into tests.read_specs (label, q, exp) values
 ('menu_categories A', 'select 1 from public.menu_categories where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('menu_categories B', 'select 1 from public.menu_categories where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('menu_items A (incl. unpublished + inactive)', 'select 1 from public.menu_items where organization_id = {A}', '{3,3,3,3,3,0,0,0,3,0}'),
 ('menu_items B',       'select 1 from public.menu_items where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('menu_items by id of org B', 'select 1 from public.menu_items where id = {IB}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('item_variants A',    'select 1 from public.item_variants where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('item_variants B',    'select 1 from public.item_variants where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('modifier_groups A',  'select 1 from public.modifier_groups where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('modifier_groups B',  'select 1 from public.modifier_groups where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('modifiers A',        'select 1 from public.modifiers where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('modifiers B',        'select 1 from public.modifiers where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('menu_item_modifier_groups A', 'select 1 from public.menu_item_modifier_groups where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('menu_item_modifier_groups B', 'select 1 from public.menu_item_modifier_groups where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('kitchen_stations A1', 'select 1 from public.kitchen_stations where location_id = {A1}', '{1,1,1,0,0,0,0,0,1,0}'),
 ('kitchen_stations A2', 'select 1 from public.kitchen_stations where location_id = {A2}', '{1,1,0,0,0,0,0,0,1,0}'),
 ('kitchen_stations B1', 'select 1 from public.kitchen_stations where location_id = {B1}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('location_menu_overrides A1', 'select 1 from public.location_menu_overrides where location_id = {A1}', '{1,1,1,0,0,0,0,0,1,0}'),
 ('location_menu_overrides A (all locations)', 'select 1 from public.location_menu_overrides where organization_id = {A}', '{1,1,1,0,0,0,0,0,1,0}'),
 ('location_menu_overrides B1', 'select 1 from public.location_menu_overrides where location_id = {B1}', '{0,0,0,0,0,0,1,0,1,0}'),
 -- a price override is visible to the staff of that location only
 ('price_override value readable only with location access', 'select 1 from public.location_menu_overrides where price_override = 27000', '{1,1,1,0,0,0,0,0,1,0}'),
 ('sold_out_until column readable at own location', 'select sold_out_until from public.location_menu_overrides where location_id = {A1}', '{1,1,1,0,0,0,0,0,1,0}');

create function tests.run_reads() returns setof text language plpgsql as $$
declare s record; i int; names text[] := array['oa','ma','ca','wa','ka','da','ob','out','padmin','anon'];
begin
  for s in select * from tests.read_specs order by ord loop
    for i in 1 .. 10 loop
      return next is(tests.cnt(names[i], s.q), s.exp[i]::bigint, s.label || ' as ' || names[i]);
    end loop;
  end loop;
end $$;
select * from tests.run_reads();

-- A1-scoped manager
select is(tests.cnt('sm', 'select 1 from public.kitchen_stations where organization_id = {A}'), 1::bigint, 'sm sees only the A1 station');
select is(tests.cnt('sm', 'select 1 from public.location_menu_overrides where organization_id = {A}'), 1::bigint, 'sm sees only A1 overrides');
select is(tests.cnt('sm', 'select 1 from public.menu_items where organization_id = {A}'), 3::bigint, 'sm sees the org-level menu');
select is(tests.cnt('sm', 'select 1 from public.menu_items where organization_id = {B}'), 0::bigint, 'sm sees nothing of org B');

select * from finish();
rollback;
