-- B1-T28: tables.pos_x / pos_y must stay on the 0..999 floor canvas (NULL = not placed yet).
begin;
select plan(13);

insert into public.packages (code, name, limits) values ('t-pos', 'Pos', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p1@p.test', now(), now(), now());

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.org() returns uuid language sql security definer as $$ select id from public.organizations where slug = 'pos-a' $$;
create function pg_temp.loc() returns uuid language sql security definer as $$ select id from public.locations where organization_id = pg_temp.org() limit 1 $$;
create function pg_temp.area() returns uuid language sql security definer as $$ select id from public.areas where organization_id = pg_temp.org() limit 1 $$;
create function pg_temp.tbl() returns uuid language sql security definer as $$ select id from public.tables where organization_id = pg_temp.org() limit 1 $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.create_organization('Pos A', 'pos-a', '{"name":"L1"}'::jsonb, null, 't-pos');
reset role;
insert into public.areas (organization_id, location_id, name) values (pg_temp.org(), pg_temp.loc(), 'Hall');
insert into public.tables (organization_id, location_id, area_id, label, capacity)
values (pg_temp.org(), pg_temp.loc(), pg_temp.area(), 'P1', 2);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$update public.tables set pos_x = 0, pos_y = 0 where id = %L$$, pg_temp.tbl()), '0 is accepted');
select lives_ok(format($$update public.tables set pos_x = 999, pos_y = 999 where id = %L$$, pg_temp.tbl()), '999 is accepted');
select lives_ok(format($$update public.tables set pos_x = null, pos_y = null where id = %L$$, pg_temp.tbl()), 'NULL (not placed) is accepted');
select throws_ok(format($$update public.tables set pos_x = -1 where id = %L$$, pg_temp.tbl()), '23514', null, 'pos_x = -1 is rejected');
select throws_ok(format($$update public.tables set pos_x = 1000 where id = %L$$, pg_temp.tbl()), '23514', null, 'pos_x = 1000 is rejected');
select throws_ok(format($$update public.tables set pos_y = -1 where id = %L$$, pg_temp.tbl()), '23514', null, 'pos_y = -1 is rejected');
select throws_ok(format($$update public.tables set pos_y = 1000 where id = %L$$, pg_temp.tbl()), '23514', null, 'pos_y = 1000 is rejected');
select throws_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, pos_x, pos_y) values (%L, %L, %L, 'P2', 2, 1000, 5)$$,
  pg_temp.org(), pg_temp.loc(), pg_temp.area()), '23514', null, 'an insert outside the canvas is rejected');
select lives_ok(format($$insert into public.tables (organization_id, location_id, area_id, label, capacity, pos_x, pos_y) values (%L, %L, %L, 'P3', 2, 999, 0)$$,
  pg_temp.org(), pg_temp.loc(), pg_temp.area()), 'an insert on the canvas edge is accepted');
reset role;

-- the migration's clamp: the constraints exist and out-of-range rows could not survive them
select is((select count(*)::int from pg_constraint where conrelid = 'public.tables'::regclass and conname in ('tables_pos_x_range', 'tables_pos_y_range')), 2, 'both range constraints exist');
select is((select count(*)::int from public.tables where pos_x < 0 or pos_x > 999 or pos_y < 0 or pos_y > 999), 0, 'no stored position is out of range');
select is((select least(greatest(-5, 0), 999)) || '/' || (select least(greatest(1500, 0), 999)), '0/999', 'the clamp expression maps -5 to 0 and 1500 to 999');
select is((select count(*)::int from public.tables where organization_id = pg_temp.org()), 2, 'the rejected writes left no extra rows');

select * from finish();
rollback;
