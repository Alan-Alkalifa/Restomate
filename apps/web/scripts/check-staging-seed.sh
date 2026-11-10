#!/usr/bin/env bash
# Proves supabase/seed-staging.sql is staging-safe (B1-T19). Needs the local Supabase stack running.
# DESTRUCTIVE to the LOCAL database only: it runs `supabase db reset --no-seed`. Never point it anywhere else.
#   supabase start && bash apps/web/scripts/check-staging-seed.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
SEED=supabase/seed-staging.sql

fail() { echo "FAIL: $*" >&2; exit 1; }
db() { docker exec -i "$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }
count() { db -c "select count(*) from $1"; }

# 1. static: no executable line may touch auth.* or mention a password / platform_admins / members
code=$(grep -vE '^\s*--' "$SEED")
if echo "$code" | grep -qiE 'auth\.|password|platform_admins|organization_members|location_staff|encrypted_pw'; then
  echo "$code" | grep -niE 'auth\.|password|platform_admins|organization_members|location_staff|encrypted_pw' >&2
  fail "seed-staging.sql references auth users, passwords, admins or members"
fi

# 2. migrations only (no local seed), then the staging seed twice
supabase db reset --no-seed >/dev/null 2>&1 || fail "supabase db reset --no-seed failed"
[ "$(count auth.users)" = 0 ] || fail "auth.users not empty before the seed"
run_seed() { db -f - < "$SEED" >/dev/null || fail "seed-staging.sql failed"; }
snapshot() {
  for t in public.packages public.organizations public.subscriptions public.roles public.locations public.org_branding \
           public.areas public.tables public.menu_categories public.menu_items public.item_variants public.modifier_groups \
           public.modifiers public.kitchen_stations public.location_menu_overrides; do
    echo "$t=$(count "$t")"
  done
}
run_seed; first=$(snapshot)
run_seed; second=$(snapshot)
[ "$first" = "$second" ] || { diff <(echo "$first") <(echo "$second") >&2 || true; fail "not idempotent: row counts changed on re-run"; }

# 3. no users, identities, admins, members, other tenants
for t in auth.users auth.identities public.platform_admins public.organization_members public.location_staff; do
  [ "$(count "$t")" = 0 ] || fail "$t is not empty"
done
[ "$(count public.organizations)" = 1 ] || fail "expected exactly one organization"
[ "$(db -c "select slug from public.organizations")" = demo ] || fail "the organization is not 'demo'"

# 4. the data is really there, and QR tokens are random (no readable demo-qr-* tokens)
[ "$(count public.tables)" -ge 18 ] || fail "tables missing"
[ "$(count public.menu_items)" -ge 20 ] || fail "menu missing"
[ "$(db -c "select count(*) from public.tables where qr_token like 'demo-qr%' or qr_token like 'other-qr%'")" = 0 ] || fail "readable QR tokens found"
[ "$(db -c "select count(distinct qr_token) from public.tables")" = "$(count public.tables)" ] || fail "QR tokens are not unique"

echo "OK: seed-staging.sql is idempotent and creates no auth users, passwords, admins or members"
echo "$first"
