-- Venue fixtures shared by 090/095/100/110 (included after _helpers.inc and _rpc.inc).
-- sm = manager of A limited to location A1. Areas AR1/ARX/AR2/ARB, tables TA1/TX/TA2/TB with known tokens.
select tests.mkuser('sm');
-- sm: a manager of A restricted to location A1 (holds tables.manage there only)
insert into public.organization_members (organization_id, user_id, role_id, status, all_locations)
values ((select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'usm'), tests.role_id('A', 'manager'), 'active', false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, (select id from tests.ids where name = 'A1'), m.organization_id
from public.organization_members m where m.user_id = (select id from tests.ids where name = 'usm');

insert into tests.ids values
  ('AR1', '00000000-0000-4000-8000-00000000ae01'),  -- A1 Indoor (active)
  ('ARX', '00000000-0000-4000-8000-00000000ae02'),  -- A1 Old (inactive)
  ('AR2', '00000000-0000-4000-8000-00000000ae03'),  -- A2 Patio
  ('ARB', '00000000-0000-4000-8000-00000000be01'),  -- B1 Bar
  ('TA1', '00000000-0000-4000-8000-00000000fe01'),  -- A1, T1
  ('TX',  '00000000-0000-4000-8000-00000000fe02'),  -- A1, T9 (inactive)
  ('TA2', '00000000-0000-4000-8000-00000000fe03'),  -- A2, T1
  ('TB',  '00000000-0000-4000-8000-00000000fe04');  -- B1, T1

insert into public.areas (id, organization_id, location_id, name, is_active) values
  ((select id from tests.ids where name = 'AR1'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), 'Indoor', true),
  ((select id from tests.ids where name = 'ARX'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), 'Old', false),
  ((select id from tests.ids where name = 'AR2'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A2'), 'Patio', true),
  ((select id from tests.ids where name = 'ARB'), (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'B1'), 'Bar', true);

insert into public.tables (id, organization_id, location_id, area_id, label, capacity, is_active, qr_token) values
  ((select id from tests.ids where name = 'TA1'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), (select id from tests.ids where name = 'AR1'), 'T1', 4, true,  'tok-a1'),
  ((select id from tests.ids where name = 'TX'),  (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A1'), (select id from tests.ids where name = 'AR1'), 'T9', 2, false, 'tok-x'),
  ((select id from tests.ids where name = 'TA2'), (select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'A2'), (select id from tests.ids where name = 'AR2'), 'T1', 4, true,  'tok-a2'),
  ((select id from tests.ids where name = 'TB'),  (select id from tests.ids where name = 'B'), (select id from tests.ids where name = 'B1'), (select id from tests.ids where name = 'ARB'), 'T1', 4, true,  'tok-b');

