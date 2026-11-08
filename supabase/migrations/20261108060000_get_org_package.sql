-- MF-T07: package info for any active member of an organization.
-- subscriptions / packages are readable only with billing.manage (RLS), but the dashboard must know the
-- plan's features and limits for every member to render locked features. This SECURITY DEFINER function
-- exposes only code, name, features and limits (no prices, no subscription row) and only to members.
create or replace function public.get_org_package(org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'features', to_jsonb(p.features),
    'limits', p.limits)
  from public.subscriptions s
  join public.packages p on p.id = s.package_id
  where s.organization_id = org
    and s.status in ('trialing', 'active', 'past_due')
    and public.is_org_member_any_status(org)
  limit 1;
$$;
revoke execute on function public.get_org_package(uuid) from public, anon;
grant execute on function public.get_org_package(uuid) to authenticated;

-- The caller's own ACTIVE membership in the organization with this slug, returned regardless of the org's status
-- (suspended orgs hide their rows from members through RLS, but the dashboard must still show a "suspended"
-- notice instead of a 404). Returns only the caller's own membership plus the org's identity fields and the role
-- name/key; nothing about other members. NULL for unknown slug, non-member or deactivated member (indistinguishable).
create or replace function public.my_org_membership(org_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'all_locations', m.all_locations,
    'org', jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'name', o.name, 'status', o.status,
      'currency', o.currency, 'timezone', o.timezone),
    'role', jsonb_build_object('key', r.key, 'name', r.name))
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  join public.roles r on r.id = m.role_id
  where o.slug = lower(org_slug)
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;
revoke execute on function public.my_org_membership(text) from public, anon;
grant execute on function public.my_org_membership(text) to authenticated;
