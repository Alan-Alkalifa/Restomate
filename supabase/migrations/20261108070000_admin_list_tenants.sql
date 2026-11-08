-- MF-T22: tenant list for the super admin area.
-- SECURITY DEFINER because it needs auth-adjacent joins (owner e-mail from profiles, counts across RLS-protected
-- tables). The very first statement checks is_platform_admin(); platform_admins is the only source of access.
-- Returns {rows: [...], total: n}. `q` is matched case-insensitively against name/slug with %, _ and \ escaped.
create or replace function public.admin_list_tenants(
  q text default null,
  status_filter text default null,
  package_code text default null,
  page_size integer default 25,
  page_offset integer default 0,
  org_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(trim(coalesce(admin_list_tenants.q, '')), '');
  v_size   integer := least(greatest(coalesce(admin_list_tenants.page_size, 25), 1), 100);
  v_offset integer := greatest(coalesce(admin_list_tenants.page_offset, 0), 0);
  v_pat    text;
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if admin_list_tenants.status_filter is not null
     and admin_list_tenants.status_filter not in ('active', 'suspended', 'past_due', 'read_only') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if v_q is not null then
    v_pat := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select
      o.id, o.slug, o.name, o.status, o.created_at,
      sub.status as sub_status, sub.trial_ends_at, p.code as pkg_code, p.name as pkg_name
    from public.organizations o
    left join lateral (
      select s.* from public.subscriptions s
      where s.organization_id = o.id
      order by (s.status in ('trialing', 'active', 'past_due')) desc, s.created_at desc
      limit 1
    ) sub on true
    left join public.packages p on p.id = sub.package_id
    where (admin_list_tenants.org_id is null or o.id = admin_list_tenants.org_id)
      and (admin_list_tenants.status_filter is null or o.status = admin_list_tenants.status_filter)
      and (admin_list_tenants.package_code is null or p.code = admin_list_tenants.package_code)
      and (v_pat is null or lower(o.name) like v_pat escape '\' or lower(o.slug) like v_pat escape '\')
  ),
  page as (
    select * from base order by created_at desc, id limit v_size offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'slug', g.slug, 'name', g.name, 'status', g.status,
        'packageCode', g.pkg_code, 'packageName', g.pkg_name,
        'subscriptionStatus', g.sub_status, 'trialEndsAt', g.trial_ends_at,
        'locationsCount', (select count(*) from public.locations l where l.organization_id = g.id),
        'membersCount', (select count(*) from public.organization_members m
                         where m.organization_id = g.id and m.status = 'active'),
        'ownerEmail', (select pr.email
                       from public.organization_members m
                       join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
                       join public.profiles pr on pr.id = m.user_id
                       where m.organization_id = g.id and r.key = 'owner' and r.is_system
                       order by m.joined_at, m.id limit 1),
        'createdAt', g.created_at
      ) order by g.created_at desc, g.id)
      from page g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_list_tenants(text, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.admin_list_tenants(text, text, text, integer, integer, uuid) to authenticated;
