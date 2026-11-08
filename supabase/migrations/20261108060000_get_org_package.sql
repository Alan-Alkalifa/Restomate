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
