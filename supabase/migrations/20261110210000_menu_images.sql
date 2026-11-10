-- MVM-T13 (M2 §6): menu images — Storage bucket, org-folder policies, strict image_path check.
--  * Bucket `menu-images`: public read (storefront shows the images), 2 MiB limit, jpeg/png/webp only.
--  * Writes only to `{organization_id}/items/{item_id}/{name}.(webp|jpg|png)` where the item belongs to that org,
--    for users with menu.manage in it. No anon writes (no policy for anon). Size and MIME limits are enforced by
--    Storage from the bucket row.
--  * menu_items.image_path must point into the item's own folder.
-- The storage schema belongs to Storage (its tables only exist once the Storage service has run), so the bucket and
-- policies are skipped when it is absent (e.g. a CI database started without storage-api); they apply on hosted
-- projects and on a full local stack.

-- Strict image_path: `{organization_id}/items/{id}/{name}.(webp|jpg|png)` (the generic format check stays as well).
alter table public.menu_items add constraint menu_items_image_path_own_folder check (
  image_path is null
  or image_path ~ ('^' || organization_id::text || '/items/' || id::text || '/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$'));

do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: skipping the menu-images bucket and policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-images', 'menu-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- Only a path of the exact shape, in an org folder where the caller has menu.manage and for an item of that org.
  -- CASE guarantees the uuid casts only run on well-formed folder names.
  execute $p$
    create policy menu_images_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'menu-images'
      and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$'
      and case when name ~ '^[0-9a-f-]{36}/items/[0-9a-f-]{36}/' then
            public.has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage')
            -- objects.name is qualified on purpose: inside this subquery a bare `name` would be menu_items.name
            and exists (select 1 from public.menu_items i
                        where i.id = ((storage.foldername(objects.name))[3])::uuid
                          and i.organization_id = ((storage.foldername(objects.name))[1])::uuid)
          else false end
    )
  $p$;

  -- Read (needed by Storage to find an object before deleting or replacing it), update and delete: same org folder.
  execute $p$
    create policy menu_images_select on storage.objects for select to authenticated
    using (
      bucket_id = 'menu-images'
      and case when name ~ '^[0-9a-f-]{36}/' then
            public.has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage')
          else false end
    )
  $p$;
  execute $p$
    create policy menu_images_update on storage.objects for update to authenticated
    using (
      bucket_id = 'menu-images'
      and case when name ~ '^[0-9a-f-]{36}/' then
            public.has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage')
          else false end
    )
    with check (
      bucket_id = 'menu-images'
      and name ~ '^[0-9a-f-]{36}/items/[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$'
      and case when name ~ '^[0-9a-f-]{36}/' then
            public.has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage')
          else false end
    )
  $p$;
  execute $p$
    create policy menu_images_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'menu-images'
      and case when name ~ '^[0-9a-f-]{36}/' then
            public.has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage')
          else false end
    )
  $p$;
end
$storage$;
