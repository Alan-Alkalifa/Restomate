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

-- 4. Suspended org: a member must not read their own organization_members row
--    either (only the organizations row stays readable, see organizations_select).
-- 5. No self-escalation of scope: a non-owner staff.manage holder cannot change
--    their OWN membership row (role, status, all_locations) nor add/remove their
--    own location_staff rows. Owners, and other staff.manage holders, still can.
-- Definer helper so the members policy can check the org status without
-- re-entering organizations RLS (which reads organization_members).
create or replace function public.is_org_active(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.organizations o where o.id = org and o.status <> 'suspended');
$$;
revoke execute on function public.is_org_active(uuid) from public, anon;
grant execute on function public.is_org_active(uuid) to authenticated;

-- Membership regardless of org suspension (for the organizations row only).
create or replace function public.is_org_member_any_status(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;
revoke execute on function public.is_org_member_any_status(uuid) from public, anon;
grant execute on function public.is_org_member_any_status(uuid) to authenticated;

drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_platform_admin() or public.is_org_member_any_status(id));

drop policy organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    (
      user_id = (select auth.uid())
      and public.is_org_active(organization_id)
    )
    or public.is_org_member(organization_id)
    or public.is_platform_admin()
  );

drop policy organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (
    public.has_permission(organization_id, 'staff.manage')
    and (user_id <> (select auth.uid()) or public.is_org_owner(organization_id))
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = organization_members.role_id and r.is_system and r.key = 'owner'
      )
    )
  )
  with check (
    public.has_permission(organization_id, 'staff.manage')
    and (user_id <> (select auth.uid()) or public.is_org_owner(organization_id))
    and (
      public.is_org_owner(organization_id)
      or not exists (
        select 1 from public.roles r
        where r.id = organization_members.role_id and r.is_system and r.key = 'owner'
      )
    )
  );

drop policy location_staff_insert on public.location_staff;
create policy location_staff_insert on public.location_staff
  for insert to authenticated
  with check (
    public.has_permission(organization_id, 'staff.manage')
    and exists (
      select 1 from public.organization_members m
      where m.id = location_staff.member_id
        and m.organization_id = location_staff.organization_id
        and (m.user_id <> (select auth.uid()) or public.is_org_owner(m.organization_id))
    )
  );

drop policy location_staff_delete on public.location_staff;
create policy location_staff_delete on public.location_staff
  for delete to authenticated
  using (
    public.has_permission(organization_id, 'staff.manage')
    and exists (
      select 1 from public.organization_members m
      where m.id = location_staff.member_id
        and m.organization_id = location_staff.organization_id
        and (m.user_id <> (select auth.uid()) or public.is_org_owner(m.organization_id))
    )
  );

-- 6. has_permission fails closed: a key that is not in the permission catalog is
--    false for everyone, owners included.
create or replace function public.has_permission(org uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.permissions p where p.key = perm)
    and exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id and o.status <> 'suspended'
      join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
      where m.organization_id = org
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and (
          (r.is_system and r.key = 'owner')
          or exists (
            select 1 from public.role_permissions rp
            where rp.role_id = r.id and rp.permission_key = perm
          )
        )
    );
$$;
