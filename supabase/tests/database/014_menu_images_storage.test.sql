-- MVM-T13: menu-images bucket config and storage.objects policies.
-- The `storage` tables ship with the Supabase database image, so these run in CI even without the storage-api
-- container. They skip themselves only if the storage schema is absent entirely.
select to_regclass('storage.objects') is not null
   and (select count(*) from pg_policies where schemaname = 'storage' and policyname = 'menu_images_insert') > 0 as has_storage \gset
\if :has_storage
begin;
select plan(26);

insert into public.packages (code, name, limits) values ('t-img', 'Images', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@i.test', now(), now(), now()
from generate_series(1, 6) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.item(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n $$;
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create function pg_temp.obj(s text, n text, f text) returns text language sql security definer as $$
  select pg_temp.org(s)::text || '/items/' || pg_temp.item(n)::text || '/' || f $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Img A', 'img-a', '{"name":"L1"}'::jsonb, null, 't-img');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select public.create_organization('Img B', 'img-b', '{"name":"B1"}'::jsonb, null, 't-img');
reset role;
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('img-a'), pg_temp.uid(2), pg_temp.role('img-a', 'manager'), true),
  (pg_temp.org('img-a'), pg_temp.uid(3), pg_temp.role('img-a', 'cashier'), true);
insert into public.menu_categories (organization_id, name) values (pg_temp.org('img-a'), 'ZC'), (pg_temp.org('img-b'), 'ZCB');
insert into public.menu_items (organization_id, category_id, name, base_price) values
  (pg_temp.org('img-a'), (select id from public.menu_categories where name = 'ZC'), 'ZImgA', 1000),
  (pg_temp.org('img-b'), (select id from public.menu_categories where name = 'ZCB'), 'ZImgB', 1000);

-- ---- bucket configuration (Storage enforces size and MIME from this row) -----------------------------------------
select is((select public from storage.buckets where id = 'menu-images'), true, 'menu-images is public-read');
select is((select file_size_limit from storage.buckets where id = 'menu-images'), 2097152::bigint, 'the size limit is 2 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'menu-images'), array['image/jpeg', 'image/png', 'image/webp'], 'only jpeg, png and webp are allowed');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and policyname like 'menu_images_%' and 'anon' = any (roles)), 0, 'no policy grants anon anything on menu-images');

-- ---- insert -----------------------------------------------------------------------------------------------------------
-- Storage blocks direct deletes unless this flag is set (the Storage API sets it itself); policies still apply.
set local storage.allow_delete_query = 'true';

select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', 'abc12345.webp')), 'manager uploads into their own item folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-b', 'ZImgB', 'abc12345.webp')), '42501', null, 'manager A cannot upload into org B''s folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.org('img-a')::text || '/items/' || pg_temp.item('ZImgB') || '/abc12345.webp'), '42501', null, 'cannot upload for another org''s item inside own folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.org('img-a')::text || '/items/' || gen_random_uuid() || '/abc12345.webp'), '42501', null, 'cannot upload for an item that does not exist');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', 'abc12345.gif')), '42501', null, 'a non-image extension is rejected');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', '../abc12345.webp')), '42501', null, 'path traversal is rejected');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.org('img-a')::text || '/misc/abc12345.webp'), '42501', null, 'files outside {org}/items/{item}/ are rejected');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('menu-images', 'not-a-uuid/items/also-not/abc12345.webp')$$, '42501', null, 'a malformed org folder is denied, not an error');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', 'cashier01.webp')), '42501', null, 'cashier (no menu.manage) cannot upload');
reset role;
set local role anon;
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', 'anon0001.webp')), '42501', null, 'anon cannot upload');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-b', 'ZImgB', 'bbbb1234.png')), 'owner B uploads into their own folder');
reset role;

-- ---- read / update / delete -------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images' and name like pg_temp.org('img-a')::text || '/%'), 1, 'manager A sees their own object');
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images' and name like pg_temp.org('img-b')::text || '/%'), 0, 'manager A cannot list org B''s objects');
select throws_ok(format($$update storage.objects set name = %L where name = %L$$, pg_temp.obj('img-b', 'ZImgB', 'moved001.webp'), pg_temp.obj('img-a', 'ZImgA', 'abc12345.webp')), '42501', null, 'cannot move an object into another org''s folder');
select is(pg_temp.affected(format($$delete from storage.objects where name = %L$$, pg_temp.obj('img-b', 'ZImgB', 'bbbb1234.png'))), 0, 'manager A cannot delete org B''s object');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images'), 0, 'cashier cannot list menu images through the API');
select is(pg_temp.affected(format($$delete from storage.objects where name = %L$$, pg_temp.obj('img-a', 'ZImgA', 'abc12345.webp'))), 0, 'cashier cannot delete');
reset role;
select pg_temp.act_as(pg_temp.uid(5));
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images' and name like pg_temp.org('img-a')::text || '/%'), 0, 'owner B cannot see org A''s objects');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'menu-images'), 0, 'anon cannot list objects (public URLs work without listing)');
select is(pg_temp.affected(format($$delete from storage.objects where name = %L$$, pg_temp.obj('img-a', 'ZImgA', 'abc12345.webp'))), 0, 'anon cannot delete');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select is(pg_temp.affected(format($$delete from storage.objects where name = %L$$, pg_temp.obj('img-a', 'ZImgA', 'abc12345.webp'))), 1, 'manager A can delete their own object');
reset role;

-- ---- suspended org ----------------------------------------------------------------------------------------------------
update public.organizations set status = 'suspended' where id = pg_temp.org('img-a');
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-images', %L)$$, pg_temp.obj('img-a', 'ZImgA', 'suspend01.webp')), '42501', null, 'a suspended org cannot upload');
reset role;

select * from finish();
rollback;
\else
begin;
select plan(1);
select skip('the storage schema is not present; skipping menu-images policy tests', 1);
select * from finish();
rollback;
\endif
