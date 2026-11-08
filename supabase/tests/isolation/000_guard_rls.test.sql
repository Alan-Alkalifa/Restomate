-- MF-T25 guard: a table added to `public` without RLS/policies must fail CI.
-- Independent of seed data and of column names. Run by `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

-- 1. every ordinary/partitioned table in public has RLS enabled
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '',
  'every public table has RLS enabled');

-- 2. every public table has at least one policy
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname)),
  '',
  'every public table has at least one policy');

-- 3. RLS is not bypassed by FORCE-less owner tricks on views: no plain view in public
--    may be readable by anon/authenticated unless it is security_invoker.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select option_value::boolean
                          from pg_options_to_table(c.reloptions)
                         where option_name = 'security_invoker'), false)),
  '',
  'every public view is security_invoker');

-- 4. no write policy on any table that is unconditionally true (using/with check = true).
--    Reference-data SELECT policies are allowed to be `true` only for role authenticated,
--    and only on these tables (per ALAN decision: any authenticated may read them).
select is(
  (select coalesce(string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename), '')
     from pg_policies p
    where p.schemaname = 'public'
      and (
        (p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
           and (trim(coalesce(p.qual, '')) in ('true', '(true)')
             or trim(coalesce(p.with_check, '')) in ('true', '(true)')))
        or
        (p.cmd = 'SELECT' and trim(coalesce(p.qual, '')) in ('true', '(true)')
           and p.tablename not in ('permissions', 'default_role_permissions', 'reserved_slugs', 'packages'))
      )),
  '',
  'no using(true)/with check(true) policy outside the reference-data allowlist');

-- 5. anon has no table privileges beyond what policies mediate: anon must not have
--    INSERT/UPDATE/DELETE/TRUNCATE grants on any public table.
select is(
  (select coalesce(string_agg(table_name || ':' || privilege_type, ', ' order by table_name), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  '',
  'anon has no write grants on public tables');

-- 6. SECURITY DEFINER functions in public must pin search_path (injection guard)
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                       where cfg like 'search_path=%')),
  '',
  'every public SECURITY DEFINER function sets search_path');

select * from finish();
rollback;
