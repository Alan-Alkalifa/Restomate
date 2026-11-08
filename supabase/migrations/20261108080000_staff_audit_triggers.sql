-- MF-T17: audit trail for staff management, written in the same transaction as the change.
-- No client-callable audit function exists: the AFTER triggers below call private.write_audit with auth.uid().
-- accept_invitation already writes 'invitation.accepted' itself, so the accepted_at update is skipped here.
-- Metadata holds ids and old/new values only (no emails or names): the invitation / member id is enough to look up.

create or replace function private.audit_staff_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not exists (select 1 from public.organizations o where o.id = new.organization_id) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, v_actor, 'invitation.created', 'staff_invitation', new.id::text,
      jsonb_build_object('role_id', new.role_id, 'all_locations', new.all_locations,
                         'location_count', cardinality(new.location_ids)));
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform private.write_audit(new.organization_id, v_actor, 'invitation.revoked', 'staff_invitation', new.id::text,
      jsonb_build_object('role_id', new.role_id));
  elsif new.send_count > old.send_count and new.token_hash <> old.token_hash
        and new.revoked_at is null and new.accepted_at is null then
    perform private.write_audit(new.organization_id, v_actor, 'invitation.resent', 'staff_invitation', new.id::text,
      jsonb_build_object('send_count', new.send_count));
  end if;
  return null;
end;
$$;

create trigger staff_invitations_audit
  after insert or update on public.staff_invitations
  for each row execute function private.audit_staff_invitation();

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
  if new.all_locations is distinct from old.all_locations then
    perform private.write_audit(v_org, v_actor, 'member.scope_changed', 'organization_member', new.id::text,
      jsonb_build_object('user_id', new.user_id, 'old_all_locations', old.all_locations, 'new_all_locations', new.all_locations));
  end if;
  return null;
end;
$$;

create trigger organization_members_audit
  after update of role_id, status, all_locations or delete on public.organization_members
  for each row execute function private.audit_org_member();

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
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform private.write_audit(v_org, v_actor,
    case when tg_op = 'INSERT' then 'member.location_added' else 'member.location_removed' end,
    'organization_member', v_member::text, jsonb_build_object('location_id', v_loc));
  return null;
end;
$$;

create trigger location_staff_audit
  after insert or delete on public.location_staff
  for each row execute function private.audit_location_staff();

revoke execute on all functions in schema private from public, anon, authenticated;
