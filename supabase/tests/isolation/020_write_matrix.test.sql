-- MF-T25: INSERT/UPDATE/DELETE isolation matrix.
-- ok      = exactly one row changed
-- blocked = refused (42501), refused by a constraint, or filtered to 0 rows
begin;
\ir _helpers.inc
select plan(146);

create table tests.write_specs (ord serial, actor text, stmt text, expect text, label text);

insert into tests.write_specs (actor, stmt, expect, label) values
-- organizations (client may only update name/contact_email/timezone/currency, owner only)
 ('oa','update public.organizations set name = ''Iso A renamed'' where id = {A}','ok','owner renames own org'),
 ('ma','update public.organizations set name = ''x'' where id = {A}','blocked','manager cannot edit org (no settings.manage)'),
 ('ca','update public.organizations set name = ''x'' where id = {A}','blocked','cashier cannot edit org'),
 ('da','update public.organizations set name = ''x'' where id = {A}','blocked','deactivated cannot edit org'),
 ('ob','update public.organizations set name = ''pwn'' where id = {A}','blocked','org B owner cannot edit org A'),
 ('out','update public.organizations set name = ''pwn'' where id = {A}','blocked','non-member cannot edit org A'),
 ('anon','update public.organizations set name = ''pwn'' where id = {A}','blocked','anon cannot edit org'),
 ('oa','update public.organizations set slug = ''iso-hacked'' where id = {A}','blocked','owner cannot change slug directly'),
 ('oa','update public.organizations set status = ''suspended'' where id = {A}','blocked','owner cannot change status'),
 ('oa','update public.organizations set status = ''active'' where id = {B}','blocked','owner A cannot touch org B'),
 ('oa','insert into public.organizations (slug, name) values (''iso-new'', ''n'')','blocked','no direct org insert (owner)'),
 ('out','insert into public.organizations (slug, name) values (''iso-new'', ''n'')','blocked','no direct org insert (user)'),
 ('padmin','update public.organizations set status = ''suspended'' where id = {A}','blocked','padmin has no direct org write (RPC only)'),
 ('oa','delete from public.organizations where id = {A}','blocked','no org delete (owner)'),
 ('padmin','delete from public.organizations where id = {A}','blocked','no org delete (padmin)'),
-- profiles
 ('oa','update public.profiles set full_name = ''Owner A'' where id = {uoa}','ok','user edits own name'),
 ('oa','update public.profiles set email = ''x@x.test'' where id = {uoa}','blocked','email column not editable by client'),
 ('oa','update public.profiles set full_name = ''pwn'' where id = {uma}','blocked','owner cannot edit a co-member profile'),
 ('ob','update public.profiles set full_name = ''pwn'' where id = {uoa}','blocked','org B cannot edit org A profile'),
 ('padmin','update public.profiles set full_name = ''pwn'' where id = {uoa}','blocked','padmin cannot edit profiles directly'),
 ('oa','insert into public.profiles (id) values (gen_random_uuid())','blocked','no client profile insert'),
 ('oa','delete from public.profiles where id = {uoa}','blocked','no client profile delete'),
-- platform_admins: only the service role writes
 ('oa','insert into public.platform_admins (user_id) values ({uoa})','blocked','user cannot make self platform admin'),
 ('out','insert into public.platform_admins (user_id) values ({uout})','blocked','non-member cannot make self platform admin'),
 ('padmin','insert into public.platform_admins (user_id) values ({uoa})','blocked','even a platform admin cannot add admins from a client'),
 ('padmin','delete from public.platform_admins where user_id = {upad}','blocked','platform admin cannot delete admins'),
 ('anon','insert into public.platform_admins (user_id) values ({uoa})','blocked','anon cannot insert platform admin'),
