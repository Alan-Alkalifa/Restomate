-- MF-T25: SELECT isolation matrix (docs/qa/M0-test-plan.md §5).
-- Each spec: rows visible to each actor. A missing grant counts as 0 rows.
-- Actor order: oa ma ca wa ka da ob out padmin anon
begin;
\ir _helpers.inc
select plan(260);

create table tests.read_specs (ord serial, label text, q text, exp int[]);

insert into tests.read_specs (label, q, exp) values
 ('organizations A',  'select 1 from public.organizations where id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('organizations B',  'select 1 from public.organizations where id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('org_branding A',   'select 1 from public.org_branding where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('org_branding B',   'select 1 from public.org_branding where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('locations A',      'select 1 from public.locations where organization_id = {A}',    '{2,2,1,0,0,0,0,0,2,0}'),
 ('locations B',      'select 1 from public.locations where organization_id = {B}',    '{0,0,0,0,0,0,1,0,1,0}'),
 ('roles A',          'select 1 from public.roles where organization_id = {A}',        '{6,6,6,6,6,0,0,0,6,0}'),
 ('roles B',          'select 1 from public.roles where organization_id = {B}',        '{0,0,0,0,0,0,6,0,6,0}'),
 ('role_permissions A','select 1 from public.role_permissions where organization_id = {A}', '{37,37,37,37,37,0,0,0,37,0}'),
 ('role_permissions B','select 1 from public.role_permissions where organization_id = {B}', '{0,0,0,0,0,0,37,0,37,0}'),
 -- deactivated member sees only their own membership row
 ('organization_members A','select 1 from public.organization_members where organization_id = {A}', '{6,6,6,6,6,1,0,0,6,0}'),
 ('organization_members B','select 1 from public.organization_members where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('location_staff A', 'select 1 from public.location_staff where organization_id = {A}', '{1,1,1,1,1,0,0,0,1,0}'),
 ('location_staff B', 'select 1 from public.location_staff where organization_id = {B}', '{0,0,0,0,0,0,0,0,0,0}'),
 -- subscriptions: owner (billing.manage) + platform admin only; manager none
 ('subscriptions A',  'select 1 from public.subscriptions where organization_id = {A}', '{1,0,0,0,0,0,0,0,1,0}'),
 ('subscriptions B',  'select 1 from public.subscriptions where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 -- audit_logs: org owner + platform admin only
 ('audit_logs A',     'select 1 from public.audit_logs where organization_id = {A}', '{2,0,0,0,0,0,0,0,2,0}'),
 ('audit_logs B',     'select 1 from public.audit_logs where organization_id = {B}', '{0,0,0,0,0,0,1,0,1,0}'),
 ('audit_logs org-less', 'select 1 from public.audit_logs where organization_id is null and action = ''iso.platform''', '{0,0,0,0,0,0,0,0,1,0}'),
 -- NEW behaviour (DAVIN follow-up): co-member profiles only for staff.manage holders, own row, platform admin
 ('profiles',         'select 1 from public.profiles where id in (select uid from tests.actors)', '{6,6,1,1,1,1,1,1,9,0}'),
 ('platform_admins',  'select 1 from public.platform_admins where user_id in (select uid from tests.actors)', '{0,0,0,0,0,0,0,0,1,0}'),
 ('packages',         'select 1 from public.packages where code like ''iso-%''', '{2,1,1,1,1,1,1,1,3,1}'),
 ('reserved_slugs',   'select 1 from public.reserved_slugs where slug = ''www''', '{1,1,1,1,1,1,1,1,1,0}'),
 ('permissions',      'select 1 from public.permissions where key = ''menu.manage''', '{1,1,1,1,1,1,1,1,1,0}'),
 ('default_role_permissions','select 1 from public.default_role_permissions where role_key = ''cashier''', '{8,8,8,8,8,8,8,8,8,0}'),
 ('platform_settings','select 1 from public.platform_settings', '{0,0,0,0,0,0,0,0,0,0}');

create function tests.run_reads() returns setof text language plpgsql as $$
declare s record; i int; names text[] := array['oa','ma','ca','wa','ka','da','ob','out','padmin','anon'];
begin
  for s in select * from tests.read_specs order by ord loop
    for i in 1 .. 10 loop
      return next is(tests.cnt(names[i], s.q), s.exp[i]::bigint, s.label || ' as ' || names[i]);
    end loop;
  end loop;
end $$;

select * from tests.run_reads();
select * from finish();
rollback;
