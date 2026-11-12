-- MVM-T14 (M2): Realtime for location menu overrides and table status.
--  * Postgres Changes: subscribers only receive rows their RLS select policy lets them read
--    (has_location_access(location_id)), so other orgs and unscoped staff receive nothing.
--  * qr_token must never reach a client. Today's guarantee (verified against a live Realtime in
--    apps/web/lib/realtime/subscribe-location.integration.test.ts): Realtime decodes with wal2json and then, per
--    subscriber role, drops every column that role cannot SELECT (realtime.apply_rls -> has_column_privilege).
--    `authenticated` and `anon` have no SELECT on public.tables.qr_token (venue migration), so it is stripped.
--    Do NOT `grant select (qr_token)` or `grant select on public.tables` to any client role; 015_realtime_location.test.sql fails if so.
--  * Defense in depth: `tables` is also published with an explicit COLUMN LIST without qr_token / qr_rotated_at. wal2json
--    ignores column lists, but a pgoutput-based Realtime would honour them, so the token would still not be streamed.
-- Skipped when the publication does not exist (e.g. a plain Postgres).
do $rt$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not present: skipping realtime setup';
    return;
  end if;

  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'location_menu_overrides') then
    alter publication supabase_realtime add table public.location_menu_overrides;
  end if;

  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tables') then
    -- already published (e.g. by hand): re-add it with the whitelist so the token can never leak
    alter publication supabase_realtime drop table public.tables;
  end if;
  alter publication supabase_realtime add table
    public.tables (id, organization_id, location_id, area_id, label, capacity, status, pos_x, pos_y, shape, is_active, updated_at);
end
$rt$;
