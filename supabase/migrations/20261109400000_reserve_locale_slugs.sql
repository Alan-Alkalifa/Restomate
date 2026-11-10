-- B1-T24: reserve the locale path segments. The app serves English under /en (and Bahasa at the root, tagged "id"),
-- so a static /en segment would shadow an organization whose slug is "en" (the dashboard lives at /{slug}).
-- Both supported locales are reserved: "id" is not routable today, but reserving it now means a future /id prefix
-- needs no data fix. (Slugs are at least 3 characters, so these cannot be created through the wizard or the RPCs
-- today; the reserved list also guards direct inserts and any future relaxation of the length rule, like 's' and 't'.)

-- Fail loudly instead of leaving an already-shadowed organization behind. Expected to find nothing.
do $$
begin
  if exists (select 1 from public.organizations where slug in ('en', 'id')) then
    raise exception 'an organization already uses a reserved locale slug (en or id); rename it before applying this migration';
  end if;
end
$$;

insert into public.reserved_slugs (slug, reason) values
  ('en', 'locale path segment'),
  ('id', 'locale path segment')
on conflict (slug) do nothing;
