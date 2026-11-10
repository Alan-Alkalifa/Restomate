-- MSS-T05: super admin tenant detail + owner password-reset preparation.
-- Both functions: security definer, search_path = '', execute for authenticated only, is_platform_admin() re-check.

-- One statement = one snapshot, so the counts agree with each other.
-- Usage definitions are the plan-limit trigger definitions (foundation_triggers / venue_schema):
--   max_locations / max_tables: active rows; max_staff: private.staff_count (active members + pending invitations).
-- Limits come from private.org_limit (NULL = unlimited; 0 when the org has no live subscription, as the triggers see it).
create or replace function public.admin_get_tenant_detail(org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status, 'createdAt', o.created_at),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone,
                                          'currency', l.currency, 'isActive', l.is_active)
                       order by l.is_active desc, l.name)
        from public.locations l where l.organization_id = o.id), '[]'::jsonb),
    'subscription', (
      select to_jsonb(x) from (
        select s.id, pk.code as "packageCode", pk.name as "packageName", s.status,
               s.billing_period as "billingPeriod", s.trial_ends_at as "trialEndsAt",
               s.current_period_end as "currentPeriodEnd", s.canceled_at as "canceledAt", s.created_at as "createdAt"
          from public.subscriptions s join public.packages pk on pk.id = s.package_id
         where s.organization_id = o.id
         order by (s.status = 'canceled'), s.created_at desc, s.id limit 1) x),
    'subscriptionHistory', coalesce((
      select jsonb_agg(to_jsonb(x) order by x."createdAt" desc, x.id) from (
        select s.id, pk.code as "packageCode", pk.name as "packageName", s.status,
               s.billing_period as "billingPeriod", s.trial_ends_at as "trialEndsAt",
               s.current_period_end as "currentPeriodEnd", s.canceled_at as "canceledAt", s.created_at as "createdAt"
          from public.subscriptions s join public.packages pk on pk.id = s.package_id
         where s.organization_id = o.id) x), '[]'::jsonb),
    'usage', jsonb_build_object(
      'max_locations', jsonb_build_object(
        'used', (select count(*) from public.locations l where l.organization_id = o.id and l.is_active),
        'limit', private.org_limit(o.id, 'max_locations')),
      'max_staff', jsonb_build_object(
        'used', private.staff_count(o.id, null, null),
        'limit', private.org_limit(o.id, 'max_staff')),
      'max_tables', jsonb_build_object(
        'used', (select count(*) from public.tables t where t.organization_id = o.id and t.is_active),
        'limit', private.org_limit(o.id, 'max_tables')),
      'max_orders_per_month', jsonb_build_object(
        'used', 0, -- not tracked until M3 creates orders
        'limit', private.org_limit(o.id, 'max_orders_per_month'))),
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', p.full_name, 'email', p.email)
                       order by m.joined_at, m.user_id)
        from public.organization_members m
        join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id and r.is_system and r.key = 'owner'
        join public.profiles p on p.id = m.user_id
       where m.organization_id = o.id and m.status = 'active' and p.email is not null), '[]'::jsonb),
    'auditTrail', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'action', a.action, 'actorName', ap.full_name, 'createdAt', a.created_at,
               -- defence in depth: no email-like key ever leaves here
               'metadata', coalesce((select jsonb_object_agg(e.key, e.value)
                                       from jsonb_each(case when jsonb_typeof(a.metadata) = 'object' then a.metadata else '{}'::jsonb end) e
                                      where e.key <> 'email' and e.key not like '%\_email'), '{}'::jsonb))
             order by a.created_at desc, a.id desc)
        from (select * from public.audit_logs al where al.organization_id = o.id
               order by al.created_at desc, al.id desc limit 50) a
        left join public.profiles ap on ap.id = a.actor_id), '[]'::jsonb)
  ) into v_result
  from public.organizations o
  where o.id = admin_get_tenant_detail.org_id;

  return v_result; -- NULL when the organization does not exist
end;
$$;

-- Verifies an ACTIVE OWNER of the org, enforces 5 per rolling hour per admin, writes ONE audit row (no email)
-- and returns the owner's email to the server. Every "not an owner" cause raises the same NOT_AN_OWNER.
create or replace function public.admin_prepare_owner_password_reset(org_id uuid, user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select p.email into v_email
    from public.organization_members m
    join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id and r.is_system and r.key = 'owner'
    join public.profiles p on p.id = m.user_id
   where m.organization_id = admin_prepare_owner_password_reset.org_id
     and m.user_id = admin_prepare_owner_password_reset.user_id
     and m.status = 'active';
  if not found then
    raise exception 'NOT_AN_OWNER' using errcode = 'P0001';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'OWNER_HAS_NO_EMAIL' using errcode = 'P0001';
  end if;

  -- serialise this admin's calls so concurrent requests cannot slip past the cap
  perform pg_advisory_xact_lock(hashtextextended('owner_reset:' || v_uid::text, 0));
  if (select count(*) from public.audit_logs a
       where a.action = 'tenant.owner_password_reset' and a.actor_id = v_uid
         and a.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  perform private.write_audit(admin_prepare_owner_password_reset.org_id, v_uid, 'tenant.owner_password_reset',
    'user', admin_prepare_owner_password_reset.user_id::text, '{}'::jsonb);
  return v_email;
end;
$$;

revoke execute on function public.admin_get_tenant_detail(uuid), public.admin_prepare_owner_password_reset(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_tenant_detail(uuid), public.admin_prepare_owner_password_reset(uuid, uuid)
  to authenticated;
