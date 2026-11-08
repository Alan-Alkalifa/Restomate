-- B1-T02: atomic member location scope.
-- public.set_member_locations changes organization_members.all_locations and the location_staff rows in ONE call
-- (one transaction), with the privilege checks inside the function (not only in TypeScript).
--
-- Audit: the RPC writes ONE 'member.locations_set' row (old/new ids). The per-row location_staff trigger and the
-- all_locations 'member.scope_changed' trigger stay for direct client writes, but skip while this RPC runs
-- (transaction-local flag app.skip_location_audit), so nothing is double-logged.

create or replace function private.audit_location_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid := coalesce(new.organization_id, old.organization_id);
  v_member uuid := coalesce(new.member_id, old.member_id);
  v_loc   uuid := coalesce(new.location_id, old.location_id);
begin
  if coalesce(current_setting('app.skip_location_audit', true), '') = '1' then
    return null; -- set_member_locations writes one summary row
  end if;
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform private.write_audit(v_org, v_actor,
    case when tg_op = 'INSERT' then 'member.location_added' else 'member.location_removed' end,
    'organization_member', v_member::text, jsonb_build_object('location_id', v_loc));
  return null;
end;
$$;

create or replace function private.audit_org_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid := coalesce(new.organization_id, old.organization_id);
begin
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null; -- organization cascade delete
  end if;
  if tg_op = 'DELETE' then
    perform private.write_audit(v_org, v_actor, 'member.removed', 'organization_member', old.id::text,
      jsonb_build_object('user_id', old.user_id, 'role_id', old.role_id));
    return null;
  end if;
  if new.role_id is distinct from old.role_id then
    perform private.write_audit(v_org, v_actor, 'member.role_changed', 'organization_member', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'old_role_id', old.role_id, 'new_role_id', new.role_id));
  end if;
  if new.status is distinct from old.status then
    perform private.write_audit(v_org, v_actor,
      case when new.status = 'active' then 'member.reactivated' else 'member.deactivated' end,
      'organization_member', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'old_status', old.status, 'new_status', new.status));
  end if;
  if new.all_locations is distinct from old.all_locations
     and coalesce(current_setting('app.skip_location_audit', true), '') <> '1' then
    perform private.write_audit(v_org, v_actor, 'member.scope_changed', 'organization_member', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'old_all_locations', old.all_locations, 'new_all_locations', new.all_locations));
  end if;
  return null;
end;
$$;

create or replace function public.set_member_locations(member uuid, all_locations boolean, location_ids uuid[] default '{}')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_member  public.organization_members%rowtype;
  v_target_is_owner boolean;
  v_ids     uuid[];
  v_old_ids uuid[];
  v_old_all boolean;
  v_valid   integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_member from public.organization_members m where m.id = set_member_locations.member;
  -- unknown member and "no permission" look the same to the caller
  if not found or not public.has_permission(v_member.organization_id, 'staff.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select exists (select 1 from public.roles r where r.id = v_member.role_id and r.is_system and r.key = 'owner')
    into v_target_is_owner;
  if not public.is_org_owner(v_member.organization_id) then
    if v_target_is_owner or v_member.user_id = v_uid then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  v_ids := coalesce(
    (select array_agg(distinct x) from unnest(case when set_member_locations.all_locations then '{}'::uuid[]
                                                   else coalesce(set_member_locations.location_ids, '{}') end) x),
    '{}');
  if not set_member_locations.all_locations and cardinality(v_ids) = 0 then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;
  select count(*) into v_valid from public.locations l
  where l.organization_id = v_member.organization_id and l.is_active and l.id = any (v_ids);
  if v_valid <> cardinality(v_ids) then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;

  v_old_all := v_member.all_locations;
  select coalesce(array_agg(ls.location_id order by ls.location_id), '{}') into v_old_ids
  from public.location_staff ls where ls.member_id = v_member.id and ls.organization_id = v_member.organization_id;

  if v_old_all = set_member_locations.all_locations
     and v_old_ids = (select coalesce(array_agg(x order by x), '{}') from unnest(v_ids) x) then
    return jsonb_build_object('changed', false);
  end if;

  perform set_config('app.skip_location_audit', '1', true);
  delete from public.location_staff ls
  where ls.member_id = v_member.id and ls.organization_id = v_member.organization_id
    and not (ls.location_id = any (v_ids));
  insert into public.location_staff (member_id, location_id, organization_id)
  select v_member.id, x, v_member.organization_id from unnest(v_ids) x
  on conflict do nothing;
  update public.organization_members m set all_locations = set_member_locations.all_locations where m.id = v_member.id;
  perform set_config('app.skip_location_audit', '', true);

  perform private.write_audit(v_member.organization_id, v_uid, 'member.locations_set', 'organization_member', v_member.id::text,
    jsonb_build_object('user_id', v_member.user_id,
      'old_all_locations', v_old_all, 'new_all_locations', set_member_locations.all_locations,
      'old_location_ids', v_old_ids, 'new_location_ids', (select coalesce(array_agg(x order by x), '{}') from unnest(v_ids) x)));
  return jsonb_build_object('changed', true);
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.set_member_locations(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.set_member_locations(uuid, boolean, uuid[]) to authenticated;
