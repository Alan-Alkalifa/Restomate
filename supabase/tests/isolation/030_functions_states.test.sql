-- MF-T25: helper functions, role permission sets, location scope, suspended org.
begin;
\ir _helpers.inc
select plan(257);

-- is_platform_admin / is_org_member / is_org_owner -------------------------------
select is(tests.scalar(a, 'public.is_platform_admin()'), case a when 'padmin' then 'true' else 'false' end, 'is_platform_admin as ' || a)
  from unnest(array['oa','ma','ca','wa','ka','da','ob','out','padmin']) a;
select is(tests.scalar(a, 'public.is_org_member({A})'), case when a in ('oa','ma','ca','wa','ka') then 'true' else 'false' end, 'is_org_member(A) as ' || a)
  from unnest(array['oa','ma','ca','wa','ka','da','ob','out','padmin']) a;
select is(tests.scalar(a, 'public.is_org_owner({A})'), case when a = 'oa' then 'true' else 'false' end, 'is_org_owner(A) as ' || a)
  from unnest(array['oa','ma','ca','wa','ka','da','ob','out','padmin']) a;
select is(tests.scalar('ob', 'public.is_org_owner({B})'), 'true', 'owner of B is owner of B');
select is(tests.scalar('oa', 'public.is_org_member({B})'), 'false', 'owner of A is not a member of B');

-- anon cannot execute any helper or RPC ---------------------------------------------
select is(tests.scalar('anon', f), 'DENIED', 'anon denied: ' || f)
  from unnest(array['public.is_platform_admin()', 'public.is_org_member({A})', 'public.is_org_owner({A})',
                    'public.has_permission({A}, ''menu.manage'')', 'public.has_location_access({A1})',
                    'public.my_permissions({A})']) f;
-- private schema is not reachable by clients at all
select is(tests.scalar(a, 'private.org_limit({A}, ''max_staff'')'), 'DENIED', 'private.org_limit denied as ' || a)
  from unnest(array['anon','oa','padmin']) a;
select is(tests.scalar(a, 'private.write_audit({A}, null, ''forged'')'), 'DENIED', 'private.write_audit denied as ' || a)
  from unnest(array['anon','oa','padmin']) a;

-- has_permission: exact permission sets from PLAN §4.2 ------------------------------
create table tests.allperms (p text);
insert into tests.allperms values ('menu.manage'),('orders.view'),('orders.create'),('orders.void'),('pos.use'),
 ('pos.discount'),('kitchen.view'),('kitchen.update'),('tables.view'),('tables.manage'),('reservations.view'),
 ('reservations.manage'),('payments.view'),('payments.take'),('payments.refund'),('customers.view'),
 ('customers.manage'),('reports.view'),('staff.manage'),('locations.manage'),('settings.manage'),
 ('settings.branding'),('billing.manage');
grant select on tests.allperms to public;
select is((select count(*)::int from tests.allperms), 23, 'permission catalog in test = 23 keys');
select set_eq('select key from public.permissions', 'select p from tests.allperms', 'permissions table = PLAN catalog');

create table tests.expected_perms (actor text, p text);
insert into tests.expected_perms
  select 'oa', p from tests.allperms
  union all select 'ma', p from tests.allperms where p not in ('billing.manage','settings.manage','locations.manage')
  union all select 'ca', unnest(array['pos.use','orders.view','orders.create','payments.view','payments.take','customers.view','kitchen.view','tables.view'])
  union all select 'wa', unnest(array['pos.use','orders.view','orders.create','kitchen.view','tables.view','reservations.view'])
  union all select 'ka', unnest(array['kitchen.view','kitchen.update','orders.view']);
grant select on tests.expected_perms to public;

select is(tests.scalar(a.actor, format('public.has_permission({A}, %L)', p.p)),
          case when exists (select 1 from tests.expected_perms e where e.actor = a.actor and e.p = p.p) then 'true' else 'false' end,
          format('has_permission(A, %s) as %s', p.p, a.actor))
  from (values ('oa'),('ma'),('ca'),('wa'),('ka')) a(actor), tests.allperms p;
-- non-members / deactivated / other org: never
select is(tests.scalar(a, format('public.has_permission({A}, %L)', p)), 'false', format('has_permission(A, %s) false as %s', p, a))
  from unnest(array['da','ob','out','padmin']) a, unnest(array['menu.manage','staff.manage','billing.manage','pos.use']) p;
select is(tests.scalar('oa', 'public.has_permission({B}, ''menu.manage'')'), 'false', 'owner of A has no permission in B');
select is(tests.scalar('oa', 'public.has_permission({A}, ''not.a.permission'')'), 'false', 'unknown permission key fails closed even for the owner');
select is(tests.scalar('oa', 'public.has_permission({A}, ''menu.manage'')'), 'true', 'control: owner still has real permissions');
select is(tests.scalar('ma', 'public.has_permission({A}, ''not.a.permission'')'), 'false', 'unknown permission fails closed for non-owner');

