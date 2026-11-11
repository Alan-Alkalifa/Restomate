-- Restomate LOCAL seed. Never run against a production project.
-- Applied by `supabase db reset` after the migrations. Safe to re-run.
--
-- Contents: packages, platform admin, "Demo Restaurant" (slug `demo`) with its staff,
-- and a second tenant "Other Bistro" (the cross-tenant target).
-- All seed users share one LOCAL-ONLY password, documented in README.md.
--
-- Order matters with the integrity triggers: the subscription is created BEFORE
-- locations and members (private.org_limit is 0 without a live subscription).

-- ---------------------------------------------------------------------------
-- Packages. PLACEHOLDER prices: pricing is an open product question.
-- ---------------------------------------------------------------------------
insert into public.packages
  (code, name, description, price_monthly, price_yearly, trial_days, limits, features,
   is_active, is_public, is_default, sort_order)
values
  -- PLACEHOLDER prices (IDR) below
  ('starter', 'Starter', 'One location, small team',        100000, 1000000, 14,
    '{"max_locations":1,"max_staff":5,"max_tables":20}',   '{}',                                                     true, true, false, 1),
  ('growth',  'Growth',  'Multiple locations, QR ordering', 250000, 2500000, 14,
    '{"max_locations":3,"max_staff":15,"max_tables":60}',  '{qr_ordering,reservations}',                             true, true, true,  2),
  ('pro',     'Pro',     'Larger groups, custom domain',    500000, 5000000, 14,
    '{"max_locations":10,"max_staff":100,"max_tables":500}', '{qr_ordering,reservations,custom_domain,advanced_reports}', true, true, false, 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Auth users (confirmed emails, shared local-only password; see README.md)
-- ---------------------------------------------------------------------------
create temp table seed_users (id uuid, email text, full_name text);
insert into seed_users values
  ('a0000000-0000-4000-8000-000000000001', 'admin@restomate.local',   'Platform Admin'),
  ('a0000000-0000-4000-8000-000000000011', 'owner@demo.local',        'Demo Owner'),
  ('a0000000-0000-4000-8000-000000000012', 'manager@demo.local',      'Demo Manager'),
  ('a0000000-0000-4000-8000-000000000013', 'cashier@demo.local',      'Demo Cashier'),
  ('a0000000-0000-4000-8000-000000000014', 'waiter@demo.local',       'Demo Waiter'),
  ('a0000000-0000-4000-8000-000000000015', 'kitchen@demo.local',      'Demo Kitchen'),
  ('a0000000-0000-4000-8000-000000000021', 'owner@other.local',       'Other Owner');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token
)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
       extensions.crypt('restomate-local-dev', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', u.full_name, 'email_verified', true),
       now(), now(), '', '', '', '', '', '', '', ''
from seed_users u
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       now(), now(), now()
from seed_users u
on conflict (provider_id, provider) do nothing;

insert into public.platform_admins (user_id)
values ('a0000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create function pg_temp.seed_system_roles(org uuid) returns void language sql as $$
  insert into public.roles (organization_id, key, name, description, is_system)
  select org, k.key, k.name, k.descr, true
  from (values
    ('owner',   'Owner',   'Full access, including billing'),
    ('manager', 'Manager', 'Runs day-to-day operations'),
    ('cashier', 'Cashier', 'Takes orders and payments'),
    ('waiter',  'Waiter',  'Takes and serves orders'),
    ('kitchen', 'Kitchen', 'Prepares orders')
  ) as k (key, name, descr);
  insert into public.role_permissions (role_id, organization_id, permission_key)
  select r.id, org, d.permission_key
  from public.roles r join public.default_role_permissions d on d.role_key = r.key
  where r.organization_id = org;
$$;

create function pg_temp.seed_member(org uuid, uid uuid, role_key text, all_locs boolean) returns uuid language sql as $$
  insert into public.organization_members (organization_id, user_id, role_id, status, all_locations)
  select org, uid, r.id, 'active', all_locs
  from public.roles r where r.organization_id = org and r.key = role_key
  returning id;
$$;

do $seed$
declare
  demo   constant uuid := 'de000000-0000-4000-8000-000000000001';
  other  constant uuid := 'de000000-0000-4000-8000-000000000002';
  v_cashier_member uuid;
  v_jaksel uuid;
begin
  -- ---- Demo Restaurant ------------------------------------------------------
  if not exists (select 1 from public.organizations where id = demo) then
    -- `demo` is a reserved slug; this seeded org owns it. Bypass only for this insert.
    alter table public.organizations disable trigger organizations_slug_not_reserved;
    insert into public.organizations (id, slug, name, currency, timezone, contact_email, created_by)
    values (demo, 'demo', 'Demo Restaurant', 'IDR', 'Asia/Jakarta', 'owner@demo.local',
            'a0000000-0000-4000-8000-000000000011');
    alter table public.organizations enable trigger organizations_slug_not_reserved;

    -- subscription first (limit triggers read it)
    insert into public.subscriptions (organization_id, package_id, status, billing_period,
                                      trial_ends_at, current_period_start, current_period_end)
    select demo, p.id, 'trialing', 'monthly', now() + make_interval(days => p.trial_days),
           now(), now() + make_interval(days => p.trial_days)
    from public.packages p where p.code = 'growth';

    perform pg_temp.seed_system_roles(demo);

    insert into public.locations (id, organization_id, name, address, city, phone, timezone, currency,
                                  tax_rate_bps, service_charge_bps, tax_on_service_charge)
    values
      ('de000000-0000-4000-8000-0000000000a1', demo, 'Jakarta Selatan', 'Jl. Senopati No. 10', 'Jakarta Selatan',
       '+62 21 5550 0101', 'Asia/Jakarta', 'IDR', 1000, 500, true),
      ('de000000-0000-4000-8000-0000000000a2', demo, 'Bandung', 'Jl. Braga No. 25', 'Bandung',
       '+62 22 5550 0202', 'Asia/Jakarta', 'IDR', 1000, 500, true);
    v_jaksel := 'de000000-0000-4000-8000-0000000000a1';

    perform pg_temp.seed_member(demo, 'a0000000-0000-4000-8000-000000000011', 'owner',   true);
    perform pg_temp.seed_member(demo, 'a0000000-0000-4000-8000-000000000012', 'manager', true);
    v_cashier_member := pg_temp.seed_member(demo, 'a0000000-0000-4000-8000-000000000013', 'cashier', false);
    perform pg_temp.seed_member(demo, 'a0000000-0000-4000-8000-000000000014', 'waiter',  true);
    perform pg_temp.seed_member(demo, 'a0000000-0000-4000-8000-000000000015', 'kitchen', true);

    -- the cashier works at Jakarta Selatan only
    insert into public.location_staff (member_id, location_id, organization_id)
    values (v_cashier_member, v_jaksel, demo);

    insert into public.org_branding (organization_id, primary_color, secondary_color, font, theme)
    values (demo, '#c2410c', '#1c1917', 'Inter', '{"radius":"md"}');

    perform private.write_audit(demo, 'a0000000-0000-4000-8000-000000000011', 'organization.seeded',
                                'organization', demo::text, '{"seed":true}');
  end if;

  -- ---- Other Bistro (cross-tenant target) -------------------------------------
  if not exists (select 1 from public.organizations where id = other) then
    insert into public.organizations (id, slug, name, currency, timezone, contact_email, created_by)
    values (other, 'other-bistro', 'Other Bistro', 'IDR', 'Asia/Jakarta', 'owner@other.local',
            'a0000000-0000-4000-8000-000000000021');

    insert into public.subscriptions (organization_id, package_id, status, billing_period,
                                      trial_ends_at, current_period_start, current_period_end)
    select other, p.id, 'trialing', 'monthly', now() + make_interval(days => p.trial_days),
           now(), now() + make_interval(days => p.trial_days)
    from public.packages p where p.code = 'starter';

    perform pg_temp.seed_system_roles(other);

    insert into public.locations (id, organization_id, name, address, city, timezone, currency,
                                  tax_rate_bps, service_charge_bps, tax_on_service_charge)
    values ('de000000-0000-4000-8000-0000000000b1', other, 'Bistro Main', 'Jl. Tebet Raya No. 5', 'Jakarta Selatan',
            'Asia/Jakarta', 'IDR', 1000, 0, true);

    perform pg_temp.seed_member(other, 'a0000000-0000-4000-8000-000000000021', 'owner', true);

    insert into public.org_branding (organization_id, primary_color, secondary_color, font, theme)
    values (other, '#0f766e', '#042f2e', 'Inter', '{}');

    perform private.write_audit(other, 'a0000000-0000-4000-8000-000000000021', 'organization.seeded',
                                'organization', other::text, '{"seed":true}');
  end if;

  -- ---- Venue: areas and tables (M2). QR tokens here are FIXED and readable for local/demo use only;
  --      at runtime they are random (private.new_qr_token) and rotated by rotate_table_qr_token. ----------------
  if not exists (select 1 from public.areas where organization_id = demo) then
    insert into public.areas (id, organization_id, location_id, name, sort_order) values
      ('de000000-0000-4000-8000-0000000001a1', demo, 'de000000-0000-4000-8000-0000000000a1', 'Indoor',  1),
      ('de000000-0000-4000-8000-0000000001a2', demo, 'de000000-0000-4000-8000-0000000000a1', 'Terrace', 2),
      ('de000000-0000-4000-8000-0000000001a3', demo, 'de000000-0000-4000-8000-0000000000a1', 'Bar',     3);

    insert into public.tables (organization_id, location_id, area_id, label, capacity, shape, pos_x, pos_y, qr_token)
    select demo, 'de000000-0000-4000-8000-0000000000a1', a.id, t.label, t.capacity, t.shape, t.pos_x, t.pos_y, 'demo-qr-' || lower(t.label)
    from (values
      ('Indoor',  'T1',  2, 'square', 1, 1), ('Indoor',  'T2',  2, 'square', 3, 1),
      ('Indoor',  'T3',  4, 'rect',   1, 3), ('Indoor',  'T4',  4, 'rect',   3, 3),
      ('Indoor',  'T5',  6, 'rect',   5, 2), ('Indoor',  'T6',  8, 'rect',   5, 5),
      ('Terrace', 'P1',  4, 'round',  8, 1), ('Terrace', 'P2',  4, 'round',  8, 3),
      ('Terrace', 'P3',  4, 'round',  8, 5), ('Terrace', 'P4',  6, 'round', 10, 3),
      ('Bar',     'B1',  2, 'square', 1, 8), ('Bar',     'B2',  2, 'square', 3, 8)
    ) as t(area, label, capacity, shape, pos_x, pos_y)
    join public.areas a on a.location_id = 'de000000-0000-4000-8000-0000000000a1' and a.name = t.area;
  end if;

  if not exists (select 1 from public.areas where organization_id = other) then
    insert into public.areas (id, organization_id, location_id, name, sort_order) values
      ('de000000-0000-4000-8000-0000000001b1', other, 'de000000-0000-4000-8000-0000000000b1', 'Main Hall', 1);
    insert into public.tables (organization_id, location_id, area_id, label, capacity, shape, pos_x, pos_y, qr_token) values
      (other, 'de000000-0000-4000-8000-0000000000b1', 'de000000-0000-4000-8000-0000000001b1', 'M1', 2, 'square', 1, 1, 'other-qr-m1'),
      (other, 'de000000-0000-4000-8000-0000000000b1', 'de000000-0000-4000-8000-0000000001b1', 'M2', 4, 'round',  3, 1, 'other-qr-m2'),
      (other, 'de000000-0000-4000-8000-0000000000b1', 'de000000-0000-4000-8000-0000000001b1', 'M3', 6, 'rect',   5, 1, 'other-qr-m3');
  end if;
  -- ---- Menu (M2): Indonesian menu in IDR (whole Rupiah). Fixed ids only for categories/stations; the rest join by name.
  if not exists (select 1 from public.menu_categories where organization_id = demo) then
    insert into public.menu_categories (id, organization_id, name, description, sort_order) values
      ('de000000-0000-4000-8000-0000000002c1', demo, 'Makanan',  'Hidangan utama khas Nusantara', 1),
      ('de000000-0000-4000-8000-0000000002c2', demo, 'Camilan',  'Teman ngobrol',                 2),
      ('de000000-0000-4000-8000-0000000002c3', demo, 'Minuman',  'Panas dan dingin',              3),
      ('de000000-0000-4000-8000-0000000002c4', demo, 'Dessert',  'Penutup manis',                 4);

    insert into public.kitchen_stations (id, organization_id, location_id, name, sort_order) values
      ('de000000-0000-4000-8000-0000000003a1', demo, 'de000000-0000-4000-8000-0000000000a1', 'Dapur', 1),
      ('de000000-0000-4000-8000-0000000003a2', demo, 'de000000-0000-4000-8000-0000000000a1', 'Bar',   2),
      ('de000000-0000-4000-8000-0000000003a3', demo, 'de000000-0000-4000-8000-0000000000a2', 'Dapur', 1),
      ('de000000-0000-4000-8000-0000000003a4', demo, 'de000000-0000-4000-8000-0000000000a2', 'Bar',   2);

    insert into public.menu_items (organization_id, category_id, name, description, base_price, dietary_tags, is_published, sort_order)
    select demo, c.id, i.name, i.descr, i.price, i.tags, true, i.ord
    from (values
      ('Makanan', 'Nasi Goreng Kampung', 'Nasi goreng bumbu terasi, telur, ayam suwir dan acar',        35000, array['halal']::text[],                  1),
      ('Makanan', 'Mie Goreng Jawa',     'Mie goreng manis gurih dengan sayuran dan bakso',             33000, array['halal']::text[],                  2),
      ('Makanan', 'Ayam Bakar Taliwang', 'Ayam bakar bumbu Lombok, pedas, dengan plecing kangkung',     48000, array['halal','spicy']::text[],          3),
      ('Makanan', 'Soto Ayam Lamongan',  'Soto kuning dengan koya, telur rebus dan sambal',              32000, array['halal']::text[],                  4),
      ('Makanan', 'Rendang Sapi',        'Rendang sapi empuk dengan nasi putih dan daun singkong',       58000, array['halal','spicy']::text[],          5),
      ('Makanan', 'Gado-Gado',           'Sayuran rebus, tahu, tempe, lontong, saus kacang',             28000, array['vegetarian','contains_nuts']::text[], 6),
      ('Camilan', 'Pisang Goreng',       'Pisang kepok goreng krispi, 5 potong',                         18000, array['vegetarian']::text[],             1),
      ('Camilan', 'Tahu Crispy',         'Tahu goreng tepung dengan sambal kecap',                       20000, array['vegetarian']::text[],             2),
      ('Camilan', 'Tempe Mendoan',       'Tempe tipis berbumbu daun bawang, 4 potong',                   16000, array['vegan','halal']::text[],          3),
      ('Camilan', 'Kentang Goreng',      'Kentang goreng dengan saus sambal dan mayones',                22000, array['vegetarian']::text[],             4),
      ('Camilan', 'Lumpia Semarang',     'Lumpia isi rebung dan ayam, 3 potong',                         24000, array['halal']::text[],                  5),
      ('Minuman', 'Es Teh Manis',        'Teh melati dingin dengan gula',                                 8000, array['vegan']::text[],                  1),
      ('Minuman', 'Es Jeruk',            'Perasan jeruk peras segar',                                    12000, array['vegan']::text[],                  2),
      ('Minuman', 'Kopi Susu Gula Aren', 'Espresso, susu segar dan gula aren',                           24000, array['vegetarian']::text[],             3),
      ('Minuman', 'Es Kelapa Muda',      'Kelapa muda utuh dengan sirup',                                18000, array['vegan']::text[],                  4),
      ('Minuman', 'Wedang Jahe',         'Jahe, sereh dan gula batu, hangat',                            14000, array['vegan']::text[],                  5),
      ('Minuman', 'Air Mineral',         'Botol 600 ml',                                                  6000, array['vegan']::text[],                  6),
      ('Dessert', 'Es Cendol',           'Cendol, santan, gula merah dan nangka',                        16000, array['vegetarian']::text[],             1),
      ('Dessert', 'Klepon',              'Kue ketan isi gula merah, parutan kelapa, 5 buah',             15000, array['vegan']::text[],                  2),
      ('Dessert', 'Pisang Bakar Coklat', 'Pisang bakar, coklat, keju dan susu',                          20000, array['vegetarian']::text[],             3),
      ('Dessert', 'Es Teler',            'Alpukat, kelapa muda, nangka, susu dan sirup',                 22000, array['vegetarian']::text[],             4)
    ) as i(cat, name, descr, price, tags, ord)
    join public.menu_categories c on c.organization_id = demo and c.name = i.cat;

    -- an unpublished draft: must never reach the public menu
    insert into public.menu_items (organization_id, category_id, name, base_price, is_published, sort_order)
    values (demo, 'de000000-0000-4000-8000-0000000002c1', 'Menu Musiman (draft)', 99000, false, 99);

    insert into public.item_variants (organization_id, item_id, name, price_delta, sort_order)
    select demo, i.id, v.name, v.delta, v.ord
    from (values
      ('Es Teh Manis',        'Regular', 0,     1), ('Es Teh Manis',        'Large',  4000, 2),
      ('Kopi Susu Gula Aren', 'Regular', 0,     1), ('Kopi Susu Gula Aren', 'Large',  6000, 2),
      ('Es Jeruk',            'Regular', 0,     1), ('Es Jeruk',            'Large',  4000, 2),
      ('Nasi Goreng Kampung', 'Reguler', 0,     1), ('Nasi Goreng Kampung', 'Jumbo',  10000, 2),
      ('Soto Ayam Lamongan',  'Mangkok', 0,     1), ('Soto Ayam Lamongan',  'Porsi Besar', 8000, 2)
    ) as v(item, name, delta, ord)
    join public.menu_items i on i.organization_id = demo and i.name = v.item;

    insert into public.modifier_groups (id, organization_id, name, min_select, max_select, sort_order) values
      ('de000000-0000-4000-8000-0000000004a1', demo, 'Level pedas', 0, 1, 1),
      ('de000000-0000-4000-8000-0000000004a2', demo, 'Tambahan',    0, 3, 2);
    insert into public.modifiers (organization_id, group_id, name, price_delta, sort_order) values
      (demo, 'de000000-0000-4000-8000-0000000004a1', 'Tidak pedas', 0, 1),
      (demo, 'de000000-0000-4000-8000-0000000004a1', 'Sedang',      0, 2),
      (demo, 'de000000-0000-4000-8000-0000000004a1', 'Pedas',       0, 3),
      (demo, 'de000000-0000-4000-8000-0000000004a1', 'Extra pedas', 0, 4),
      (demo, 'de000000-0000-4000-8000-0000000004a2', 'Telur mata sapi', 5000, 1),
      (demo, 'de000000-0000-4000-8000-0000000004a2', 'Keju',            6000, 2),
      (demo, 'de000000-0000-4000-8000-0000000004a2', 'Kerupuk',         3000, 3),
      (demo, 'de000000-0000-4000-8000-0000000004a2', 'Sambal ekstra',   2000, 4);
    insert into public.menu_item_modifier_groups (organization_id, item_id, group_id, sort_order)
    select demo, i.id, g.gid, g.ord
    from public.menu_items i
    join (values
      ('Nasi Goreng Kampung', 'de000000-0000-4000-8000-0000000004a1'::uuid, 1),
      ('Nasi Goreng Kampung', 'de000000-0000-4000-8000-0000000004a2'::uuid, 2),
      ('Mie Goreng Jawa',     'de000000-0000-4000-8000-0000000004a1'::uuid, 1),
      ('Mie Goreng Jawa',     'de000000-0000-4000-8000-0000000004a2'::uuid, 2),
      ('Ayam Bakar Taliwang', 'de000000-0000-4000-8000-0000000004a1'::uuid, 1),
      ('Soto Ayam Lamongan',  'de000000-0000-4000-8000-0000000004a2'::uuid, 1)
    ) as g(item, gid, ord) on i.name = g.item and i.organization_id = demo;

    -- drinks are made at the Bar, food in the Dapur (both locations); Bandung charges a bit more for coffee,
    -- and Es Kelapa Muda is out of stock there.
    insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id, price_override, is_available)
    select demo, l.loc, i.id,
           case when c.name = 'Minuman' then l.bar else l.dapur end,
           case when l.loc = 'de000000-0000-4000-8000-0000000000a2' and i.name = 'Kopi Susu Gula Aren' then 26000 end,
           not (l.loc = 'de000000-0000-4000-8000-0000000000a2' and i.name = 'Es Kelapa Muda')
    from (values
      ('de000000-0000-4000-8000-0000000000a1'::uuid, 'de000000-0000-4000-8000-0000000003a1'::uuid, 'de000000-0000-4000-8000-0000000003a2'::uuid),
      ('de000000-0000-4000-8000-0000000000a2'::uuid, 'de000000-0000-4000-8000-0000000003a3'::uuid, 'de000000-0000-4000-8000-0000000003a4'::uuid)
    ) as l(loc, dapur, bar)
    cross join public.menu_items i
    join public.menu_categories c on c.id = i.category_id
    where i.organization_id = demo and i.is_published;
  end if;

  if not exists (select 1 from public.menu_categories where organization_id = other) then
    insert into public.menu_categories (id, organization_id, name, sort_order) values
      ('de000000-0000-4000-8000-0000000002d1', other, 'Mains',  1),
      ('de000000-0000-4000-8000-0000000002d2', other, 'Drinks', 2);
    insert into public.kitchen_stations (id, organization_id, location_id, name) values
      ('de000000-0000-4000-8000-0000000003b1', other, 'de000000-0000-4000-8000-0000000000b1', 'Kitchen');
    insert into public.menu_items (organization_id, category_id, name, description, base_price, dietary_tags, is_published, sort_order) values
      (other, 'de000000-0000-4000-8000-0000000002d1', 'Bistro Burger',  'Beef patty, cheddar, house sauce', 65000, array['halal']::text[], true, 1),
      (other, 'de000000-0000-4000-8000-0000000002d1', 'Mushroom Pasta', 'Creamy mushroom linguine',        58000, array['vegetarian']::text[], true, 2),
      (other, 'de000000-0000-4000-8000-0000000002d1', 'Caesar Salad',   'Romaine, parmesan, croutons',     45000, array[]::text[], true, 3),
      (other, 'de000000-0000-4000-8000-0000000002d2', 'Lemonade',       'Fresh lemon, mint',               22000, array['vegan']::text[], true, 1),
      (other, 'de000000-0000-4000-8000-0000000002d2', 'Iced Latte',     'Double shot, milk, ice',          30000, array['vegetarian']::text[], true, 2);
    insert into public.item_variants (organization_id, item_id, name, price_delta, sort_order)
    select other, i.id, v.name, v.delta, v.ord from public.menu_items i
    cross join (values ('Regular', 0, 1), ('Large', 7000, 2)) as v(name, delta, ord)
    where i.organization_id = other and i.name = 'Iced Latte';
    insert into public.modifier_groups (id, organization_id, name, min_select, max_select) values
      ('de000000-0000-4000-8000-0000000004b1', other, 'Extras', 0, 2);
    insert into public.modifiers (organization_id, group_id, name, price_delta) values
      (other, 'de000000-0000-4000-8000-0000000004b1', 'Extra cheese', 8000),
      (other, 'de000000-0000-4000-8000-0000000004b1', 'Bacon',        12000);
    insert into public.menu_item_modifier_groups (organization_id, item_id, group_id)
    select other, i.id, 'de000000-0000-4000-8000-0000000004b1' from public.menu_items i
    where i.organization_id = other and i.name = 'Bistro Burger';
    insert into public.location_menu_overrides (organization_id, location_id, item_id, kitchen_station_id)
    select other, 'de000000-0000-4000-8000-0000000000b1', i.id, 'de000000-0000-4000-8000-0000000003b1'
    from public.menu_items i where i.organization_id = other;
  end if;
end
$seed$;

drop table seed_users;
