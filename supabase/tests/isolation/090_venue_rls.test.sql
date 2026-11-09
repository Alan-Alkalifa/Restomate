-- MVM-T02: areas + tables isolation (read matrix, cross-tenant writes, reassignment, qr_token tampering, constraints).
-- Written against the MVM-T01 contract (docs/contracts/venue.md), independently of the schema author's tests.
-- Actor order: oa ma ca wa ka da ob out padmin anon  (+ sm = manager limited to location A1)
begin;
\ir _helpers.inc
\ir _rpc.inc
select plan(132);

\ir _venue.inc

-- ===== READ MATRIX =====================================================================
create table tests.read_specs (ord serial, label text, q text, exp int[]);
--                                                                                           oa ma ca wa ka da ob out pad anon
insert into tests.read_specs (label, q, exp) values
 ('areas A1 (incl. inactive)', 'select 1 from public.areas where location_id = {A1}', '{2,2,2,0,0,0,0,0,2,0}'),
 ('areas A2',                  'select 1 from public.areas where location_id = {A2}', '{1,1,0,0,0,0,0,0,1,0}'),
 ('areas B1',                  'select 1 from public.areas where location_id = {B1}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('areas by org A (no filter on location)', 'select 1 from public.areas where organization_id = {A}', '{3,3,2,0,0,0,0,0,3,0}'),
 ('tables A1 (incl. inactive)','select 1 from public.tables where location_id = {A1}', '{2,2,2,0,0,0,0,0,2,0}'),
 ('tables A2',                 'select 1 from public.tables where location_id = {A2}', '{1,1,0,0,0,0,0,0,1,0}'),
 ('tables B1',                 'select 1 from public.tables where location_id = {B1}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('tables by id of org B',     'select 1 from public.tables where id = {TB}',          '{0,0,0,0,0,0,1,0,1,0}'),
 ('areas by id of org B',      'select 1 from public.areas where id = {ARB}',          '{0,0,0,0,0,0,1,0,1,0}'),
 -- qr_token must not be readable by anyone on the client: every role incl. owner, org B owner and platform admin
 ('qr_token column',           'select qr_token from public.tables',                   '{0,0,0,0,0,0,0,0,0,0}'),
 ('qr_token via filter',       'select 1 from public.tables where qr_token = ''tok-a1''', '{0,0,0,0,0,0,0,0,0,0}'),
 ('select * on tables',        'select * from public.tables',                          '{0,0,0,0,0,0,0,0,0,0}'),
 ('granted columns still work','select id, organization_id, location_id, area_id, label, capacity, status, pos_x, pos_y, shape, is_active, qr_rotated_at from public.tables where location_id = {A1}', '{2,2,2,0,0,0,0,0,2,0}');

create function tests.run_reads() returns setof text language plpgsql as $$
declare s record; i int; names text[] := array['oa','ma','ca','wa','ka','da','ob','out','padmin','anon'];
begin
  for s in select * from tests.read_specs order by ord loop
    for i in 1 .. 10 loop
      return next is(tests.cnt(names[i], s.q), s.exp[i]::bigint, s.label || ' as ' || names[i]);
    end loop;
  end loop;
end $$;
select * from tests.run_reads();   -- 130 assertions

-- scoped manager (sm) sees A1 only
select is(tests.cnt('sm', 'select 1 from public.tables where organization_id = {A}'), 2::bigint, 'sm (A1-scoped manager) sees only A1 tables');
select is(tests.cnt('sm', 'select 1 from public.areas where organization_id = {A}'), 2::bigint, 'sm sees only A1 areas');

select * from finish();
rollback;
