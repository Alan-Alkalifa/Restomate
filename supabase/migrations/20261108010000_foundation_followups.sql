-- Follow-ups to 20261108000000_foundation_core.sql (already merged; not edited).

-- 1. profiles: co-member profile reads (email, phone) only for staff.manage.
--    Own row and platform admins unchanged. The staff list is the only screen
--    that needs other people's profiles.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1 from public.organization_members m
      where m.user_id = profiles.id
        and public.has_permission(m.organization_id, 'staff.manage')
    )
  );

-- 2. organization_members: no client deletes. Removal = status 'deactivated'
--    (keeps the audit trail; works with the last-owner trigger in MF-T04).
drop policy organization_members_delete on public.organization_members;
revoke delete on public.organization_members from authenticated;

-- 3. platform_settings: RLS was on with no policy. Make the "no client access"
--    intent explicit with a restrictive deny-all policy (service role and
--    definer functions bypass RLS as before).
create policy platform_settings_no_client_access on public.platform_settings
  as restrictive
  for all to anon, authenticated
  using (false)
  with check (false);

-- Seeding note (MF-T05): the Demo Restaurant slug 'demo' is reserved. seed.sql runs
-- as postgres (table owner) and should disable trigger organizations_slug_not_reserved
-- around the Demo insert, then re-enable it. No schema-level bypass exists.