-- packages
 ('oa','update public.packages set price_monthly = 0 where code = ''iso-pub''','blocked','owner cannot edit plans'),
 ('ob','update public.packages set features = ''{custom_domain}'' where code = ''iso-pub''','blocked','tenant cannot grant itself features'),
 ('ob','insert into public.packages (code, name) values (''iso-evil'', ''Evil'')','blocked','tenant cannot create plans'),
 ('anon','insert into public.packages (code, name) values (''iso-evil'', ''Evil'')','blocked','anon cannot create plans'),
 ('padmin','insert into public.packages (code, name) values (''iso-new'', ''New'')','blocked','platform admin cannot insert a plan directly (admin_create_package RPC only)'),
 ('padmin','update public.packages set name = ''Iso Public 2'' where code = ''iso-pub''','blocked','platform admin cannot edit a plan directly (admin_update_package RPC only)'),
-- reserved_slugs, permissions, default_role_permissions: service role only
 ('oa','insert into public.reserved_slugs (slug) values (''iso-r'')','blocked','owner cannot add reserved slug'),
 ('padmin','insert into public.reserved_slugs (slug) values (''iso-r'')','blocked','padmin cannot add reserved slug (service role only)'),
 ('padmin','delete from public.reserved_slugs where slug = ''www''','blocked','padmin cannot delete reserved slug'),
 ('oa','update public.permissions set description = ''x'' where key = ''menu.manage''','blocked','owner cannot edit permission catalog'),
 ('padmin','insert into public.permissions (key, category, description) values (''x.y'',''x'',''x'')','blocked','padmin cannot edit permission catalog'),
 ('oa','delete from public.permissions where key = ''menu.manage''','blocked','owner cannot delete permission'),
 ('oa','insert into public.default_role_permissions values (''cashier'',''billing.manage'')','blocked','owner cannot change role templates'),
 ('padmin','delete from public.default_role_permissions where role_key = ''cashier''','blocked','padmin cannot change role templates'),
-- subscriptions: platform admin writes only
 ('oa','update public.subscriptions set status = ''canceled'' where organization_id = {A}','blocked','owner cannot edit own subscription'),
 ('ma','update public.subscriptions set status = ''canceled'' where organization_id = {A}','blocked','manager cannot do billing writes'),
 ('ob','update public.subscriptions set status = ''canceled'' where organization_id = {A}','blocked','org B cannot cancel org A'),
 ('oa','update public.subscriptions set package_id = (select id from public.packages where code = ''iso-priv'') where organization_id = {A}','blocked','tenant cannot switch own plan'),
 ('ob','insert into public.subscriptions (organization_id, package_id) select {A}, id from public.packages limit 1','blocked','org B cannot add subscription to A'),
 ('oa','delete from public.subscriptions where organization_id = {A}','blocked','owner cannot delete subscription'),
 ('padmin','update public.subscriptions set billing_period = ''yearly'' where organization_id = {A}','ok','platform admin edits subscription'),
-- locations
 ('oa','insert into public.locations (organization_id, name) values ({A}, ''New A'')','ok','owner adds location'),
 ('oa','insert into public.locations (organization_id, name) values ({B}, ''Smuggled'')','blocked','owner A cannot add location to B'),
 ('ma','insert into public.locations (organization_id, name) values ({A}, ''x'')','blocked','manager lacks locations.manage'),
 ('ca','insert into public.locations (organization_id, name) values ({A}, ''x'')','blocked','cashier cannot add location'),
 ('ob','insert into public.locations (organization_id, name) values ({A}, ''x'')','blocked','org B cannot add location to A'),
 ('oa','update public.locations set name = ''A1 renamed'' where id = {A1}','ok','owner edits location'),
 ('ma','update public.locations set name = ''x'' where id = {A1}','blocked','manager cannot edit location'),
 ('ob','update public.locations set name = ''pwn'' where id = {A1}','blocked','org B cannot edit A location'),
 ('oa','update public.locations set name = ''pwn'' where id = {B1}','blocked','owner A cannot edit B location'),
 ('oa','update public.locations set organization_id = {B} where id = {A1}','blocked','cannot move location to another org'),
 ('oa','delete from public.locations where id = {A2}','blocked','no hard delete of locations'),
 ('anon','insert into public.locations (organization_id, name) values ({A}, ''x'')','blocked','anon cannot add location'),
