-- B1-T12: save_item_variants / save_group_modifiers apply a full list in one transaction.
begin;
select plan(34);

insert into public.packages (code, name, limits) values ('t-atm', 'Atomic', '{}');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', now(), now(), now()
from generate_series(1, 4) n;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.org(s text) returns uuid language sql security definer as $$ select id from public.organizations where slug = s $$;
create function pg_temp.role(s text, k text) returns uuid language sql security definer as $$
  select r.id from public.roles r where r.organization_id = pg_temp.org(s) and r.key = k $$;
create function pg_temp.item(n text) returns uuid language sql security definer as $$ select id from public.menu_items where name = n $$;
create function pg_temp.grp(n text) returns uuid language sql security definer as $$ select id from public.modifier_groups where name = n $$;
create function pg_temp.var(n text) returns uuid language sql security definer as $$ select id from public.item_variants where name = n $$;
create function pg_temp.mod(n text) returns uuid language sql security definer as $$ select id from public.modifiers where name = n $$;
create function pg_temp.names(q text) returns text language plpgsql security definer as $$
declare r text; begin execute q into r; return r; end $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.create_organization('Atm A', 'atm-a', '{"name":"L1"}'::jsonb, null, 't-atm');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select public.create_organization('Atm B', 'atm-b', '{"name":"B1"}'::jsonb, null, 't-atm');
reset role;
insert into public.organization_members (organization_id, user_id, role_id, all_locations) values
  (pg_temp.org('atm-a'), pg_temp.uid(2), pg_temp.role('atm-a', 'manager'), true),
  (pg_temp.org('atm-a'), pg_temp.uid(3), pg_temp.role('atm-a', 'cashier'), true);

insert into public.menu_categories (organization_id, name) values (pg_temp.org('atm-a'), 'AC'), (pg_temp.org('atm-b'), 'BC');
insert into public.menu_items (organization_id, category_id, name, base_price) values
  (pg_temp.org('atm-a'), (select id from public.menu_categories where name = 'AC'), 'AItem', 1000),
  (pg_temp.org('atm-a'), (select id from public.menu_categories where name = 'AC'), 'AItem2', 1000),
  (pg_temp.org('atm-b'), (select id from public.menu_categories where name = 'BC'), 'BItem', 1000);
insert into public.item_variants (organization_id, item_id, name, price_delta, sort_order) values
  (pg_temp.org('atm-a'), pg_temp.item('AItem'), 'VA', 0, 0), (pg_temp.org('atm-a'), pg_temp.item('AItem'), 'VB', 500, 1),
  (pg_temp.org('atm-a'), pg_temp.item('AItem2'), 'VOther', 0, 0), (pg_temp.org('atm-b'), pg_temp.item('BItem'), 'VForeign', 0, 0);
insert into public.modifier_groups (organization_id, name) values (pg_temp.org('atm-a'), 'AGroup'), (pg_temp.org('atm-b'), 'BGroup');
insert into public.modifiers (organization_id, group_id, name, price_delta, sort_order) values
  (pg_temp.org('atm-a'), pg_temp.grp('AGroup'), 'MA', 100, 0), (pg_temp.org('atm-a'), pg_temp.grp('AGroup'), 'MB', 200, 1),
  (pg_temp.org('atm-b'), pg_temp.grp('BGroup'), 'MForeign', 0, 0);
delete from public.audit_logs;

-- ---- permissions ------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(3));
select throws_ok(format($$select public.save_item_variants(%L, '[]')$$, pg_temp.item('AItem')), '42501', 'FORBIDDEN', 'cashier cannot save variants');
select throws_ok(format($$select public.save_group_modifiers(%L, '[]')$$, pg_temp.grp('AGroup')), '42501', 'FORBIDDEN', 'cashier cannot save modifiers');
reset role;
select pg_temp.act_as(pg_temp.uid(4));
select throws_ok(format($$select public.save_item_variants(%L, '[]')$$, pg_temp.item('AItem')), '42501', 'FORBIDDEN', 'owner B cannot save variants of A''s item');
select throws_ok(format($$select public.save_group_modifiers(%L, '[]')$$, pg_temp.grp('AGroup')), '42501', 'FORBIDDEN', 'owner B cannot save modifiers of A''s group');
reset role;
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok($$select public.save_item_variants(gen_random_uuid(), '[]')$$, '42501', 'FORBIDDEN', 'unknown item looks the same as forbidden');
select throws_ok($$select public.save_group_modifiers(gen_random_uuid(), '[]')$$, '42501', 'FORBIDDEN', 'unknown group looks the same as forbidden');
reset role;
set local role anon;
select throws_ok(format($$select public.save_item_variants(%L, '[]')$$, pg_temp.item('AItem')), '42501', null, 'anon cannot call save_item_variants');
reset role;

-- ---- happy path -------------------------------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'),
  json_build_array(json_build_object('id', pg_temp.var('VB'), 'name', 'VB renamed', 'priceDelta', 700),
                   json_build_object('name', 'VNew', 'priceDelta', '-250'))::text), 'manager saves a mixed list');
reset role;
select is((select is_active from public.item_variants where name = 'VA'), false, 'a variant missing from the list is deactivated');
select is((select name || ':' || price_delta || ':' || sort_order || ':' || is_active from public.item_variants where id = pg_temp.var('VB renamed')), 'VB renamed:700:0:true', 'a listed variant is updated with its list position');
select is((select price_delta || ':' || sort_order from public.item_variants where name = 'VNew'), '-250:1', 'a new variant is inserted (negative delta allowed, numeric string accepted)');
select is((select count(*)::int from public.item_variants where item_id = pg_temp.item('AItem2') and is_active), 1, 'another item''s variants are untouched');
select is(pg_temp.names($$select string_agg(action, ',' order by action) from public.audit_logs where entity_type = 'item_variant'$$),
  'item_variant.created,item_variant.deactivated,item_variant.price_changed,item_variant.updated', 'audit rows are written for the changes');

