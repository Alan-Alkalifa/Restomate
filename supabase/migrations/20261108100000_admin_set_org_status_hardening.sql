-- B1-T03: harden admin_set_org_status.
--  * reason must be 5..500 chars after trimming, enforced in SQL (not only in the Zod action). Postgres trim()
--    strips only U+0020, so edges are stripped with a regex covering \s, NBSP, other Unicode spaces and zero-width
--    characters; the reason must also contain >= 5 visible characters (so newline/tab/NBSP/zero-width-only
--    reasons are rejected). The trimmed text is what is stored in the audit row.
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
  -- whitespace class: \s, NBSP, ogham, U+2000-200F (spaces + zero-width), line/para sep, NNBSP, MMSP, word joiner, ideographic space, BOM
  v_ws     constant text := '[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]';
  v_reason text := regexp_replace(coalesce(admin_set_org_status.reason, ''), '^' || v_ws || '+|' || v_ws || '+$', '', 'g');
  v_visible int := char_length(regexp_replace(v_reason, v_ws || '+', '', 'g'));
  v_old    text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_status is null or v_status not in ('active', 'suspended', 'past_due', 'read_only') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if v_visible < 5 or char_length(v_reason) > 500 then
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