-- roles: owner only, non-system only
 ('oa','insert into public.roles (organization_id, key, name) values ({A}, ''iso_custom'', ''Custom'')','ok','owner creates custom role'),
 ('oa','insert into public.roles (organization_id, key, name, is_system) values ({A}, ''iso_sys'', ''Sys'', true)','blocked','owner cannot create system role'),
 ('oa','insert into public.roles (organization_id, key, name) values ({A}, ''owner'', ''Owner2'')','blocked','custom role cannot reuse a system key'),
 ('ma','insert into public.roles (organization_id, key, name) values ({A}, ''iso_m'', ''M'')','blocked','manager cannot create roles'),
 ('ca','insert into public.roles (organization_id, key, name) values ({A}, ''iso_c'', ''C'')','blocked','cashier cannot create roles'),
 ('ob','insert into public.roles (organization_id, key, name) values ({A}, ''iso_b'', ''B'')','blocked','org B cannot create role in A'),
 ('oa','insert into public.roles (organization_id, key, name) values ({B}, ''iso_x'', ''X'')','blocked','owner A cannot create role in B'),
 ('oa','update public.roles set name = ''Scratch A2'' where id = {SA}','ok','owner renames custom role'),
 ('ma','update public.roles set name = ''x'' where id = {SA}','blocked','manager cannot edit roles'),
 ('ca','update public.roles set name = ''x'' where id = {SA}','blocked','cashier cannot edit roles'),
 ('ob','update public.roles set name = ''pwn'' where id = {SA}','blocked','org B cannot edit A role'),
 ('oa','update public.roles set name = ''pwn'' where id = {SB}','blocked','owner A cannot edit B role'),
 ('oa','update public.roles set name = ''Hax'' where id = tests.role_id(''A'',''owner'')','blocked','system role cannot be renamed'),
 ('oa','delete from public.roles where id = tests.role_id(''A'',''owner'')','blocked','system owner role cannot be deleted'),
 ('oa','delete from public.roles where id = tests.role_id(''A'',''cashier'')','blocked','system cashier role cannot be deleted'),
 ('ma','delete from public.roles where id = {SA}','blocked','manager cannot delete roles'),
 ('ob','delete from public.roles where id = {SA}','blocked','org B cannot delete A role'),
-- role_permissions
 ('ca','insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''cashier''), {A}, ''billing.manage'')','blocked','cashier cannot grant self billing.manage'),
 ('ca','insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''cashier''), {A}, ''staff.manage'')','blocked','cashier cannot grant self staff.manage'),
 ('ma','insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''manager''), {A}, ''billing.manage'')','blocked','manager cannot grant self billing.manage'),
 ('ob','insert into public.role_permissions (role_id, organization_id, permission_key) values ({SA}, {A}, ''menu.manage'')','blocked','org B cannot edit A role perms'),
 ('ob','insert into public.role_permissions (role_id, organization_id, permission_key) values ({SA}, {B}, ''menu.manage'')','blocked','org B cannot attach A role via own org id'),
 ('oa','insert into public.role_permissions (role_id, organization_id, permission_key) values (tests.role_id(''A'',''owner''), {A}, ''menu.manage'')','blocked','owner role permissions are not editable'),
 ('oa','insert into public.role_permissions (role_id, organization_id, permission_key) values ({SA}, {A}, ''menu.manage'')','ok','owner edits custom role permissions'),
 ('ma','delete from public.role_permissions where role_id = {SA}','blocked','manager cannot remove role permissions'),
 ('ca','delete from public.role_permissions where organization_id = {A}','blocked','cashier cannot remove role permissions'),
 ('ob','delete from public.role_permissions where organization_id = {A}','blocked','org B cannot remove A role permissions'),
 ('oa','update public.role_permissions set permission_key = ''billing.manage'' where organization_id = {A}','blocked','role_permissions are not updatable'),
