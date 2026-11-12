-- B1-T31: locations.tax_id (NPWP). 15/16 digits or null; only locations.manage can set it; cross-org write fails.
begin;
select plan(18);

insert into public.packages (code, name, limits) values ('t-npwp', 'Npwp', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'n' || n || '@n.test', now(), now(), now()
from generate_series(1, 5) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000a' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.loc(s text) returns uuid language sql security definer as $$ select id from public.locations where organization_id = pg_temp.org(s) limit 1 $$;
create function pg_temp.tax(s text) returns text language sql security definer as $$ select tax_id from public.locations where id = pg_temp.loc(s) $$;
create function pg_temp.upd(s text, v text) returns int language plpgsql as $$
declare n int;
begin
  update public.locations set tax_id = v where id = pg_temp.loc(s);
  get diagnostics n = row_count;
  return n;
end $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Org N A', 'npwp-a', '{"name":"L1"}'::jsonb, null, 't-npwp');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select public.create_organization('Org N B', 'npwp-b', '{"name":"B1"}'::jsonb, null, 't-npwp');
reset role;
-- u2 manager (no locations.manage by default), u3 cashier, u5 custom role with locations.manage
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('npwp-a'), pg_temp.uid(2), pg_temp.role('npwp-a', 'manager'), true),
  (pg_temp.org('npwp-a'), pg_temp.uid(3), pg_temp.role('npwp-a', 'cashier'), true);
insert into public.roles (id, organization_id, key, name, is_system)
values ('00000000-0000-0000-0000-0000000000c1', pg_temp.org('npwp-a'), 'locadmin', 'Location admin', false);
insert into public.role_permissions (role_id, organization_id, permission_key)
values ('00000000-0000-0000-0000-0000000000c1', pg_temp.org('npwp-a'), 'locations.manage');
insert into public.organization_members (organization_id, user_id, role_id, all_locations)
values (pg_temp.org('npwp-a'), pg_temp.uid(5), '00000000-0000-0000-0000-0000000000c1', true);

select is(pg_temp.tax('npwp-a'), null, 'a new location has no tax id');

-- owner (implicit locations.manage)
select pg_temp.act_as(pg_temp.uid(1));
select is(pg_temp.upd('npwp-a', '123456789012345'), 1, 'the owner sets a 15-digit NPWP');
select is(pg_temp.tax('npwp-a'), '123456789012345', 'stored as 15 digits');
select is(pg_temp.upd('npwp-a', '1234567890123456'), 1, 'and a 16-digit one (new NIK-based NPWP)');
select is(pg_temp.tax('npwp-a'), '1234567890123456', 'stored as 16 digits');
select throws_ok(format($$update public.locations set tax_id = %L where id = %L$$, '12345678901234', pg_temp.loc('npwp-a')), '23514', null, '14 digits is rejected');
select throws_ok(format($$update public.locations set tax_id = %L where id = %L$$, '12345678901234567', pg_temp.loc('npwp-a')), '23514', null, '17 digits is rejected');
select throws_ok(format($$update public.locations set tax_id = %L where id = %L$$, '12.345.678.9-012.345', pg_temp.loc('npwp-a')), '23514', null, 'separators are stripped by the app; the database accepts digits only');
select throws_ok(format($$update public.locations set tax_id = %L where id = %L$$, '12345678901234A', pg_temp.loc('npwp-a')), '23514', null, 'letters are rejected');
select throws_ok(format($$update public.locations set tax_id = %L where id = %L$$, '', pg_temp.loc('npwp-a')), '23514', null, 'an empty string is not null: the app maps empty to null');
select is(pg_temp.tax('npwp-a'), '1234567890123456', 'rejected writes changed nothing');
select is(pg_temp.upd('npwp-a', null), 1, 'the owner clears it (null)');
select is(pg_temp.upd('npwp-a', '123456789012345'), 1, 'set again for the permission checks');
reset role;

-- a custom role with locations.manage may set it
select pg_temp.act_as(pg_temp.uid(5));
select is(pg_temp.upd('npwp-a', '987654321098765'), 1, 'a member with locations.manage can set it');
reset role;

-- manager and cashier lack locations.manage: RLS filters the row, nothing changes
select pg_temp.act_as(pg_temp.uid(2));
select is(pg_temp.upd('npwp-a', '111111111111111'), 0, 'a manager (no locations.manage) cannot set it');
reset role;
select pg_temp.act_as(pg_temp.uid(3));
select is(pg_temp.upd('npwp-a', '222222222222222'), 0, 'a cashier cannot set it');
reset role;

-- another organization
select pg_temp.act_as(pg_temp.uid(4));
select is(pg_temp.upd('npwp-a', '333333333333333'), 0, 'the owner of org B cannot write org A''s location');
reset role;
select is(pg_temp.tax('npwp-a'), '987654321098765', 'org A''s tax id is unchanged by all the refused writes');

select * from finish();
rollback;
