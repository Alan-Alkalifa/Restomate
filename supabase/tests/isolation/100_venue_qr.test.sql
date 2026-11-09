-- MVM-T02: QR RPCs: resolve_table_qr (anon enumeration), rotate_table_qr_token (permissions, no oracle),
-- get_table_qr_tokens (the only token reader), token quality and privileges.
begin;
\ir _helpers.inc
\ir _rpc.inc
\ir _venue.inc
select plan(95);

create table tests.tok (name text primary key, val text);
grant select on tests.tok to public;
create function tests.rq(tok text) returns text language sql stable as $$
  select format('select 1 from public.resolve_table_qr(%L)', tok)
$$;
grant execute on function tests.rq(text) to public;

-- ===== resolve_table_qr =====================================================================
select is(tests.cnt('anon', tests.rq('tok-a1')), 1::bigint, 'resolve: anon resolves an active table token');
select is(tests.cnt('oa',   tests.rq('tok-a1')), 1::bigint, 'resolve: authenticated resolves it too (public by design)');
select is(tests.cnt('ob',   tests.rq('tok-a1')), 1::bigint, 'resolve: a token is not scoped to the caller (other org owner)');
select is(tests.scalar('anon', $$(select org_slug from public.resolve_table_qr('tok-a1'))$$), 'iso-org-a', 'resolve: org slug');
select is(tests.scalar('anon', $$(select location_id from public.resolve_table_qr('tok-a1'))$$), (select id::text from tests.ids where name = 'A1'), 'resolve: location id');
select is(tests.scalar('anon', $$(select table_id from public.resolve_table_qr('tok-a1'))$$), (select id::text from tests.ids where name = 'TA1'), 'resolve: table id');
select is(tests.scalar('anon', $$(select label from public.resolve_table_qr('tok-a1'))$$), 'T1', 'resolve: label');
select is(pg_get_function_result('public.resolve_table_qr(text)'::regprocedure), 'TABLE(org_slug text, location_id uuid, table_id uuid, label text)', 'resolve: returns exactly org slug, location id, table id, label (no extra fields)');
select is(tests.scalar('anon', $$(select org_slug from public.resolve_table_qr('tok-b'))$$), 'iso-org-b', 'resolve: org B token resolves to org B only');

-- nothing comes back for anything that is not a live token
select is(tests.cnt('anon', tests.rq('tok-x')), 0::bigint, 'resolve: inactive table token returns nothing');
select is(tests.cnt('anon', tests.rq('nope')), 0::bigint, 'resolve: unknown token returns nothing');
select is(tests.cnt('anon', tests.rq('')), 0::bigint, 'resolve: empty token returns nothing');
select is(tests.cnt('anon', 'select 1 from public.resolve_table_qr(null)'), 0::bigint, 'resolve: null token returns nothing');
select is(tests.cnt('anon', tests.rq(' tok-a1')), 0::bigint, 'resolve: leading space is not trimmed');
select is(tests.cnt('anon', tests.rq('tok-a1 ')), 0::bigint, 'resolve: trailing space is not trimmed');
select is(tests.cnt('anon', tests.rq('TOK-A1')), 0::bigint, 'resolve: token match is case-sensitive');
select is(tests.cnt('anon', tests.rq('tok-a')), 0::bigint, 'resolve: a prefix does not match');
select is(tests.cnt('anon', tests.rq('tok-a1%')), 0::bigint, 'resolve: LIKE wildcard is literal');
select is(tests.cnt('anon', tests.rq('%')), 0::bigint, 'resolve: bare % matches nothing');
select is(tests.cnt('anon', tests.rq('x'' or ''1''=''1')), 0::bigint, 'resolve: SQL-ish input matches nothing');
select is(tests.cnt('anon', tests.rq(repeat('a', 10000))), 0::bigint, 'resolve: very long input is handled');
select is(tests.cnt('anon', tests.rq((select id::text from tests.ids where name = 'TA1'))), 0::bigint, 'resolve: a table id is not a token');
select is(tests.cnt('anon', 'select 1 from public.resolve_table_qr(''tok-a1'') union all select 1 from public.resolve_table_qr(''tok-a2'')'), 2::bigint, 'resolve: each token yields its own single row');

-- state gates (fixture edits run as postgres)
update public.organizations set status = 'suspended' where id = (select id from tests.ids where name = 'A');
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'resolve: suspended org returns nothing');
update public.organizations set status = 'read_only' where id = (select id from tests.ids where name = 'A');
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'resolve: read_only org returns nothing');
update public.organizations set status = 'past_due' where id = (select id from tests.ids where name = 'A');
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'resolve: past_due org returns nothing');
update public.organizations set status = 'active' where id = (select id from tests.ids where name = 'A');
select is(tests.cnt('anon', tests.rq('tok-a1')), 1::bigint, 'resolve: active again resolves');
update public.locations set is_active = false where id = (select id from tests.ids where name = 'A1');
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'resolve: inactive location returns nothing');
update public.locations set is_active = true where id = (select id from tests.ids where name = 'A1');
set local session_replication_role = replica;      -- bypass the AREA_NOT_EMPTY trigger to build the state
update public.areas set is_active = false where id = (select id from tests.ids where name = 'AR1');
set local session_replication_role = origin;
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'resolve: active table in an inactive area returns nothing');
update public.areas set is_active = true where id = (select id from tests.ids where name = 'AR1');
select is(tests.cnt('anon', tests.rq('tok-a1')), 1::bigint, 'resolve: area active again resolves');

