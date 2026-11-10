-- MVM-T07: set_item_sold_out (permissions, scope, oracle, timezone boundary) and get_public_menu (anon visibility + whitelist).
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _menu.inc
select plan(105);

-- sw: a waiter of A assigned to A1 only (waiters in the base fixture have no location)
select tests.mkuser('sw');
insert into public.organization_members (organization_id, user_id, role_id, status, all_locations)
values ((select id from tests.ids where name = 'A'), (select id from tests.ids where name = 'usw'), tests.role_id('A', 'waiter'), 'active', false);
insert into public.location_staff (member_id, location_id, organization_id)
select m.id, (select id from tests.ids where name = 'A1'), m.organization_id
from public.organization_members m where m.user_id = (select id from tests.ids where name = 'usw');

create function tests.so(item text, loc text, flag text) returns text language sql stable as $$
  select format('public.set_item_sold_out({%s}, {%s}, %s)', loc, item, flag)
$$;
create function tests.pm(slug text, loc text) returns jsonb language sql stable as $$
  select tests.scalar('anon', format('public.get_public_menu(%L, {%s})', slug, loc))::jsonb
$$;
create function tests.keys(j jsonb) returns text language sql immutable as $$
  select string_agg(k, ',' order by k) from jsonb_object_keys(j) k
$$;
grant execute on function tests.so(text, text, text), tests.pm(text, text), tests.keys(jsonb) to public;

