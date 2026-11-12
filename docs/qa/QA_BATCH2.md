# QA batch 2 (MVM-T16): report summary

Tester: REYKI. Period: 2026-11-11 to 2026-11-12. Full reports are PR comments (template: `PR_REPORT_TEMPLATE.md`).
Environment: local Supabase (hosted project never used), `next dev`, Chromium. Every change to platform settings was made through the real admin forms.

## Verdicts

| PR | Task | Verdict | Notes |
|---|---|---|---|
| #127 | B1-T29 lib/money own keys | PASS | `__proto__`, `constructor`, `toString` rejected by currencyExponent / formatMoney / parseMoneyInput |
| #128 | MSS-T11 follow-up, setup tag | PASS | |
| #126 | B1-T26 i18n email links | PASS | English reset link lands on `/en/reset-password` |
| #77 | MVM-T09 org menu editor | PASS | whole-Rupiah input; RLS below the UI; BUG-77-1 (S4, duplicate parser) fixed in #79 |
| #131 | B1-T18 signup guard hook | PASS | direct Auth 403, token-bound invitee path, RPC grants |
| #80 | MVM-T11 Demo seed | PASS | positions on 0-999 canvas, Bandung floor, sold-out state |
| #79 | MVM-T10 per-location menu | PASS (re-checked after rebase) | menu pages refused without `menu.manage` |
| #82 | MVM-T13 menu images | PASS | Storage bucket policies attacked through the real Storage API |
| #84 | MVM-T14 Realtime | PASS | other tenant, anon and wrong-location subscribers receive nothing; no `qr_token` in payloads |
| #86 | B1-T12 atomic saves | PASS | RPCs refuse other roles/tenants; all-or-nothing; diff after rebase is merge resolution only |
| #92 | MSS-T02 Packages page | PASS | integer Rupiah, platform-admin only |
| #95 | MSS-T06 tenant detail | PASS | owner reset goes to the right owner and is audited |
| #105 | MSS-T10 setup checklist | PASS | role-restricted links; needs #77 for the Menu link |
| #100 | MSS-T09 Settings + banner | FAIL then PASS | BUG-100-1 (S3) and BUG-100-2 (S4) fixed |
| #109 | MSC-T01 POS shell | FAIL then PASS | BUG-109-1 (S2, no `(pos)` root layout, 500) fixed; tablet widths 768/820/1024 and touch targets verified |
| #130 | MSS-T13 marketing in Bahasa (post-merge) | PASS with bugs | BUG-130-1 (S3) open |

## Bugs

| ID | Severity | Title | Status |
|---|---|---|---|
| BUG-77-1 | S4 | stand-in money parser duplicated `lib/money` | fixed (#79) |
| BUG-100-1 | S3 | plan-card sign-up CTAs shown on `/pricing` when sign-ups are off | fixed (#100) |
| BUG-100-2 | S4 | sign-up links in the pre-hydration HTML when off | fixed (#100) |
| BUG-109-1 | S2 | POS route 500: `(pos)` group had no root layout | fixed (#109) |
| BUG-130-1 | S3 | canonical/hreflang relative on the Indonesian marketing pages (`metadataBase` missing) | **open**, ADIT |
| BUG-130-2 | S4 | plan descriptions English on the Indonesian `/pricing` (DB data) | open |
| BUG-130-3 | S4 | "1 locations" plural on `/en/pricing` | open |

## New Playwright specs (apps/web/e2e)

`menu.spec.ts`, `signup-off.spec.ts`, `admin-packages.spec.ts`, `admin-tenant-detail.spec.ts`, `admin-settings.spec.ts`, `setup-checklist.spec.ts`, `pos-shell.spec.ts`.
They need the local stack (`supabase start`, `supabase db reset`) and the LOCAL service-role key in the environment (see `e2e/support/db.ts`); never the hosted project.

## Environment notes

- `next dev` on a slow filesystem compiles each route on first hit (up to minutes); the specs use long timeouts. Warm the routes or run against a production build for stable timing.
- The public platform flags are cached and refreshed only by the admin action's tag, so tests change settings through the admin forms, not by writing the table.
