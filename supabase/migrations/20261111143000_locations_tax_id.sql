-- B1-T31: optional per-location NPWP (tax id), printed on bills when set (user decision 2026-11-12; contract
-- docs/contracts/bills.md, BillPrintData.location.taxId).
-- Stored as digits only (15 digits for the old NPWP, 16 for the new NIK-based one) or null. Dots, dashes and spaces
-- are an input convenience stripped in the app (lib/settings); the database accepts digits only.
alter table public.locations add column tax_id text;
alter table public.locations add constraint locations_tax_id_format check (tax_id is null or tax_id ~ '^[0-9]{15,16}$');

-- Same access as the other location settings: SELECT is already table-level (has_location_access); writes go through
-- the existing locations_insert / locations_update policies, which require locations.manage.
grant insert (tax_id), update (tax_id) on public.locations to authenticated;
