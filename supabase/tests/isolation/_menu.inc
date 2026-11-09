-- Menu fixtures shared by 120/125/130 (include after _helpers.inc and _rpc.inc; pulls in _venue.inc for sm + locations).
-- Org A: category CA1, items IA1 (published, 25000), IA2 (unpublished), IAX (inactive); variant VA; group GA with modifier MA; link IA1-GA;
--        stations KA1 (A1) KA2 (A2); override OA1 (A1, IA1, price_override 27000).
-- Org B: category CB, item IB, variant VB, group GB, modifier MB, link IB-GB, station KB (B1), override OB (B1, IB).
\ir _venue.inc

insert into tests.ids values
  ('CA1', '00000000-0000-4000-8000-0000000ca001'),
  ('CB',  '00000000-0000-4000-8000-0000000cb001'),
  ('IA1', '00000000-0000-4000-8000-0000000a1001'),
  ('IA2', '00000000-0000-4000-8000-0000000a1002'),
  ('IAX', '00000000-0000-4000-8000-0000000a1003'),
  ('IB',  '00000000-0000-4000-8000-0000000b1001'),
  ('VA',  '00000000-0000-4000-8000-00000000ba01'),
  ('VB',  '00000000-0000-4000-8000-00000000bb01'),
  ('GA',  '00000000-0000-4000-8000-00000000da01'),
  ('GB',  '00000000-0000-4000-8000-00000000db01'),
  ('MA',  '00000000-0000-4000-8000-00000000ea01'),
  ('MB',  '00000000-0000-4000-8000-00000000eb01'),
  ('KA1', '00000000-0000-4000-8000-00000000fa01'),
  ('KA2', '00000000-0000-4000-8000-00000000fa02'),
  ('KB',  '00000000-0000-4000-8000-00000000fb01'),
  ('OA1', '00000000-0000-4000-8000-00000000aa01'),
  ('OB',  '00000000-0000-4000-8000-00000000ab01');

insert into public.menu_categories (id, organization_id, name) values
  ((select id from tests.ids where name = 'CA1'), (select id from tests.ids where name = 'A'), 'Mains'),
  ((select id from tests.ids where name = 'CB'),  (select id from tests.ids where name = 'B'), 'Drinks');

insert into public.menu_items (id, organization_id, category_id, name, base_price, is_published, is_active) values
  ((select id from tests.ids where name = 'IA1'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'CA1'), 'Nasi', 25000, true,  true),
  ((select id from tests.ids where name = 'IA2'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'CA1'), 'Hidden', 30000, false, true),
  ((select id from tests.ids where name = 'IAX'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'CA1'), 'Retired', 20000, true,  false),
  ((select id from tests.ids where name = 'IB'),  (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'CB'),  'Tea', 10000, true, true);

insert into public.item_variants (id, organization_id, item_id, name, price_delta) values
  ((select id from tests.ids where name = 'VA'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'IA1'), 'Large', 5000),
  ((select id from tests.ids where name = 'VB'), (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'IB'),  'Large', 2000);

insert into public.modifier_groups (id, organization_id, name, min_select, max_select) values
  ((select id from tests.ids where name = 'GA'), (select id from tests.ids where name = 'A'), 'Spice', 0, 1),
  ((select id from tests.ids where name = 'GB'), (select id from tests.ids where name = 'B'), 'Sugar', 0, 1);
insert into public.modifiers (id, organization_id, group_id, name, price_delta) values
  ((select id from tests.ids where name = 'MA'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'GA'), 'Hot', 0),
  ((select id from tests.ids where name = 'MB'), (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'GB'), 'Extra', 1000);
insert into public.menu_item_modifier_groups (organization_id, item_id, group_id) values
  ((select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'IA1'), (select id from tests.ids where name = 'GA')),
  ((select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'IB'),  (select id from tests.ids where name = 'GB'));

insert into public.kitchen_stations (id, organization_id, location_id, name) values
  ((select id from tests.ids where name = 'KA1'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), 'Grill'),
  ((select id from tests.ids where name = 'KA2'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A2'), 'Bar'),
  ((select id from tests.ids where name = 'KB'),  (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'B1'), 'Grill');

insert into public.location_menu_overrides (id, organization_id, location_id, item_id, price_override, kitchen_station_id) values
  ((select id from tests.ids where name = 'OA1'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), (select id from tests.ids where name = 'IA1'), 27000, (select id from tests.ids where name = 'KA1')),
  ((select id from tests.ids where name = 'OB'),  (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'B1'), (select id from tests.ids where name = 'IB'),  null, (select id from tests.ids where name = 'KB'));
