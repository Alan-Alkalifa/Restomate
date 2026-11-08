-- Shared fixtures + helpers, included with \ir by every isolation test file.
-- Not a test itself (extension .inc). Everything lives inside the caller's
-- transaction and is rolled back. No dependency on seed.sql: runs on an empty DB.
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

create schema tests;
grant usage on schema tests to public;

-- named ids -----------------------------------------------------------------
create table tests.ids (name text primary key, id uuid not null);
grant select on tests.ids to public;
insert into tests.ids values
  ('A',   '00000000-0000-4000-8000-0000000000a0'),
  ('B',   '00000000-0000-4000-8000-0000000000b0'),
  ('A1',  '00000000-0000-4000-8000-00000000a001'),
  ('A2',  '00000000-0000-4000-8000-00000000a002'),
  ('B1',  '00000000-0000-4000-8000-00000000b001'),
  ('uoa', '00000000-0000-4000-8000-0000000000a1'),
  ('uma', '00000000-0000-4000-8000-0000000000a2'),
  ('uca', '00000000-0000-4000-8000-0000000000a3'),
  ('uwa', '00000000-0000-4000-8000-0000000000a4'),
  ('uka', '00000000-0000-4000-8000-0000000000a5'),
  ('uda', '00000000-0000-4000-8000-0000000000a6'),
  ('uob', '00000000-0000-4000-8000-0000000000b1'),
  ('uout','00000000-0000-4000-8000-0000000000c1'),
  ('upad','00000000-0000-4000-8000-0000000000d1');

-- actors: oa/ma/ca/wa/ka = owner/manager/cashier/waiter/kitchen of org A,
-- da = deactivated cashier of A, ob = owner of B, out = signed in without membership,
-- padmin = platform admin. 'anon' is the anonymous role.
create table tests.actors (name text primary key, uid uuid not null, ord int not null);
grant select on tests.actors to public;
insert into tests.actors
select a.n, (select id from tests.ids where name = 'u' || case a.n when 'padmin' then 'pad' else a.n end), a.o
from (values ('oa',1),('ma',2),('ca',3),('wa',4),('ka',5),('da',6),('ob',7),('out',8),('padmin',9)) a(n, o);

insert into auth.users (id, email, aud, role)
select uid, name || '@iso.test', 'authenticated', 'authenticated' from tests.actors;

insert into public.platform_admins (user_id) select uid from tests.actors where name = 'padmin';