-- reactivation + empty list
select pg_temp.act_as(pg_temp.uid(2));
select lives_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'), json_build_array(json_build_object('id', pg_temp.var('VA'), 'name', 'VA', 'priceDelta', 0))::text), 'a deactivated variant can be reactivated by listing it');
select is((select is_active from public.item_variants where name = 'VA'), true, 'VA is active again');
select is((select count(*)::int from public.item_variants where item_id = pg_temp.item('AItem') and is_active), 1, 'and the rest are deactivated');
select lives_ok(format($$select public.save_item_variants(%L, '[]')$$, pg_temp.item('AItem')), 'an empty list is allowed');
select is((select count(*)::int from public.item_variants where item_id = pg_temp.item('AItem') and is_active), 0, 'an empty list deactivates everything');
reset role;

-- ---- atomicity: nothing changes when the list fails half way ------------------------------------------------------
update public.item_variants set is_active = true where item_id = pg_temp.item('AItem');
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'),
  json_build_array(json_build_object('id', pg_temp.var('VA'), 'name', 'VA changed', 'priceDelta', 1),
                   json_build_object('name', 'Dup', 'priceDelta', 1), json_build_object('name', 'dup', 'priceDelta', 2))::text),
  '23505', null, 'a duplicate name in the list fails the whole save');
reset role;
select is((select count(*)::int from public.item_variants where item_id = pg_temp.item('AItem') and is_active and name in ('VA', 'VB renamed')), 2, 'atomic: the deactivations were rolled back');
select is((select count(*)::int from public.item_variants where name in ('VA changed', 'Dup', 'dup')), 0, 'atomic: the update and inserts were rolled back');

select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'),
  json_build_array(json_build_object('name', 'Fine', 'priceDelta', 1), json_build_object('id', pg_temp.var('VForeign'), 'name', 'X', 'priceDelta', 1))::text),
  '42501', 'FORBIDDEN', 'a variant id from another org fails the whole save');
select throws_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'),
  json_build_array(json_build_object('id', pg_temp.var('VOther'), 'name', 'X', 'priceDelta', 1))::text),
  '42501', 'FORBIDDEN', 'a variant id from another item (same org) is rejected');
reset role;
select is((select count(*)::int from public.item_variants where name in ('Fine', 'X')), 0, 'atomic: nothing from the rejected lists was written');

-- ---- validation inside the RPC (callable directly by any client) ---------------------------------------------------
select pg_temp.act_as(pg_temp.uid(2));
select throws_ok(format($$select public.save_item_variants(%L, '{"name":"x"}')$$, pg_temp.item('AItem')), '22023', 'INVALID_LIST', 'a non-array is rejected');
select throws_ok(format($$select public.save_item_variants(%L, '[{"name":"","priceDelta":1}]')$$, pg_temp.item('AItem')), '22023', 'INVALID_LIST', 'an empty name is rejected');
select throws_ok(format($$select public.save_item_variants(%L, '[{"name":"A","priceDelta":1.5}]')$$, pg_temp.item('AItem')), '22023', 'INVALID_LIST', 'a non-integer price is rejected');
select throws_ok(format($$select public.save_item_variants(%L, '[{"name":"A","priceDelta":1000000000001}]')$$, pg_temp.item('AItem')), '22023', 'INVALID_LIST', 'a price over 1e12 is rejected');
select throws_ok(format($$select public.save_item_variants(%L, '[{"name":"A","priceDelta":1,"organization_id":"x"}]')$$, pg_temp.item('AItem')), '22023', 'INVALID_LIST', 'unknown keys are rejected');
select throws_ok(format($$select public.save_item_variants(%L, %L::jsonb)$$, pg_temp.item('AItem'),
  (select jsonb_agg(jsonb_build_object('name', 'V' || n, 'priceDelta', 0)) from generate_series(1, 21) n)::text), '22023', 'INVALID_LIST', 'more than 20 variants are rejected');

-- ---- modifiers: same semantics, price_delta >= 0, up to 30 ----------------------------------------------------------
select lives_ok(format($$select public.save_group_modifiers(%L, %L::jsonb)$$, pg_temp.grp('AGroup'),
  json_build_array(json_build_object('id', pg_temp.mod('MB'), 'name', 'MB2', 'priceDelta', 250), json_build_object('name', 'MNew', 'priceDelta', 50))::text), 'manager saves modifiers');
select throws_ok(format($$select public.save_group_modifiers(%L, '[{"name":"Neg","priceDelta":-1}]')$$, pg_temp.grp('AGroup')), '22023', 'INVALID_LIST', 'a negative modifier price is rejected');
select throws_ok(format($$select public.save_group_modifiers(%L, %L::jsonb)$$, pg_temp.grp('AGroup'),
  json_build_array(json_build_object('id', pg_temp.mod('MForeign'), 'name', 'X', 'priceDelta', 1))::text), '42501', 'FORBIDDEN', 'a modifier id from another org is rejected');
reset role;
select is((select string_agg(name || ':' || is_active, ',' order by name) from public.modifiers where group_id = pg_temp.grp('AGroup')), 'MA:false,MB2:true,MNew:true',
  'modifiers: updated, inserted and the missing one deactivated');

select * from finish();
rollback;