-- ===== privileges ===========================================================================
select is(has_function_privilege('anon', 'public.resolve_table_qr(text)', 'execute'), true, 'priv: anon may execute resolve_table_qr');
select is(has_function_privilege('anon', 'public.rotate_table_qr_token(uuid)', 'execute'), false, 'priv: anon may not execute rotate_table_qr_token');
select is(has_function_privilege('anon', 'public.get_table_qr_tokens(uuid, uuid[])', 'execute'), false, 'priv: anon may not execute get_table_qr_tokens');
select is(has_function_privilege('authenticated', 'public.rotate_table_qr_token(uuid)', 'execute'), true, 'priv: authenticated may execute rotate (permission is checked inside)');
select is(tests.errmsg('oa', 'private.new_qr_token()'), 'permission denied for schema private|42501', 'priv: private.new_qr_token is not callable by clients');
select is(tests.errmsg('anon', 'private.new_qr_token()'), 'permission denied for schema private|42501', 'priv: nor by anon');

-- ===== rotate_table_qr_token: permission checks ================================================
select is(tests.errmsg('anon', $$public.rotate_table_qr_token({TA1})$$), 'permission denied for function rotate_table_qr_token|42501', 'rotate: anon denied');
select is(tests.errmsg('ca',  $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: cashier denied');
select is(tests.errmsg('wa',  $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: waiter denied');
select is(tests.errmsg('ka',  $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: kitchen denied');
select is(tests.errmsg('da',  $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: deactivated cashier denied');
select is(tests.errmsg('out', $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: non-member denied');
select is(tests.errmsg('ob',  $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: org B owner denied on an org A table');
select is(tests.errmsg('padmin', $$public.rotate_table_qr_token({TA1})$$), 'FORBIDDEN|42501', 'rotate: platform admin without membership denied');
select is(tests.errmsg('sm',  $$public.rotate_table_qr_token({TA2})$$), 'FORBIDDEN|42501', 'rotate: A1-scoped manager denied on an A2 table');
select is(tests.errmsg('oa',  $$public.rotate_table_qr_token({TB})$$), 'FORBIDDEN|42501', 'rotate: owner A denied on an org B table');
select is(tests.errmsg('oa',  $$public.rotate_table_qr_token(null::uuid)$$), 'FORBIDDEN|42501', 'rotate: null id is FORBIDDEN');
select is(tests.errmsg('oa',  $$public.rotate_table_qr_token(gen_random_uuid())$$), tests.errmsg('ob', $$public.rotate_table_qr_token({TA1})$$), 'rotate: unknown id and foreign id give the identical error (no existence oracle)');
select is(tests.errmsg('ob',  $$public.rotate_table_qr_token({TX})$$), 'FORBIDDEN|42501', 'rotate: foreign inactive table does not leak its state');
select is(tests.errmsg('oa',  $$public.rotate_table_qr_token({TX})$$), 'TABLE_INACTIVE|P0001', 'rotate: own inactive table is TABLE_INACTIVE');
select is(tests.cnt('anon', tests.rq('tok-a1')), 1::bigint, 'rotate: denied attempts left tok-a1 working');
select is(tests.cnt('anon', tests.rq('tok-a2')), 1::bigint, 'rotate: denied attempts left tok-a2 working');
select is(tests.cnt('anon', tests.rq('tok-b')), 1::bigint, 'rotate: denied attempts left org B''s token working');
select is((select qr_token from public.tables where id = (select id from tests.ids where name = 'TX')), 'tok-x', 'rotate: inactive table token unchanged');

-- ===== rotate_table_qr_token: success path =====================================================
insert into tests.tok select 'oa1', tests.scalar('oa', $$public.rotate_table_qr_token({TA1})$$);
select matches((select val from tests.tok where name = 'oa1'), '^[A-Za-z0-9_-]{32}$', 'rotate: owner gets a 32-char base64url token');
select isnt((select val from tests.tok where name = 'oa1'), 'tok-a1', 'rotate: new token differs from the old one');
select is((select qr_token from public.tables where id = (select id from tests.ids where name = 'TA1')), (select val from tests.tok where name = 'oa1'), 'rotate: stored token equals the returned token');
select ok((select qr_rotated_at is not null from public.tables where id = (select id from tests.ids where name = 'TA1')), 'rotate: qr_rotated_at set');
select is(tests.cnt('anon', tests.rq('tok-a1')), 0::bigint, 'rotate: the old token stops resolving immediately');
select is(tests.cnt('anon', tests.rq((select val from tests.tok where name = 'oa1'))), 1::bigint, 'rotate: the new token resolves');
insert into tests.tok select 'sm1', tests.scalar('sm', $$public.rotate_table_qr_token({TA1})$$);
select matches((select val from tests.tok where name = 'sm1'), '^[A-Za-z0-9_-]{32}$', 'rotate: scoped manager rotates a table in own location');
select is(tests.cnt('anon', tests.rq((select val from tests.tok where name = 'oa1'))), 0::bigint, 'rotate: the previously rotated token is dead too');
insert into tests.tok select 'ma1', tests.scalar('ma', $$public.rotate_table_qr_token({TA2})$$);
select matches((select val from tests.tok where name = 'ma1'), '^[A-Za-z0-9_-]{32}$', 'rotate: all-locations manager rotates an A2 table');
insert into tests.tok select 'ob1', tests.scalar('ob', $$public.rotate_table_qr_token({TB})$$);
select matches((select val from tests.tok where name = 'ob1'), '^[A-Za-z0-9_-]{32}$', 'rotate: org B owner rotates its own table');
select is(tests.cnt('anon', tests.rq('tok-b')), 0::bigint, 'rotate: org B old token dead');
select is((select count(distinct val)::int from tests.tok), 4, 'rotate: every rotation produced a different token');
select is((select count(*)::int from public.audit_logs where action = 'table.qr_rotated' and entity_id = (select id::text from tests.ids where name = 'TA1')), 2, 'rotate: each rotation of TA1 audited once');
select is((select count(*)::int from public.audit_logs a, tests.tok t where a.entity_type = 'table' and a.metadata::text like '%' || t.val || '%'), 0, 'rotate: audit never contains a token value');
select is((select count(*)::int from public.audit_logs a where a.entity_type = 'table' and a.metadata::text like '%tok-%'), 0, 'rotate: nor an old token value');

-- ===== get_table_qr_tokens =====================================================================
select is(pg_get_function_result('public.get_table_qr_tokens(uuid, uuid[])'::regprocedure), 'TABLE(table_id uuid, label text, area_name text, qr_token text)', 'tokens: returns exactly table id, label, area name, token');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), '1', 'tokens: owner gets active tables only (inactive TX excluded)');
select is(tests.scalar('oa', $$(select qr_token from public.get_table_qr_tokens({A1}) where table_id = {TA1})$$), (select val from tests.tok where name = 'sm1'), 'tokens: returns the current token');
select is(tests.scalar('oa', $$(select area_name from public.get_table_qr_tokens({A1}) where table_id = {TA1})$$), 'Indoor', 'tokens: area name returned');
select is(tests.scalar('ma', $$(select count(*) from public.get_table_qr_tokens({A2}))$$), '1', 'tokens: manager reads A2');
select is(tests.scalar('sm', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), '1', 'tokens: scoped manager reads own location');
select is(tests.errmsg('sm', $$(select count(*) from public.get_table_qr_tokens({A2}))$$), 'FORBIDDEN|42501', 'tokens: scoped manager denied on another location');
select is(tests.errmsg('ca', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: cashier denied');
select is(tests.errmsg('wa', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: waiter denied');
select is(tests.errmsg('ka', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: kitchen denied');
select is(tests.errmsg('da', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: deactivated denied');
select is(tests.errmsg('out', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: non-member denied');
select is(tests.errmsg('ob', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: org B owner denied on org A');
select is(tests.errmsg('padmin', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'FORBIDDEN|42501', 'tokens: platform admin without membership denied');
select is(tests.errmsg('anon', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'permission denied for function get_table_qr_tokens|42501', 'tokens: anon denied');
select is(tests.errmsg('oa', $$(select count(*) from public.get_table_qr_tokens(gen_random_uuid()))$$), tests.errmsg('ob', $$(select count(*) from public.get_table_qr_tokens({A1}))$$), 'tokens: unknown location and foreign location give the identical error');
select is(tests.errmsg('oa', $$(select count(*) from public.get_table_qr_tokens(null::uuid))$$), 'FORBIDDEN|42501', 'tokens: null location is FORBIDDEN');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, array[{TA1}]))$$), '1', 'tokens: filter by an own table id');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, array[{TX}]))$$), '0', 'tokens: filter on an inactive table returns nothing');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, array[{TB}]))$$), '0', 'tokens: an org B table id never returns a row');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, array[{TA2}]))$$), '0', 'tokens: a table of another location never returns a row');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, '{}'::uuid[]))$$), '0', 'tokens: empty id list returns nothing');
select is(tests.scalar('oa', $$(select count(*) from public.get_table_qr_tokens({A1}, null))$$), '1', 'tokens: null id list returns all active tables');

-- ===== token quality ===========================================================================
select is((select count(distinct private.new_qr_token())::int from generate_series(1, 300)), 300, 'quality: 300 generated tokens are all distinct');
select ok((select bool_and(t ~ '^[A-Za-z0-9_-]{32}$') from (select private.new_qr_token() t from generate_series(1, 300)) x), 'quality: every generated token is 32 chars of base64url (192 bits)');
select is(right(tests.stmt('postgres', format('update public.tables set qr_token = %L where id = {TB}', (select val from tests.tok where name = 'ma1'))), 5), '23505', 'quality: duplicate (live) token is refused by the unique constraint');

select * from finish();
rollback;
