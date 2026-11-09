-- B1-T03: harden admin_set_org_status.
--  * reason (trimmed) must be 5..500 chars, enforced in SQL (not only in the Zod action).
--  * setting the status an org already has is a no-op: no update, no audit row.
--  * returns boolean `changed` (was void) so callers can tell. Return type change => drop + create + re-grant.
drop function public.admin_set_org_status(uuid, text, text);

create function public.admin_set_org_status(org uuid, status text, reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org    uuid := admin_set_org_status.org;
  v_status text := admin_set_org_status.status;
  v_reason text := trim(coalesce(admin_set_org_status.reason, ''));
  v_old    text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_status is null or v_status not in ('active', 'suspended', 'past_due', 'read_only') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'INVALID_REASON' using errcode = 'P0001';
  end if;

  select o.status into v_old from public.organizations o where o.id = v_org for update;
  if not found then
    raise exception 'ORG_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old = v_status then
    return false;
  end if;

  update public.organizations o set status = v_status where o.id = v_org;

  perform private.write_audit(v_org, v_uid, 'organization.status_changed', 'organization', v_org::text,
    jsonb_build_object('from', v_old, 'to', v_status, 'reason', v_reason));
  return true;
end;
$$;

revoke execute on function public.admin_set_org_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_org_status(uuid, text, text) to authenticated;
