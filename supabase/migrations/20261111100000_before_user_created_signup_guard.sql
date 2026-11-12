-- B1-T18: Supabase Auth `before_user_created` hook. Refuses new sign-ups while platform signup is disabled,
-- so a direct call to Auth /signup (public key) can no longer create an account.
-- Decision: an email with a pending staff invitation (not accepted, not revoked, not expired) is still allowed,
-- so invited staff can accept an invitation while public signup is closed.
-- Contract: https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
--   input  { "user": {...}, "metadata": {...} }; output '{}' to allow, or {"error":{"http_code","message"}} to reject.

create or replace function public.before_user_created_signup_guard(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event->'user'->>'email', '')));
begin
  if coalesce((private.platform_setting_get('signup')->>'enabled')::boolean, true) then
    return '{}'::jsonb;
  end if;

  if v_email <> '' and exists (
    select 1 from public.staff_invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'SIGNUP_DISABLED: new sign-ups are currently closed.'));
end;
$$;

-- Only Supabase Auth may call it; it must not be reachable as a PostgREST RPC.
revoke all on function public.before_user_created_signup_guard(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_signup_guard(jsonb) to supabase_auth_admin;
