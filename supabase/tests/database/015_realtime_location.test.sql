-- MVM-T14: Realtime exposure. qr_token must stay unreadable by client roles (Realtime strips columns the subscriber
-- cannot SELECT) and the publication must carry the two tables with the whitelist for `tables`.
select exists (select 1 from pg_publication where pubname = 'supabase_realtime') as has_pub \gset
\if :has_pub
begin;
select plan(9);

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'location_menu_overrides'),
  'location_menu_overrides is in the realtime publication');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tables'),
  'tables is in the realtime publication');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tables' and 'qr_token' = any (attnames::text[])),
  'the published column list of tables does not include qr_token');
select ok((select attnames::text[] from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tables') @> array['id', 'location_id', 'status', 'label'],
  'the whitelist still carries the columns the floor and menu pages need');

select is(has_column_privilege('authenticated', 'public.tables', 'qr_token', 'select'), false, 'authenticated cannot SELECT tables.qr_token (so Realtime strips it)');
select is(has_column_privilege('anon', 'public.tables', 'qr_token', 'select'), false, 'anon cannot SELECT tables.qr_token');
select is(has_table_privilege('authenticated', 'public.tables', 'select'), false, 'authenticated has no table-wide SELECT on tables (only per column)');
select is(has_column_privilege('authenticated', 'public.tables', 'status', 'select'), true, 'authenticated can SELECT tables.status');
select is(has_column_privilege('authenticated', 'public.location_menu_overrides', 'sold_out_until', 'select'), true, 'authenticated can SELECT the override columns Realtime sends');

select * from finish();
rollback;
\else
begin;
select plan(1);
select skip('the supabase_realtime publication is not present', 1);
select * from finish();
rollback;
\endif
