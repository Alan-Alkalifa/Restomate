-- B1-T21 (BUG-70-1): the org-wide active table count for the "used / max" display.
-- A location-scoped member only sees their own locations' tables through RLS, so counting client-side under-reports.
-- This returns ONLY a number (no rows), and only to members of the org. The tables trigger remains the enforcement.
create or replace function public.org_active_table_count(org_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := org_active_table_count.org_id;
begin
  -- Unknown org and non-member look the same.
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return (select count(*)::int from public.tables t where t.organization_id = v_org and t.is_active);
end;
$$;

revoke execute on function public.org_active_table_count(uuid) from public, anon, authenticated;
grant execute on function public.org_active_table_count(uuid) to authenticated;
