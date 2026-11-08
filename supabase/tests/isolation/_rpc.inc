-- Extra helpers for the RPC / invitation abuse tests (included after _helpers.inc).

-- full error text + sqlstate of a statement, or 'OK:<result>'
create function tests.errmsg(actor text, q text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.become(actor);
  begin
    execute 'select (' || tests.sub(q) || ')::text' into v;
    v := 'OK:' || coalesce(v, 'NULL');
  exception when others then
    v := sqlerrm || '|' || sqlstate;
  end;
  reset role;
  return v;
end $$;
grant execute on function tests.errmsg(text, text) to public;

-- extra user + actor (confirmed unless told otherwise); email = <name>@iso.test
create function tests.mkuser(nm text, confirmed boolean default true) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at)
  values (v, nm || '@iso.test', 'authenticated', 'authenticated', case when confirmed then now() end);
  insert into tests.actors values (nm, v, 100 + (select count(*) from tests.actors)::int);
  insert into tests.ids values ('u' || nm, v);
end $$;

-- invitation fixture (run as postgres). token_hash = sha256(token)
create function tests.mkinv(org text, em text, role_key text, locs text[], tok text,
                            expires interval default interval '7 days',
                            revoked boolean default false, accepted boolean default false)
returns void language plpgsql as $$
begin
  insert into public.staff_invitations (organization_id, email, role_id, location_ids, token_hash,
                                        invited_by, expires_at, revoked_at, accepted_at)
  values ((select id from tests.ids where name = org), lower(em), tests.role_id(org, role_key),
          coalesce((select array_agg(id) from tests.ids where name = any (locs)), '{}'),
          encode(extensions.digest(tok, 'sha256'), 'hex'),
          (select uid from tests.actors where name = 'oa'),
          now() + expires, case when revoked then now() end, case when accepted then now() end)
  ;
end $$;

-- all fixture users count as email-confirmed, a default package exists for create_organization
update auth.users set email_confirmed_at = now() where email like '%@iso.test';
update public.packages set is_default = false where is_default;
update public.packages set is_default = true, trial_days = 14 where code = 'iso-pub';

-- run a statement as an actor (or as 'postgres' = no role switch); 'OK' or '<message>|<sqlstate>'
create function tests.stmt(actor text, q text) returns text language plpgsql as $$
declare v text := 'OK';
begin
  if actor = 'postgres' then reset role; else perform tests.become(actor); end if;
  begin
    execute tests.sub(q);
  exception when others then
    v := sqlerrm || '|' || sqlstate;
  end;
  reset role;
  return v;
end $$;
grant execute on function tests.stmt(text, text) to public;