-- organization_members
 ('ca','update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uca}','blocked','cashier cannot promote self'),
 ('ca','update public.organization_members set role_id = tests.role_id(''A'',''owner'') where user_id = {uca}','blocked','cashier cannot make self owner'),
 ('ca','update public.organization_members set all_locations = true where user_id = {uca}','blocked','cashier cannot widen own location scope'),
 ('wa','update public.organization_members set role_id = tests.role_id(''A'',''manager'') where user_id = {uwa}','blocked','waiter cannot promote self'),
 ('ka','update public.organization_members set status = ''deactivated'' where user_id = {uoa}','blocked','kitchen cannot deactivate owner'),
 ('da','update public.organization_members set status = ''active'' where user_id = {uda}','blocked','deactivated member cannot reactivate self'),
 ('ma','update public.organization_members set role_id = tests.role_id(''A'',''owner'') where user_id = {uma}','blocked','manager cannot make self owner'),
 ('ma','update public.organization_members set role_id = tests.role_id(''A'',''owner'') where user_id = {uca}','blocked','manager cannot grant owner role'),
 ('ma','update public.organization_members set status = ''deactivated'' where user_id = {uoa}','blocked','manager cannot deactivate an owner'),
 ('ma','update public.organization_members set role_id = tests.role_id(''A'',''waiter'') where user_id = {uoa}','blocked','manager cannot demote an owner'),
 ('ma','update public.organization_members set organization_id = {B} where user_id = {uca}','blocked','cannot move member to another org'),
 ('ma','update public.organization_members set user_id = {uout} where user_id = {uca}','blocked','user_id is not editable'),
 ('ma','update public.organization_members set role_id = tests.role_id(''B'',''cashier'') where user_id = {uca}','blocked','cannot assign a role from another org'),
 ('ob','update public.organization_members set status = ''deactivated'' where organization_id = {A}','blocked','org B cannot deactivate A members'),
 ('out','update public.organization_members set status = ''deactivated'' where organization_id = {A}','blocked','non-member cannot deactivate A members'),
 ('anon','update public.organization_members set status = ''deactivated'' where organization_id = {A}','blocked','anon cannot deactivate A members'),
 ('oa','insert into public.organization_members (organization_id, user_id, role_id) values ({A}, {uout}, tests.role_id(''A'',''cashier''))','blocked','no client membership insert (owner)'),
 ('out','insert into public.organization_members (organization_id, user_id, role_id) values ({A}, {uout}, tests.role_id(''A'',''owner''))','blocked','user cannot add self to org'),
 ('ob','insert into public.organization_members (organization_id, user_id, role_id) values ({A}, {uob}, tests.role_id(''A'',''owner''))','blocked','org B owner cannot add self to A'),
 -- NEW behaviour (DAVIN follow-up): no client DELETE on organization_members, deactivate only
 ('oa','delete from public.organization_members where user_id = {uka}','blocked','owner cannot hard-delete a member'),
 ('ma','delete from public.organization_members where user_id = {uca}','blocked','manager cannot hard-delete a member'),
 ('ob','delete from public.organization_members where organization_id = {A}','blocked','org B cannot delete A members'),
 ('ma','update public.organization_members set role_id = tests.role_id(''A'',''waiter'') where user_id = {uca}','ok','manager changes cashier to waiter'),
 ('oa','update public.organization_members set status = ''deactivated'' where user_id = {uka}','ok','owner deactivates a member'),
-- location_staff
 ('ca','insert into public.location_staff (member_id, location_id, organization_id) select id, {A2}, {A} from public.organization_members where user_id = {uca}','blocked','cashier cannot give self a location'),
 ('ob','insert into public.location_staff (member_id, location_id, organization_id) select id, {A1}, {A} from public.organization_members where user_id = {uob}','blocked','org B member cannot attach to A location (org A id)'),
 ('ob','insert into public.location_staff (member_id, location_id, organization_id) select id, {A1}, {B} from public.organization_members where user_id = {uob}','blocked','org B member cannot attach to A location (org B id, composite FK)'),
 ('ma','insert into public.location_staff (member_id, location_id, organization_id) select id, {B1}, {A} from public.organization_members where user_id = {uca}','blocked','A member cannot be attached to B location (composite FK)'),
 ('ma','insert into public.location_staff (member_id, location_id, organization_id) select id, {A2}, {A} from public.organization_members where user_id = {uca}','ok','manager assigns cashier to A2'),
 ('ca','delete from public.location_staff where organization_id = {A}','blocked','cashier cannot unassign'),
 ('ob','delete from public.location_staff where organization_id = {A}','blocked','org B cannot unassign A staff'),
