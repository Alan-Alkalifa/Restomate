-- B1-T24: "en" and "id" are reserved slugs (the static /en segment would shadow an organization called "en").
begin;
select plan(9);

select is((select count(*)::int from public.reserved_slugs where slug in ('en', 'id')), 2, 'en and id are in reserved_slugs');
select is((select count(*)::int from public.organizations where slug in ('en', 'id')), 0, 'no existing organization uses en or id');

select is(public.is_slug_available('en'), false, 'is_slug_available(en) is false');
select is(public.is_slug_available('id'), false, 'is_slug_available(id) is false');
select is(public.is_slug_available('EN'), false, 'is_slug_available is case-insensitive');

-- the integrity trigger refuses the slug even for a direct insert (superuser, no RPC in between)
select throws_ok($$insert into public.organizations (slug, name) values ('en', 'English')$$, '23514', 'SLUG_RESERVED', 'inserting an organization with slug en is refused');
select throws_ok($$insert into public.organizations (slug, name) values ('id', 'Indonesian')$$, '23514', 'SLUG_RESERVED', 'inserting an organization with slug id is refused');

-- renaming an existing organization to a reserved slug is refused too
insert into public.organizations (slug, name) values ('locale-test-org', 'Locale Test');
select throws_ok($$update public.organizations set slug = 'en' where slug = 'locale-test-org'$$, '23514', 'SLUG_RESERVED', 'renaming an organization to en is refused');

-- the RPC refuses it as well (the format rule rejects 2-character slugs first; either error is a refusal)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loc@lt.test', now(), now(), now());
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_matching($$select public.create_organization('English', 'en', '{"name":"L1"}'::jsonb)$$, '^(INVALID_SLUG|SLUG_RESERVED)$', 'create_organization(slug en) is refused');
reset role;

select * from finish();
rollback;