-- packages: pub (public+active), old (archived, A's plan), priv (active, not public)
insert into public.packages (code, name, is_active, is_public, limits, features) values
  ('iso-pub',  'Iso Public',  true,  true,  '{"max_locations":3,"max_staff":25,"max_tables":100}', '{}'),
  ('iso-old',  'Iso Archived', false, true, '{"max_locations":10,"max_staff":50,"max_tables":100}',  '{}'),
  ('iso-priv', 'Iso Private', true,  false, '{}', '{}');

insert into public.organizations (id, slug, name) values
  ((select id from tests.ids where name = 'A'), 'iso-org-a', 'Iso A'),
  ((select id from tests.ids where name = 'B'), 'iso-org-b', 'Iso B');

insert into public.subscriptions (organization_id, package_id, status)
select (select id from tests.ids where name = 'A'), id, 'active' from public.packages where code = 'iso-old';
insert into public.subscriptions (organization_id, package_id, status)
select (select id from tests.ids where name = 'B'), id, 'active' from public.packages where code = 'iso-pub';

insert into public.locations (id, organization_id, name) values
  ((select id from tests.ids where name = 'A1'), (select id from tests.ids where name = 'A'), 'Iso A1'),
  ((select id from tests.ids where name = 'A2'), (select id from tests.ids where name = 'A'), 'Iso A2'),
  ((select id from tests.ids where name = 'B1'), (select id from tests.ids where name = 'B'), 'Iso B1');

-- five system roles per org with the default permission sets
insert into public.roles (organization_id, key, name, is_system)
select o.id, k, initcap(k), true
from public.organizations o, unnest(array['owner','manager','cashier','waiter','kitchen']) k
where o.slug in ('iso-org-a', 'iso-org-b');
insert into public.role_permissions (role_id, organization_id, permission_key)
select r.id, r.organization_id, d.permission_key
from public.roles r join public.default_role_permissions d on d.role_key = r.key
where r.is_system and r.organization_id in (select id from tests.ids where name in ('A', 'B'));

-- scratch custom roles for write tests
insert into public.roles (id, organization_id, key, name, is_system) values
  ('00000000-0000-4000-8000-0000000005a0', (select id from tests.ids where name = 'A'), 'scratch', 'Scratch A', false),
  ('00000000-0000-4000-8000-0000000005b0', (select id from tests.ids where name = 'B'), 'scratch', 'Scratch B', false);
insert into tests.ids values
  ('SA', '00000000-0000-4000-8000-0000000005a0'),
  ('SB', '00000000-0000-4000-8000-0000000005b0');

create function tests.role_id(org text, k text) returns uuid language sql stable as $$
  select r.id from public.roles r
  where r.organization_id = (select id from tests.ids where name = org) and r.key = k and r.is_system;
$$;
grant execute on function tests.role_id(text, text) to public;

-- memberships
insert into public.organization_members (id, organization_id, user_id, role_id, status, all_locations)
select gen_random_uuid(), (select id from tests.ids where name = m.org),
       (select uid from tests.actors where name = m.actor),
       tests.role_id(m.org, m.role), m.status, m.allloc
from (values
  ('oa','A','owner','active',true), ('ma','A','manager','active',true),
  ('ca','A','cashier','active',false), ('wa','A','waiter','active',false),
  ('ka','A','kitchen','active',false), ('da','A','cashier','deactivated',false),
  ('ob','B','owner','active',true)) m(actor, org, role, status, allloc);

-- cashier of A works at A1 only
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, (select id from tests.ids where name = 'A1'), m.organization_id
from public.organization_members m where m.user_id = (select uid from tests.actors where name = 'ca');

insert into public.org_branding (organization_id)
select id from tests.ids where name in ('A', 'B');

insert into public.audit_logs (organization_id, actor_id, action) values
  ((select id from tests.ids where name = 'A'), (select uid from tests.actors where name = 'oa'), 'iso.a1'),
  ((select id from tests.ids where name = 'A'), (select uid from tests.actors where name = 'oa'), 'iso.a2'),
  ((select id from tests.ids where name = 'B'), (select uid from tests.actors where name = 'ob'), 'iso.b1'),
  (null, (select uid from tests.actors where name = 'padmin'), 'iso.platform');

insert into public.platform_settings (key, value) values ('iso_test', '{"x":1}');

-- helpers -------------------------------------------------------------------
-- substitute {A} {B} {A1} {A2} {B1} {SA} {SB} {uoa}... with quoted uuid literals
create function tests.sub(q text) returns text language plpgsql stable as $$
declare r record;
begin
  for r in select name, id from tests.ids order by length(name) desc loop
    q := replace(q, '{' || r.name || '}', quote_literal(r.id::text) || '::uuid');
  end loop;
  return q;
end $$;
grant execute on function tests.sub(text) to public;

create function tests.become(actor text) returns void language plpgsql as $$
declare v uuid;
begin
  select a.uid into v from tests.actors a where a.name = actor;
  reset role;
  if actor = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v, 'role', 'authenticated', 'email', actor || '@iso.test')::text, true);
    perform set_config('request.jwt.claim.sub', v::text, true);
    set local role authenticated;
  end if;
end $$;
grant execute on function tests.become(text) to public;

-- rows visible to actor; a missing table privilege counts as 0 rows
create function tests.cnt(actor text, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform tests.become(actor);
  begin
    execute 'select count(*) from (' || tests.sub(q) || ') x' into n;
  exception when insufficient_privilege then n := 0;
  end;
  reset role;
  return n;
end $$;
grant execute on function tests.cnt(text, text) to public;

-- rows changed by a write; -1 = refused with 42501 (no grant / RLS check),
-- -2 = refused by a constraint (FK/check/unique), -3 = refused by a trigger (P0001).
-- 0 = silently filtered by RLS. BEFORE ROW triggers run before INSERT RLS checks, so an
-- insert can be refused by a trigger first.
create function tests.aff(actor text, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform tests.become(actor);
  begin
    execute tests.sub(stmt);
    get diagnostics n = row_count;
  exception
    when insufficient_privilege then n := -1;
    when foreign_key_violation or check_violation or unique_violation or not_null_violation then n := -2;
    when raise_exception then n := -3;   -- refused by an integrity trigger (PLAN_LIMIT, LAST_OWNER, SYSTEM_ROLE, ...)
  end;
  reset role;
  return n;
end $$;
grant execute on function tests.aff(text, text) to public;

-- scalar result as text; 'DENIED' when the caller lacks privilege
create function tests.scalar(actor text, q text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.become(actor);
  begin
    execute 'select (' || tests.sub(q) || ')::text' into v;
  exception when insufficient_privilege then v := 'DENIED';
  end;
  reset role;
  return v;
end $$;
grant execute on function tests.scalar(text, text) to public;
