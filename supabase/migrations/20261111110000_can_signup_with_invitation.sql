-- B1-T18 follow-up: lets the signUp Server Action allow an invitee while public signup is off.
-- Tied to the invite TOKEN (pending + email matches), never to the email alone, so the form cannot be used to
-- probe which emails have invitations. Returns only a boolean; every failure reason looks the same.
create or replace function public.can_signup_with_invitation(invite_token text, invite_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := invite_token;
  v_email text := lower(btrim(coalesce(invite_email, '')));
begin
  if v_token is null or char_length(v_token) < 16 or char_length(v_token) > 256 or v_email = '' then
    return false;
  end if;
  return exists (
    select 1 from public.staff_invitations i
    where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
      and i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  );
end;
$$;

-- Called before the user has a session (signUp), so anon must be able to execute it.
revoke all on function public.can_signup_with_invitation(text, text) from public;
grant execute on function public.can_signup_with_invitation(text, text) to anon, authenticated;
