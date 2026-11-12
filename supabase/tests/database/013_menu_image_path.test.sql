-- MVM-T13: menu_items.image_path must point into the item's own folder (always runs; no Storage needed).
begin;
select plan(11);

create function pg_temp.org() returns uuid language sql as $$ select id from public.organizations where slug = 'demo' $$;
create function pg_temp.other_org() returns uuid language sql as $$ select id from public.organizations where slug = 'other-bistro' $$;
create function pg_temp.item(n text) returns uuid language sql as $$ select id from public.menu_items where name = n and organization_id = pg_temp.org() $$;

select lives_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.org() || '/items/' || pg_temp.item('Es Jeruk') || '/photo_01.webp', pg_temp.item('Es Jeruk')), 'an item can point at a file in its own folder');
select lives_ok(format($$update public.menu_items set image_path = null where id = %L$$, pg_temp.item('Es Jeruk')), 'image_path can be cleared');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.other_org() || '/items/' || pg_temp.item('Es Jeruk') || '/photo_01.webp', pg_temp.item('Es Jeruk')), '23514', null, 'image_path cannot point into another org''s folder');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.org() || '/items/' || pg_temp.item('Es Teh Manis') || '/photo_01.webp', pg_temp.item('Es Jeruk')), '23514', null, 'image_path cannot point at another item''s folder (same org)');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.org() || '/items/' || pg_temp.item('Es Jeruk') || '/photo.gif', pg_temp.item('Es Jeruk')), '23514', null, 'only webp/jpg/png files are accepted');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.org() || '/items/' || pg_temp.item('Es Jeruk') || '/../x.webp', pg_temp.item('Es Jeruk')), '23514', null, 'path traversal is rejected');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  '/' || pg_temp.org() || '/items/' || pg_temp.item('Es Jeruk') || '/a.webp', pg_temp.item('Es Jeruk')), '23514', null, 'a leading slash is rejected');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  'https://evil.test/a.webp', pg_temp.item('Es Jeruk')), '23514', null, 'a URL is rejected');
select throws_ok(format($$update public.menu_items set image_path = %L where id = %L$$,
  pg_temp.org() || '/items/' || pg_temp.item('Es Jeruk') || '/' || repeat('a', 65) || '.webp', pg_temp.item('Es Jeruk')), '23514', null, 'file names over 64 characters are rejected');
select lives_ok(format($$insert into public.menu_items (id, organization_id, category_id, name, base_price, image_path)
  values (%L, %L, (select category_id from public.menu_items where id = %L), 'ZImg', 1, %L)$$,
  '00000000-0000-4000-8000-0000000000aa', pg_temp.org(), pg_temp.item('Es Jeruk'), pg_temp.org() || '/items/00000000-0000-4000-8000-0000000000aa/z.png'), 'an insert with its own folder is fine');
select is((select count(*)::int from public.menu_items where image_path is not null and image_path like pg_temp.org()::text || '/items/' || id::text || '/%' and organization_id = pg_temp.org()), 7,
  'the six sample items and the new item all point into their own folder');

select * from finish();
rollback;