-- ===== set_item_sold_out: permissions =======================================================
select matches(tests.scalar('oa', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'sold out: owner allowed');
select is(tests.scalar('oa', tests.so('IA1', 'A1', 'false')), null, 'sold out: clearing returns null');
select matches(tests.scalar('ma', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'sold out: manager allowed');
select matches(tests.scalar('ca', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'sold out: cashier (orders.create) allowed at own location');
select matches(tests.scalar('sw', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'sold out: waiter allowed at own location');
select matches(tests.scalar('sm', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'sold out: scoped manager allowed at own location');
select is(tests.errmsg('ka', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: kitchen (no orders.create) denied');
select is(tests.errmsg('wa', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: waiter without any location denied');
select is(tests.errmsg('da', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: deactivated denied');
select is(tests.errmsg('ob', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: org B owner denied on org A');
select is(tests.errmsg('out', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: non-member denied');
select is(tests.errmsg('padmin', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: platform admin without membership denied');
select is(tests.errmsg('anon', tests.so('IA1', 'A1', 'true')), 'permission denied for function set_item_sold_out|42501', 'sold out: anon denied');
select is(tests.errmsg('ca', tests.so('IA1', 'A2', 'true')), 'FORBIDDEN|42501', 'sold out: cashier of A1 denied at A2');
select is(tests.errmsg('sw', tests.so('IA1', 'A2', 'true')), 'FORBIDDEN|42501', 'sold out: waiter of A1 denied at A2');
select is(tests.errmsg('sm', tests.so('IA1', 'A2', 'true')), 'FORBIDDEN|42501', 'sold out: A1-scoped manager denied at A2');
select is(tests.errmsg('oa', tests.so('IB', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: item of org B at an org A location denied');
select is(tests.errmsg('oa', tests.so('IB', 'B1', 'true')), 'FORBIDDEN|42501', 'sold out: owner A on org B location denied');
select is(tests.errmsg('ob', tests.so('IA1', 'B1', 'true')), 'FORBIDDEN|42501', 'sold out: owner B with an org A item at own location denied');
select is(tests.errmsg('oa', tests.so('IAX', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: inactive item denied');
select is(tests.errmsg('oa', $$public.set_item_sold_out({A1}, gen_random_uuid(), true)$$), 'FORBIDDEN|42501', 'sold out: unknown item gives the same error');
select is(tests.errmsg('oa', $$public.set_item_sold_out(gen_random_uuid(), {IA1}, true)$$), 'FORBIDDEN|42501', 'sold out: unknown location gives the same error');
select is(tests.errmsg('oa', tests.so('IA1', 'A1', 'null')), 'FORBIDDEN|42501', 'sold out: null flag denied');
select is(tests.errmsg('oa', $$public.set_item_sold_out(null, {IA1}, true)$$), 'FORBIDDEN|42501', 'sold out: null location denied');
select is(tests.errmsg('oa', $$public.set_item_sold_out({A1}, null, true)$$), 'FORBIDDEN|42501', 'sold out: null item denied');
update public.locations set is_active = false where id = (select id from tests.ids where name = 'A2');
select is(tests.errmsg('ma', tests.so('IA1', 'A2', 'true')), 'FORBIDDEN|42501', 'sold out: inactive location denied');
update public.locations set is_active = true where id = (select id from tests.ids where name = 'A2');
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(tests.errmsg('oa', tests.so('IA1', 'A1', 'true')), 'FORBIDDEN|42501', 'sold out: suspended org denied');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'A');
select is(has_function_privilege('anon', 'public.set_item_sold_out(uuid, uuid, boolean)', 'execute'), false, 'priv: anon cannot execute set_item_sold_out');
select is(has_function_privilege('anon', 'public.get_public_menu(text, uuid)', 'execute'), true, 'priv: anon can execute get_public_menu');

-- ===== set_item_sold_out: effects ===========================================================
select is(tests.scalar('oa', tests.so('IA1', 'A1', 'false')), null, 'effects: reset');
select is((select count(*)::int from public.location_menu_overrides where item_id = (select id from tests.ids where name = 'IA2') and location_id = (select id from tests.ids where name = 'A1')), 0, 'effects: no override row for IA2 yet');
select matches(tests.scalar('ca', tests.so('IA2', 'A1', 'true')), '^\d{4}-', 'effects: cashier sells out an item without an override');
select is((select count(*)::int from public.location_menu_overrides where item_id = (select id from tests.ids where name = 'IA2') and location_id = (select id from tests.ids where name = 'A1') and price_override is null and is_available), 1, 'effects: a plain override row was created (no price, available)');
select is(tests.scalar('ca', tests.so('IA2', 'A1', 'false')), null, 'effects: cashier clears it');
select is((select sold_out_until from public.location_menu_overrides where item_id = (select id from tests.ids where name = 'IA2') and location_id = (select id from tests.ids where name = 'A1')), null, 'effects: cleared');
select is((select count(*)::int from public.location_menu_overrides where organization_id = (select id from tests.ids where name = 'A')), 2, 'effects: org A has 2 override rows so far (OA1, IA2@A1)');
select is(tests.scalar('oa', tests.so('IA1', 'A2', 'false')), null, 'effects: clearing at a location with no override returns null');
select is((select count(*)::int from public.location_menu_overrides where organization_id = (select id from tests.ids where name = 'A')), 2, 'effects: clearing never creates a row');
insert into tests.ids values ('dummy', gen_random_uuid());
select matches(tests.scalar('ca', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'effects: sell out an item that has a price override and a station');
select is((select price_override from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), 27000::bigint, 'effects: the price override is untouched by the cashier');
select is((select kitchen_station_id from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), (select id from tests.ids where name = 'KA1'), 'effects: the station is untouched');
select is((select is_available from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), true, 'effects: is_available untouched');
select is(tests.scalar('ma', tests.so('IA1', 'A1', 'true')), (select sold_out_until::text from public.location_menu_overrides where id = (select id from tests.ids where name = 'OA1')), 'effects: repeating the call is idempotent (same end of day)');
select is((select count(*)::int from public.audit_logs where action = 'menu_override.sold_out' and actor_id = (select id from tests.ids where name = 'uca')), 2, 'effects: sell-outs audited with the cashier as actor');
select cmp_ok((select count(*)::int from public.audit_logs where action = 'menu_override.sold_out_cleared' and actor_id = (select id from tests.ids where name = 'uca')), '>=', 1, 'effects: clearing audited');

-- ===== end-of-day boundary in the location timezone ========================================
update public.locations set timezone = 'Pacific/Kiritimati' where id = (select id from tests.ids where name = 'A1');   -- UTC+14
update public.locations set timezone = 'Pacific/Pago_Pago'  where id = (select id from tests.ids where name = 'A2');   -- UTC-11
insert into tests.ids values ('KIRI', gen_random_uuid());
create table tests.until_ (name text primary key, val timestamptz);
grant select on tests.until_ to public;
insert into tests.until_ select 'kiri', tests.scalar('oa', tests.so('IA1', 'A1', 'true'))::timestamptz;
insert into tests.until_ select 'pago', tests.scalar('oa', tests.so('IA1', 'A2', 'true'))::timestamptz;
select is((select (val at time zone 'Pacific/Kiritimati')::time from tests.until_ where name = 'kiri'), '00:00'::time, 'tz: UTC+14 location: sold out until local midnight');
select is((select (val at time zone 'Pacific/Pago_Pago')::time from tests.until_ where name = 'pago'), '00:00'::time, 'tz: UTC-11 location: sold out until local midnight');
select is((select (val at time zone 'Pacific/Kiritimati')::date from tests.until_ where name = 'kiri'), ((now() at time zone 'Pacific/Kiritimati')::date + 1), 'tz: UTC+14: it is the NEXT local day');
select is((select (val at time zone 'Pacific/Pago_Pago')::date from tests.until_ where name = 'pago'), ((now() at time zone 'Pacific/Pago_Pago')::date + 1), 'tz: UTC-11: it is the NEXT local day');
select ok((select val > now() and val <= now() + interval '24 hours 1 minute' from tests.until_ where name = 'kiri'), 'tz: UTC+14: within the next 24h');
select ok((select val > now() and val <= now() + interval '24 hours 1 minute' from tests.until_ where name = 'pago'), 'tz: UTC-11: within the next 24h');
select isnt((select val from tests.until_ where name = 'kiri'), (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC', 'tz: not the next UTC midnight');
select isnt((select val from tests.until_ where name = 'pago'), (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC', 'tz: not the next UTC midnight (west)');
select isnt((select val from tests.until_ where name = 'kiri'), (select val from tests.until_ where name = 'pago'), 'tz: two locations get different instants');
select is((select sold_out_until from public.location_menu_overrides where location_id = (select id from tests.ids where name = 'A1') and item_id = (select id from tests.ids where name = 'IA1')), (select val from tests.until_ where name = 'kiri'), 'tz: stored value equals returned value');
update public.location_menu_overrides set sold_out_until = null where organization_id = (select id from tests.ids where name = 'A');
-- the item is hidden before that instant and shows again once it has passed
update public.locations set timezone = 'Asia/Jakarta' where id = (select id from tests.ids where name = 'A1');
update public.location_menu_overrides set sold_out_until = now() + interval '1 hour' where id = (select id from tests.ids where name = 'OA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'boundary: sold out until in the future -> hidden');
update public.location_menu_overrides set sold_out_until = now() - interval '1 second' where id = (select id from tests.ids where name = 'OA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 1, 'boundary: sold_out_until just passed -> visible again');
update public.location_menu_overrides set sold_out_until = now() where id = (select id from tests.ids where name = 'OA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 1, 'boundary: sold_out_until = now() -> visible (<= now())');
update public.location_menu_overrides set sold_out_until = null where id = (select id from tests.ids where name = 'OA1');

-- ===== get_public_menu ======================================================================
select ok(tests.pm('iso-org-a', 'A1') is not null, 'public: known org + location returns a menu');
select is(tests.pm('iso-org-a', 'A1') ->> 'currency', (select currency from public.locations where id = (select id from tests.ids where name = 'A1')), 'public: location currency');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 1, 'public: one category (Mains)');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items}'), 1, 'public: only the published, active item (IA2 unpublished and IAX inactive are hidden)');
select is(tests.pm('iso-org-a', 'A1') #>> '{categories,0,items,0,name}', 'Nasi', 'public: the visible item');
select is((tests.pm('iso-org-a', 'A1') #>> '{categories,0,items,0,price}')::bigint, 27000::bigint, 'public: effective price is the location override');
select is((tests.pm('iso-org-a', 'A2') #>> '{categories,0,items,0,price}')::bigint, 25000::bigint, 'public: no override -> base price');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,variants}'), 1, 'public: active variant listed');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,modifier_groups}'), 1, 'public: modifier group listed');
select is(tests.keys(tests.pm('iso-org-a', 'A1')), 'categories,currency', 'public: top-level keys are whitelisted');
select is(tests.keys(tests.pm('iso-org-a', 'A1') #> '{categories,0}'), 'description,id,items,name', 'public: category keys are whitelisted');
select is(tests.keys(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0}'), 'description,dietary_tags,id,image_path,modifier_groups,name,price,variants', 'public: item keys are whitelisted (no org id, base price, flags, station, sold-out state)');
select is(tests.keys(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,variants,0}'), 'id,name,price_delta', 'public: variant keys');
select is(tests.keys(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,modifier_groups,0}'), 'id,max_select,min_select,modifiers,name', 'public: group keys');
select is(tests.keys(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,modifier_groups,0,modifiers,0}'), 'id,name,price_delta', 'public: modifier keys');
select ok(tests.pm('iso-org-a', 'A1')::text !~ 'organization_id|location_id|kitchen_station|sold_out|is_published|is_active|is_available|base_price|price_override|sort_order|created_at|updated_at', 'public: no internal field names anywhere in the payload');
select is(tests.pm('iso-org-a', 'A1')::text like '%Hidden%' or tests.pm('iso-org-a', 'A1')::text like '%Retired%', false, 'public: unpublished / inactive item names never appear');
select is(tests.pm('iso-org-a', 'A1')::text like '%Tea%', false, 'public: nothing from org B');
select is(tests.pm('iso-org-b', 'B1') #>> '{categories,0,items,0,name}', 'Tea', 'public: org B shows its own item');
select is(tests.pm('iso-org-b', 'B1')::text like '%Nasi%', false, 'public: org B shows nothing of org A');

-- unknown / mismatched inputs return null, never an error or a hint
select is(tests.pm('no-such-org', 'A1'), null, 'public: unknown slug -> null');
select is(tests.pm('iso-org-b', 'A1'), null, 'public: slug of B with a location of A -> null');
select is(tests.pm('iso-org-a', 'B1'), null, 'public: slug of A with a location of B -> null');
select is(tests.scalar('anon', $$public.get_public_menu('iso-org-a', gen_random_uuid())$$), null, 'public: unknown location -> null');
select is(tests.scalar('anon', $$public.get_public_menu(null, {A1})$$), null, 'public: null slug -> null');
select is(tests.scalar('anon', $$public.get_public_menu('iso-org-a', null)$$), null, 'public: null location -> null');
select is(tests.scalar('anon', $$public.get_public_menu('', {A1})$$), null, 'public: empty slug -> null');
select is(tests.scalar('anon', $$public.get_public_menu('iso-org-a'' or ''1''=''1', {A1})$$), null, 'public: SQL-ish slug -> null');
select ok(tests.pm('  ISO-ORG-A ', 'A1') is not null, 'public: slug is trimmed and case-insensitive');
select ok(tests.scalar('ob', $$public.get_public_menu('iso-org-a', {A1})$$) is not null, 'public: also readable when signed in (it is public data)');

-- visibility gates
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(tests.pm('iso-org-a', 'A1'), null, 'gate: suspended org -> null');
update public.organizations set status = 'read_only' where id = (select id from tests.ids where name = 'A');
select is(tests.pm('iso-org-a', 'A1'), null, 'gate: read_only org -> null');
update public.organizations set status = 'past_due' where id = (select id from tests.ids where name = 'A');
select is(tests.pm('iso-org-a', 'A1'), null, 'gate: past_due org -> null');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'A');
update public.locations set is_active = false where id = (select id from tests.ids where name = 'A1');
select is(tests.pm('iso-org-a', 'A1'), null, 'gate: inactive location -> null');
update public.locations set is_active = true where id = (select id from tests.ids where name = 'A1');

update public.location_menu_overrides set is_available = false where id = (select id from tests.ids where name = 'OA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'gate: switched off at this location -> hidden (and the empty category disappears)');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A2') -> 'categories'), 1, 'gate: still visible at another location');
update public.location_menu_overrides set is_available = true where id = (select id from tests.ids where name = 'OA1');
update public.menu_items set is_published = false where id = (select id from tests.ids where name = 'IA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'gate: unpublished -> hidden');
update public.menu_items set is_published = true, is_active = false where id = (select id from tests.ids where name = 'IA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'gate: inactive item -> hidden');
update public.menu_items set is_active = true where id = (select id from tests.ids where name = 'IA1');
update public.menu_categories set is_active = false where id = (select id from tests.ids where name = 'CA1');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'gate: inactive category hides its items');
update public.menu_categories set is_active = true where id = (select id from tests.ids where name = 'CA1');
update public.item_variants set is_active = false where id = (select id from tests.ids where name = 'VA');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,variants}'), 0, 'gate: inactive variant not listed');
update public.item_variants set is_active = true where id = (select id from tests.ids where name = 'VA');
update public.modifiers set is_active = false where id = (select id from tests.ids where name = 'MA');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,modifier_groups}'), 0, 'gate: a group whose modifiers are all inactive is omitted');
update public.modifiers set is_active = true where id = (select id from tests.ids where name = 'MA');
update public.modifier_groups set is_active = false where id = (select id from tests.ids where name = 'GA');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') #> '{categories,0,items,0,modifier_groups}'), 0, 'gate: inactive group omitted');
update public.modifier_groups set is_active = true where id = (select id from tests.ids where name = 'GA');
-- end to end: a cashier sells out, the guest no longer sees it
select matches(tests.scalar('ca', tests.so('IA1', 'A1', 'true')), '^\d{4}-', 'e2e: cashier marks Nasi sold out');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 0, 'e2e: the guest menu no longer lists it');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A2') -> 'categories'), 1, 'e2e: other locations are unaffected');
select is(tests.scalar('ca', tests.so('IA1', 'A1', 'false')), null, 'e2e: cashier brings it back');
select is(jsonb_array_length(tests.pm('iso-org-a', 'A1') -> 'categories'), 1, 'e2e: visible again');

select * from finish();
rollback;