-- my_permissions sizes ---------------------------------------------------------------
select is(tests.scalar(v.a, 'cardinality(public.my_permissions({A}))'), v.n::text, 'my_permissions(A) size as ' || v.a)
  from (values ('oa',23),('ma',20),('ca',8),('wa',6),('ka',3),('da',0),('ob',0),('out',0),('padmin',0)) v(a, n);
select is(tests.scalar('oa', 'cardinality(public.my_permissions({B}))'), '0', 'my_permissions(B) empty for owner of A');

-- has_location_access ----------------------------------------------------------------
select is(tests.scalar(v.a, format('public.has_location_access(%L::uuid)', (select id from tests.ids where name = v.l))), v.e,
          format('has_location_access(%s) as %s', v.l, v.a))
  from (values
    ('oa','A1','true'),('oa','A2','true'),('oa','B1','false'),
    ('ma','A1','true'),('ma','A2','true'),
    ('ca','A1','true'),('ca','A2','false'),
    ('wa','A1','false'),('ka','A1','false'),
    ('da','A1','false'),('out','A1','false'),
    ('ob','B1','true'),('ob','A1','false'),
    ('padmin','A1','false')) v(a, l, e);

-- suspended org: helpers false, tenant reads blocked, org row (name/status) still readable
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(tests.scalar(a, 'public.is_org_member({A})'), 'false', 'suspended: is_org_member false as ' || a) from unnest(array['oa','ma','ca']) a;
select is(tests.scalar(a, 'public.is_org_owner({A})'), 'false', 'suspended: is_org_owner false as ' || a) from unnest(array['oa']) a;
select is(tests.scalar(a, 'public.has_permission({A}, ''pos.use'')'), 'false', 'suspended: has_permission false as ' || a) from unnest(array['oa','ma','ca']) a;
select is(tests.scalar(a, 'public.has_location_access({A1})'), 'false', 'suspended: has_location_access false as ' || a) from unnest(array['oa','ma','ca']) a;
select is(tests.scalar(a, 'cardinality(public.my_permissions({A}))'), '0', 'suspended: my_permissions empty as ' || a) from unnest(array['oa','ma','ca']) a;
select is(tests.cnt(a, 'select 1 from public.organizations where id = {A}'), 1::bigint, 'suspended: member still reads own organizations row as ' || a) from unnest(array['oa','ma','ca','wa','ka']) a;
select is(tests.cnt('da', 'select 1 from public.organizations where id = {A}'), 0::bigint, 'suspended: deactivated still sees nothing');
select is(tests.cnt('ob', 'select 1 from public.organizations where id = {A}'), 0::bigint, 'suspended: org B still sees nothing');
select is(tests.cnt(a, format('select 1 from public.%I where organization_id = {A}', t)), 0::bigint, format('suspended: %s hidden as %s', t, a))
  from unnest(array['oa','ma','ca']) a,
       unnest(array['org_branding','roles','role_permissions','location_staff','subscriptions','audit_logs']) t;
select is(tests.cnt(a, 'select 1 from public.locations where organization_id = {A}'), 0::bigint, 'suspended: locations hidden as ' || a) from unnest(array['oa','ma','ca']) a;
-- decided by ALAN: tenant reads blocked except the organizations row
select is(tests.cnt(a, 'select 1 from public.organization_members where organization_id = {A}'), 0::bigint, 'suspended: members hidden as ' || a) from unnest(array['oa','ma','ca']) a;
select is(tests.aff('oa', 'update public.organizations set name = ''while suspended'' where id = {A}'), 0::bigint, 'suspended: owner cannot edit org');
select is(tests.aff('oa', 'insert into public.locations (organization_id, name) values ({A}, ''x'')'), -1::bigint, 'suspended: owner cannot add location');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'A');
select is(tests.scalar('oa', 'public.is_org_member({A})'), 'true', 'reactivated: access returns');

-- deactivated member: everything closes at once -------------------------------------
select is(tests.scalar('da', 'public.has_permission({A}, ''pos.use'')'), 'false', 'deactivated: no permissions');
select is(tests.cnt('da', 'select 1 from public.locations where organization_id = {A}'), 0::bigint, 'deactivated: no locations');
select is(tests.cnt('ca', 'select 1 from public.locations where organization_id = {A}'), 1::bigint, 'control: same query works for active cashier');
update public.organization_members set status = 'deactivated' where user_id = (select uid from tests.actors where name = 'ca');
select is(tests.scalar('ca', 'public.is_org_member({A})'), 'false', 'deactivating takes effect on the very next call (same JWT)');
select is(tests.cnt('ca', 'select 1 from public.org_branding where organization_id = {A}'), 0::bigint, 'deactivated mid-session: branding hidden');

-- schema-level guards ------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 19, 'M0 + M2 venue have 19 RLS tables in public (update when tables are added)');
select is(has_schema_privilege('authenticated', 'private', 'USAGE'), false, 'authenticated has no usage on private schema');
select is(has_schema_privilege('anon', 'private', 'USAGE'), false, 'anon has no usage on private schema');

select * from finish();
rollback;