-- org_branding
 ('ca','update public.org_branding set primary_color = ''#000000'' where organization_id = {A}','blocked','cashier cannot edit branding'),
 ('ob','update public.org_branding set primary_color = ''#000000'' where organization_id = {A}','blocked','org B cannot edit A branding'),
 ('out','update public.org_branding set primary_color = ''#000000'' where organization_id = {A}','blocked','non-member cannot edit branding'),
 ('anon','update public.org_branding set primary_color = ''#000000'' where organization_id = {A}','blocked','anon cannot edit branding'),
 ('ma','update public.org_branding set primary_color = ''#112233'' where organization_id = {A}','ok','manager edits branding'),
 ('oa','update public.org_branding set organization_id = {B} where organization_id = {A}','blocked','branding cannot be moved'),
 ('ob','insert into public.org_branding (organization_id) values ({A})','blocked','org B cannot insert A branding'),
 ('oa','delete from public.org_branding where organization_id = {A}','blocked','no branding delete'),
-- audit_logs: append-only via private.write_audit, never client-writable
 ('oa','insert into public.audit_logs (organization_id, action) values ({A}, ''forged'')','blocked','owner cannot forge audit rows'),
 ('padmin','insert into public.audit_logs (action) values (''forged'')','blocked','padmin cannot forge audit rows'),
 ('oa','update public.audit_logs set action = ''erased'' where organization_id = {A}','blocked','owner cannot edit audit rows'),
 ('oa','delete from public.audit_logs where organization_id = {A}','blocked','owner cannot erase audit rows'),
 ('padmin','delete from public.audit_logs','blocked','padmin cannot erase audit rows'),
 ('ob','delete from public.audit_logs where organization_id = {A}','blocked','org B cannot erase A audit rows'),
-- platform_settings: no client access
 ('padmin','insert into public.platform_settings (key, value) values (''iso_x'', ''{}'')','blocked','padmin cannot insert settings from client'),
 ('padmin','update public.platform_settings set value = ''{}'' where key = ''iso_test''','blocked','padmin cannot update settings from client'),
 ('padmin','delete from public.platform_settings','blocked','padmin cannot delete settings'),
 ('oa','update public.platform_settings set value = ''{}''','blocked','owner cannot update settings'),
 ('anon','insert into public.platform_settings (key, value) values (''iso_x'', ''{}'')','blocked','anon cannot insert settings');

create function tests.run_writes() returns setof text language plpgsql as $$
declare s record; n bigint;
begin
  for s in select * from tests.write_specs order by ord loop
    n := tests.aff(s.actor, s.stmt);
    if s.expect = 'ok' then
      return next is(n, 1::bigint, s.actor || ': ' || s.label);
    else
      return next cmp_ok(n, '<=', 0::bigint, s.actor || ': ' || s.label);
    end if;
  end loop;
end $$;

select * from tests.run_writes();

-- Denied writes must leave the data untouched (checked as postgres).
select is((select name from public.organizations where slug = 'iso-org-b'), 'Iso B', 'org B name unchanged');
select is((select status from public.organizations where slug = 'iso-org-a'), 'active', 'org A status unchanged');
select is((select count(*)::int from public.platform_admins where user_id in (select uid from tests.actors)), 1, 'still exactly one platform admin among the fixture users');
select is((select count(*)::int from public.organization_members where organization_id = (select id from tests.ids where name = 'A')), 6, 'no member rows added or deleted in A');
select is((select count(*)::int from public.audit_logs where action in ('forged','erased')), 0, 'no forged audit rows');
select is((select count(*)::int from public.audit_logs where action like 'iso.%'), 4, 'fixture audit rows intact');
select is((select count(*)::int from public.reserved_slugs where slug in ('iso-r')), 0, 'no reserved slug added');
select is((select count(*)::int from public.platform_settings where key like 'iso%'), 1, 'fixture platform_settings row untouched');

select * from finish();
rollback;
