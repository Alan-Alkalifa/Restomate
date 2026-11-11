# PLAN.md — Restomate implementation plan

> **How to use this file.** This is the working build plan. Tick boxes as work lands, and add a line to the *Decisions log* whenever a choice is made.
> - **What** we build and why → `PROJECT.md`
> - **How** we build it (stack, rules, conventions) → `CLAUDE.md`
> - **In what order, and what's done** → this file

Last updated: 2026-11-11

---

## 1. Status snapshot

| Area | State |
|---|---|
| Product spec (`PROJECT.md`) | ✅ Done (DOKU + Resend decided) |
| Engineering rules (`CLAUDE.md`) | ✅ Done. Next.js 16 corrections from §2 applied (pending ADIT's confirmation against the installed docs in MF-T01) |
| Monorepo (pnpm + Turborepo) | ✅ MF-T01, PR #22 |
| Next.js app (`apps/web`) | ✅ MF-T01, PR #22 (Next 16, Cache Components on, TypeScript 5.x, `AGENTS.md` committed) |
| Supabase project config | ✅ MF-T02 |
| Database migrations | ✅ MF-T02 → T03 → T04 (+ fixes T33, T34); `get_org_package` / `my_org_membership` (T07) |
| Seed (Demo Restaurant) | ✅ MF-T05, PR #17 |
| App infrastructure (`lib/`) | ✅ env + clients (T06), auth DAL (T07), Arcjet + PostHog (T08), money (T09), DOKU signature (T10), email (T12), public data (T20) |
| App code (auth, onboarding, staff, shells) | ✅ Auth (T13, T14, T39), onboarding (T15, T16), staff invitations (T17, T19), admin shell (T18), frontend shell (T21), super admin shell (T23, fix #83) |
| CI | ✅ MF-T27, PR #21 |
| M0 task board | ✅ HQ board **MF** (M0 Foundation), 32 tasks; see §4.0 |

---

## 2. Technical findings that change the docs

These came from the installed Next.js 16.4.5 and its bundled docs (`apps/web/node_modules/next/dist/docs/`). Apply them to `CLAUDE.md` before writing app code.

- [x] **`middleware.ts` is now `proxy.ts`** (Next 16 renamed Middleware to Proxy). Update the layout tree and every mention in `CLAUDE.md`. Proxy is for optimistic checks and rewrites only: tenant host routing, session refresh, Arcjet. Never use it for authorization.
- [x] **Cache Components** (`cacheComponents: true`, plus `partialPrefetching: true`). Correction from MF-T01 (PR #22): it is *not* on by default in Next 16; we enable it explicitly in `next.config.ts`. The rules below apply because we turn it on:
  - Reading `cookies()`/`headers()` (that is, the Supabase session) outside a `<Suspense>` boundary is a **build error**.
  - Layouts must not `await` the session or dynamic `params` at the top level. Pass the promise down and await it inside a Suspense-wrapped child.
  - Session lookups use `'use cache: private'`. Session-derived data is cached with plain `'use cache'` keyed by user/org ID plus `cacheTag`, and refreshed with `updateTag` in Server Actions.
  - Never put emails, tokens or other personal data in cache keys or tags.
  - Escape hatch for a route that isn't ready yet: `export const instant = false`. Use it sparingly and track every use in §14 (*`instant = false` opt-outs*).
- [x] Next 16 writes an `AGENTS.md` in `apps/web` telling agents to read the bundled docs. Keep it committed. (Rule added to `CLAUDE.md`; file lands with MF-T01)
- [x] TypeScript stays on **5.x** (what Next 16 ships with), not TypeScript 7. (Rule added to `CLAUDE.md`; enforced in MF-T01)

The first two are now in `CLAUDE.md` → *Next.js 16 rules*. ADIT confirms all four against the installed `node_modules/next/dist/docs` in the MF-T01 PR; any mismatch gets fixed in `CLAUDE.md`.

---

## 3. Milestone overview

| Milestone | Goal | Depends on | Size |
|---|---|---|---|
| **M0 Foundation** ✅ | Sign up, create a restaurant, invite staff with a role. **Signed off 2026-11-09** (`docs/qa/M0-signoff.md`, PR #97) | — | L |
| **M1 Signup & super admin** | Public site, onboarding wizard, tenants list, packages | M0 | M |
| **M2 Venue & menu** | Areas, tables, floor plan, menu, QR codes | M0 | L |
| **M3 Service core (MVP)** | POS, orders, KOT/KDS, bills, cash, printing, payment tracking | M2 | XL |
| **M4 Customer site** | Branded storefront, QR ordering, online pickup | M2, M3 | L |
| **M5 Payments (DOKU)** | DOKU Checkout, pay-at-table, split/partial, reconciliation | M3, M4 | L |
| **M6 Launch** | Reservations, customers, reports, schedules, theming, subscription billing | M3–M5 | XL |
| **M7 After launch** | Custom domains, loyalty, WhatsApp, offline mode, ESC/POS, inventory | M6 | — |

M1 and M2 can run in parallel once M0 is done.

---

## 4. M0 — Foundation (detailed) ✅ signed off 2026-11-09

**Exit criteria:**
- A new user signs up, confirms their email (in Mailpit locally), and creates a restaurant with one location.
- They invite a staff member as Cashier. The invitee accepts and sees only what a cashier may see.
- A user from another restaurant cannot read any of it.

### 4.0 Task map (HQ board `MF`)

One task = one branch = one PR. Flow: developer opens a **draft** PR → REYKI verifies → ALAN reviews → ALAN merges (squash). UI tasks code against the backend task's documented contract in parallel and **merge after** it.

| Task | Owner | What | Needs | Merges after |
|---|---|---|---|---|
| MF-T01 ✅ | ADIT | Monorepo + Next.js 16 scaffold (§4.1) | — | — |
| MF-T02 ✅ | DAVIN | `supabase init` + core migration: tenancy tables, helpers, RLS (§4.2a) | — | — |
| MF-T03 ✅ | DAVIN | `staff_invitations` + RPCs (§4.2b) | T02 | — |
| MF-T04 ✅ | DAVIN | Triggers: plan limits, last owner, system roles (§4.2c) | T03 | — |
| MF-T05 ✅ | DAVIN | Seed: Demo Restaurant, Other Bistro, packages, seed users (§4.4) (PR #17) | T04 | — |
| MF-T35 ✅ | DAVIN | `packages/db` generated types (§4.1), split from T05 (PR #38) | T01, T05 | — |
| MF-T06 ✅ | DAVIN | `env.ts`, `.env.example`, Supabase clients, `proxy.ts` (§4.5) (PR #34) | T01 | — |
| MF-T07 ✅ | DAVIN | Auth DAL: `getCurrentUser`, `getOrgContext`, `requirePermission`, … (§4.5) (PR #39) | T05, T06 | — |
| MF-T08 ✅ | ADIT | `lib/arcjet.ts` + `lib/posthog` (§4.5) (PR #40) | T06 | — |
| MF-T09 ✅ | DAVIN | `lib/money.ts` + tests (§4.5) | T01 | — |
| MF-T10 ✅ | ADIT | DOKU Non-SNAP signature + tests (§4.5) | T01 | — |
| MF-T11 ✅ | ADIT | `emails/StaffInvite.tsx` (§4.5) | T01 | — |
| MF-T12 ✅ | ADIT | `lib/email` (Resend, log mode, `sendStaffInvite`) (§4.5) (PR #41) | T06, T11 | — |
| MF-T13 ✅ | DAVIN | Auth Server Actions + `/auth/confirm` (§4.6) (PR #44) | T07, T08 | — |
| MF-T14 ✅ | ADIT | Auth pages (§4.6) (PR #27; actions wired in T39) | T01 | — |
| MF-T15 ✅ | DAVIN | Onboarding actions: `checkSlug`, `createOrganization` (§4.7) (PR #47) | T03, T07 | T13 |
| MF-T16 ✅ | ADIT | Onboarding wizard UI (§4.7) (PR #30) | T14 | T15 |
| MF-T17 ✅ | DAVIN | Staff actions: invite, resend, revoke, role, deactivate, accept (§4.8) + audit triggers (PR #50) | T04, T07, T12 | T13 |
| MF-T18 ✅ | ADIT | Restaurant admin shell: sidebar from permissions, location switcher (§4.9) (PR #29) | T07, T14 | — |
| MF-T19 ✅ | ADIT | Staff pages + `/invite/[token]` (§4.8) (PR #37) | T18 | T17 |
| MF-T20 ✅ | ADIT | Public data: `getPublicPackages`, `getStorefront`, `theme.ts` (§4.9) | T05, T06 | — |
| MF-T21 ✅ | ADIT | Frontend shell + pricing + storefront placeholder (§4.9) (PR #28) | T01 | — |
| MF-T22 ✅ | ADIT | Super admin data + `setOrgStatus` (§4.9) (PR #43) | T07, T03 | — |
| MF-T23 ✅ | ADIT | Super admin shell + tenants list (§4.9) (PR #36; shell-after-guard fix #83) | T18 | T22 |
| MF-T24 ✅ | REYKI | M0 test plan, isolation matrix, bug + PR report templates (PR #2) | — | — |
| MF-T25 ✅ | REYKI | pgTAP isolation suite, core tables (§4.3) (PRs #4, #7) | — | T02 |
| MF-T34 ✅ | DAVIN | Invitation + branding review fixes: explicit `all_locations`, `org_branding.logo_url` https-only, invite expiry cap (S3 ×3) | T03 | — |
| MF-T33 ✅ | DAVIN | Foundation review fixes: profile scope, no member DELETE, `platform_settings` deny policy, suspended-org membership, no self-escalation, fail-closed `has_permission` (PR #8) | T02 | — |
| MF-T26 ✅ | REYKI | pgTAP abuse tests: invitations, RPCs, triggers (§4.3) (PRs #13, #16, #18) | T25 | T03, T04 |
| MF-T36 ✅ | REYKI | Hardening tests for MF-T34 (PR #19) | T34 | T34 |
| MF-T27 ✅ | REYKI | CI workflow (§4.10, §12) | T01, T02 | — |
| MF-T28 ✅ | REYKI | Playwright setup + auth e2e (PR #64) | T01 | T13, T14 |
| MF-T29 ✅ | REYKI | e2e onboarding (exit criterion 1) (PR #65) | T28 | T15, T16 |
| MF-T30 ✅ | REYKI | e2e staff invite as Cashier + cross-tenant (exit criteria 2–3) (PR #68) | T28 | T17–T19 |
| MF-T31 ✅ | REYKI | e2e super admin, storefront, pricing (PR #85; 140/140 e2e green in CI) | T28 | T20–T23 |
| MF-T32 ✅ | REYKI | M0 exit sign-off report, including the live Arcjet check (PR #97: all three exit criteria PASS, no S1/S2) | all | — |
| MF-T37 ✅ | DAVIN | Env: `EMAIL_DELIVERY` required and `resend` in production (S3 from QA #41) (PR #48) | — | — |
| MF-T38 ✅ | ADIT | `send()` accepts exactly one recipient (S3 from QA #41) (PR #45) | — | — |
| MF-T39 ✅ | ADIT | Wire auth pages to `lib/auth/actions`; one `ActionResult`; reuse `sanitizeNext` (PR #54) | T13 | — |
| MF-T40 ✅ | ADIT | PostHog: allowlist query params, mask tokens in every URL prop, autocapture/recording off (S2 from QA #40) (PR #46) | — | — |

**Backlog board `B1`:** B1-T01 ✅ PostHog error tracking + `global-error.tsx` (ADIT, #52) · B1-T02 ✅ atomic `set_member_locations` RPC (DAVIN, #51) · B1-T03 ✅ regenerated types + `admin_set_org_status` hardening (DAVIN, #53) · B1-T04 ✅ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` with `ANON_KEY` fallback (DAVIN, #55) · B1-T05 ✅ signed-in users redirected away from /login and /signup (ADIT, #56).

**M0 is done.** Open findings from the sign-off: BUG-M0-01 (S3, no `areas`/`tables` isolation test) → MVM-T02; BUG-M0-02 (S4) = B1-T08 (#71); BUG-M0-03 (S4, dev `Date.now()` noise) → B1-T17; BUG-M0-04 (S3, env validation inside `after()` drops invite mail) → B1-T16. Not covered and carried forward: a manual tablet walkthrough (do it on the M2 floor plan) and Supabase advisors (run them before the first deployed environment).

**Progress (2026-11-09):**
- ✅ Merged 2026-11-08: #34 (T06), #38 (T35), #28 (T21), #41 (T12), #27 (T14), #40 (T08), #39 (T07), #46 (T40), #43 (T22), #29 (T18).
- ✅ Merged 2026-11-09: #44 auth actions (T13), #47 onboarding actions (T15), #50 staff actions + audit triggers (T17), #51 `set_member_locations` (B1-T02), #54 auth pages wired (T39), #45 single recipient (T38), #48 email env (T37), #37 staff pages (T19), #55 publishable key (B1-T04). pgTAP: 1,250 tests.
- ✅ **Exit criterion 2 verified live by REYKI on #37:** owner invites a Cashier → signup/confirm → accept → lands in `/demo` with the Cashier nav only; audit rows written; resent/used/revoked/expired links show the same generic page; a manager's tampered Owner invite is refused server-side.
- ⏳ In QA (approved by ALAN): #53 (B1-T03), #56 (B1-T05), #52 (B1-T01), #30 (T16), #36 (T23). Then REYKI's live Arcjet check and MF-T28.
- Known/accepted: the "no access" view returns HTTP 200 (soft 403 inside Suspense; see Decisions).

**Draft rule (from 2026-11-08):** every code PR is opened as a GitHub **draft**. PRs #3, #4, #10 and #11 were auto-merged 11–33 seconds after opening, before QA and review. ALAN marks a PR ready (`gh pr ready`) only after REYKI's QA report and ALAN's review. #11 put ADIT's untested WIP scaffold on `main`; MF-T01 stays open until a verified scaffold PR lands.

**Merge rule:** ALAN merges (squash), one PR at a time, only after REYKI's QA PASS and ALAN's review; Markdown-only PRs skip QA. Before squashing a PR that others are stacked on, ALAN retargets them to `main` first (`--delete-branch` closes stacked PRs otherwise), then the owner rebases with `--onto`.

### 4.1 Repo and tooling
- [x] pnpm workspace + Turborepo, root scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `db:*`) — MF-T01 (PR #22)
- [x] Next.js app in `apps/web`; dependencies installed: `@supabase/ssr`, `@supabase/supabase-js`, `@arcjet/next`, `posthog-js`, `posthog-node`, `resend`, `@react-email/components`, `zod`, `server-only`, `vitest` — MF-T01 (PR #22)
- [x] `supabase init`, auth config, Resend SMTP block, email templates (MF-T02, PR #3)
- [x] Add `typecheck` and `test` scripts to `apps/web/package.json`
- [x] `packages/db` workspace package that exports the generated `Database` types (MF-T35, PR #38)
- [x] `.env.example` (matches `CLAUDE.md` → *Environment variables*); `lib/env.ts` validates it with Zod (MF-T06)
- [x] Prettier + ESLint config; Conventional Commits
- [x] `git init` and first commit (repo `Alan-Alkalifa/Alan-HQ`)

### 4.2 Database foundation (`supabase/migrations/…_foundation.sql`)
Conventions: text columns with `check` constraints instead of enums (easier to evolve), `created_at`/`updated_at` with a shared trigger, RLS on every table, and `(select auth.uid())` in policies for performance. Internal helper functions go in a non-exposed `private` schema.

**Tables**
- [x] `profiles`: id = `auth.users.id`, full name, email copy, phone. Auto-created by a trigger on `auth.users`
- [x] `platform_admins`: user_id. Only the service role writes it
- [x] `packages`: code, name, monthly/yearly price (IDR), trial days, `limits` jsonb (`max_locations`, `max_staff`, `max_tables`), `features` text[], `is_active`, `is_public`, `is_default`
- [x] `organizations`: slug (3–40 characters, `[a-z0-9-]`), name, status (`active | suspended | past_due | read_only`), default currency `IDR`, timezone `Asia/Jakarta`, contact email
- [x] `reserved_slugs`: `www, app, admin, api, demo, mail, …`
- [x] `subscriptions`: org ↔ package, status (`trialing | active | past_due | canceled`), period, `trial_ends_at`, `current_period_end`
- [x] `locations`: org, name, address, city, phone, timezone, currency, `tax_rate_bps` (1000 = 10%), `service_charge_bps`, `tax_on_service_charge`, `is_active`
- [x] `permissions`: catalog of permission keys
- [x] `default_role_permissions`: template for the system roles
- [x] `roles` (per org, `is_system`), `role_permissions`
- [x] `organization_members`: org, user, role, status (`active | deactivated`), `all_locations`
- [x] `location_staff`: member ↔ location
- [x] `staff_invitations`: org, email, role, location IDs, `token_hash` (SHA-256), `expires_at`, `accepted_at`, `revoked_at`
- [x] `org_branding`: logo, colors, font, theme jsonb
- [x] `audit_logs`: org (nullable for platform actions), actor, action, entity, metadata
- [x] `platform_settings`: key/value jsonb

**Permission catalog (v1)**
`menu.manage · orders.view · orders.create · orders.void · pos.use · pos.discount · kitchen.view · kitchen.update · tables.view · tables.manage · reservations.view · reservations.manage · payments.view · payments.take · payments.refund · customers.view · customers.manage · reports.view · staff.manage · locations.manage · settings.manage · settings.branding · billing.manage`

| Role | Permissions |
|---|---|
| Owner | Everything (implicit, so new permissions never need backfilling) |
| Manager | Everything except `billing.manage`, `settings.manage`, `locations.manage` |
| Cashier | `pos.use, orders.view, orders.create, payments.view, payments.take, customers.view, kitchen.view, tables.view` |
| Waiter | `pos.use, orders.view, orders.create, kitchen.view, tables.view, reservations.view` |
| Kitchen | `kitchen.view, kitchen.update, orders.view` |

**Helper functions** (security definer, `search_path = ''`, stable)
- [x] `is_platform_admin()`
- [x] `is_org_member(org)`
- [x] `has_permission(org, perm)`
- [x] `has_location_access(location)`
- [x] `my_permissions(org) → text[]` (for the UI)
- [x] `private.org_limit(org, key)`, `private.write_audit(...)`

**RPCs**
- [x] `is_slug_available(slug)`: anon + authenticated
- [x] `create_organization(name, slug, location…, package_code?)`: **one transaction** creates the org, system roles and permissions, owner membership, first location, branding row, trialing subscription on the default package, and an audit entry. Caps owned organizations per user (abuse guard)
- [x] `accept_invitation(token)`: hash matches, not expired or revoked, invitee's email matches `auth.jwt() ->> 'email'`
- [x] `get_storefront(slug)`: public info, branding and active locations of an **active** org only. Anon
- [x] `admin_set_org_status(org, status, reason)`: platform admin only, audited

**Triggers**
- [x] Package limits on insert into `locations`, `organization_members` and `staff_invitations` (raise `PLAN_LIMIT:<key>`)
- [x] The last active owner of an organization cannot be removed, deactivated or demoted
- [x] System roles cannot be deleted, and the owner role's permissions cannot be edited
- [x] `updated_at` maintenance; email sync from `auth.users` to `profiles`

### 4.3 Database tests
- [x] Use `supabase test db` (pgTAP) in `supabase/tests/`
- [x] Org A member cannot select/insert/update org B rows (every table)
- [x] Cashier cannot manage staff; Manager cannot manage billing (MF-T25 write matrix + role permission sets)
- [x] Removing the last owner fails; limits trigger at the package cap
- [x] `accept_invitation` rejects a wrong email, an expired token and a reused token
- [x] (Used by QA: `supabase/postgres` container + psql, see docs/qa) Fallback when Docker isn't available: run migrations against plain Postgres 16 with a small `auth` schema shim (`auth.users`, `auth.uid()`, `auth.jwt()`, `anon`/`authenticated`/`service_role` roles)

### 4.4 Seed (`supabase/seed.sql`, local only)
- [x] Packages Starter / Growth / Pro with placeholder IDR prices, published. Growth is the trial default
- [x] Platform admin `admin@restomate.local`
- [x] **Demo Restaurant** (`demo` is reserved for the public marketing link and maps to this org):
  - owner `owner@demo.local`, plus one manager, one cashier, one waiter and one kitchen user
  - two locations (Jakarta Selatan, Bandung)
  - branding
- [x] All seed passwords are local-only and documented in the README

### 4.5 App infrastructure (`apps/web/lib`)
- [x] `env.ts` (Zod-validated; fails fast on boot)
- [x] `supabase/server.ts`, `supabase/client.ts`, `supabase/proxy.ts` (session refresh), `supabase/admin.ts` (`server-only`)
- [x] `auth/dal.ts`: `getCurrentUser()` (`'use cache: private'`), `requireUser()`, `getMembership(orgSlug)`, `requirePermission(orgId, perm)`, `requirePlatformAdmin()`
- [x] `proxy.ts`:
  - resolve host → surface (`restomate.app` → frontend, `app.` → admin, `{slug}.` → storefront rewrite)
  - refresh the Supabase session
  - skip `/api/webhooks/doku`
- [x] `arcjet.ts`: shared rules (shield + bot detection + rate limit; signup preset with email validation)
- [x] `posthog/`: client provider, server capture, `events.ts` constants; group by organization
- [x] `email/`: Resend client, `send()` wrapper with idempotency key and `EMAIL_DELIVERY=log` mode; `emails/StaffInvite.tsx`
- [x] `money.ts`: currency exponent (IDR = 0), formatting `Rp 25.000`, tax + service charge calculation, with unit tests
- [x] `payments/doku/signature.ts`: Non-SNAP signing and verification, with unit tests against DOKU's documented example. Built early because it is small and pure; the rest of DOKU is M5

### 4.6 Auth pages (`app/(auth)`)
- [x] Login (email + password), with Arcjet protection
- [x] Signup (name, email, password), with Arcjet signup protection; sends the confirm email via Supabase → Resend SMTP (Mailpit locally)
- [x] `/auth/confirm` route handler (`verifyOtp` with `token_hash`), then redirect to `next`
- [x] Forgot password → email → `/reset-password`
- [x] Sign out (Server Action)

### 4.7 Onboarding (`app/(frontend)/onboarding`)
- [ ] Step 1: restaurant name + slug with a live availability check
- [ ] Step 2: first location (address, city, timezone, tax and service charge defaults)
- [ ] Step 3: logo + colors (skippable)
- [ ] Submit → `create_organization` RPC → redirect to `/{org}`. PostHog events `signup_completed`, `onboarding_completed`, `trial_started`

### 4.8 Staff invitations (`app/(dashboard)/[org]/staff`)
- [x] Staff list (members + pending invites), gated by `staff.manage`
- [x] Invite form: email, role, locations → insert invitation (raw token generated server-side, only the SHA-256 hash stored) → Resend email with accept link
- [x] `/invite/[token]`: sign in or sign up with the invited email → `accept_invitation` → redirect to the org
- [x] Resend and revoke invitations; change role; deactivate a member

### 4.9 Surface shells
- [x] `(frontend)`: home placeholder, pricing page reading public `packages`, demo link (MF-T21, PR #28)
- [x] `(dashboard)/[org]`: sidebar built from `my_permissions`, location switcher, setup checklist on the home page, locked-feature state from package features
- [ ] `(superadmin)/admin`: guarded by `platform_admins`; tenants list (search, status, plan) and suspend/reactivate
- [x] `(storefront)/s/[tenant]`: branded placeholder page from `get_storefront`; "temporarily unavailable" for suspended orgs

### 4.10 Verify
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass
- [ ] `supabase db reset` + `supabase test db` pass
- [ ] Manual walkthrough of the exit criteria in a browser

---

## 5. M1 — Signup & super admin

- [ ] Marketing pages: Home, Features, Pricing (from `packages`), Demo, Terms, Privacy. English + Bahasa Indonesia
- [ ] Onboarding polish: sample menu/tables option, setup checklist that tracks real progress
- [ ] Super admin **Tenants**: detail page with usage vs. limits, subscription history, owner contact, password-reset trigger, audit trail
- [ ] Super admin **Packages**: create/edit/archive plans, limits, feature flags; pricing page updates immediately (`updateTag`)
- [ ] Super admin **Platform settings**: signup on/off, maintenance banner, tax presets — lib + RPCs + server-side enforcement ✅ #102 (MSS-T08); settings page + public banner: #100 (MSS-T09); Auth-hook signup refusal: B1-T18
- [ ] Feature gating: `hasFeature(org, key)` on the server + locked UI with upgrade prompt
- [ ] PostHog signup funnel dashboard

**Exit:** new restaurant onboards end to end; platform admin sees it, its plan and its usage.

---

## 6. M2 — Venue & menu

- [ ] Tables: `areas`, `tables` (capacity, status, position, `qr_token`)
- [ ] Area management (create, rename, reorder, disable)
- [ ] Floor plan editor (drag-and-drop table placement per area)
- [ ] QR codes: generate per table, rotate token, printable sheet (A4 + table tents)
- [ ] Menu schema: `menu_categories`, `menu_items`, `item_variants`, `modifier_groups`, `modifiers`, `location_menu_overrides`, `kitchen_stations`
- [ ] Menu editor: categories, items, variants, modifiers (min/max), dietary tags, images (Supabase Storage), drag-and-drop ordering
- [ ] Per-location price/availability overrides; "sold out today" toggle
- [ ] Realtime menu changes broadcast per location
- [ ] Package limits: `max_tables`

**Exit:** Demo Restaurant has a full menu and floor plan with printable QR codes.

---

## 7. M3 — Service core (MVP)

- [ ] Schema: `orders`, `order_items` (snapshots), `order_item_modifiers`, `order_events`, `kitchen_tickets`, `kitchen_ticket_items`, `bills`, `bill_items`, `payments`, `refunds`, `discounts`, `cash_sessions`
- [ ] `lib/orders/transitions.ts` state machines + tests
- [ ] **POS**: touch grid, cart, modifiers, notes, dine-in/takeaway, send to kitchen, add-on rounds, discounts (`pos.discount`), voids with reason (`orders.void`), keyboard shortcuts, offline/reconnecting banner, cart persisted locally
- [ ] **Live order board**: filters by channel/status, realtime, reconnect + refetch
- [ ] **KDS**: tickets by station, item/ticket status, amber/red timers, bump, realtime
- [ ] **Table status**: live colors, move/merge tables, waiter assignment, time seated
- [ ] **Bills**: PB1/PBJT + service charge via `money.ts`, split by item or equal shares, partial payments, derived payment status
- [ ] **Payments (non-gateway)**: cash with change, EDC card (recorded), other
- [ ] **Printing**: 80 mm / 58 mm / A4 print routes for bills and KOTs; "Duplicate" on reprint
- [ ] **Payment tracking**: live payments list, end-of-day cash-up with variance
- [ ] Playwright e2e: dine-in → KOT → serve → bill → split cash payment → print

**Exit:** a full dine-in service runs on Restomate with cash at Demo Restaurant.

---

## 8. M4 — Customer site

- [ ] Host routing live: `{slug}.restomate.app` (wildcard domain on Vercel)
- [ ] Separate surfaces by host: dashboard/admin paths only on `app.`, marketing/signup only on the root domain (redirect the rest); found in the MF-T06 review
- [ ] Seed: give Demo Restaurant an https `logo_url` so the storefront shows a logo (found in MF-T20 QA)
- [ ] Storefront pages: menu, item detail, cart, checkout, order status, about/contact; location picker; opening hours
- [ ] Theming from `org_branding` as CSS variables; 3 layout presets
- [ ] QR entry `/t/{qr_token}` → table-linked cart; "call waiter" / "request bill"
- [ ] Server-side order intake: recompute prices, check availability and hours, Arcjet protection
- [ ] Optional staff approval for QR orders
- [ ] Online pickup orders (pay-at-counter until M5)
- [ ] Guest order-status page with realtime updates
- [ ] Lighthouse mobile ≥ 90

**Exit:** guests order from a table and online at Demo Restaurant.

---

## 9. M5 — Payments (DOKU)

- [ ] `payment_gateway_accounts` (encrypted Client ID/Secret Key per org, sandbox/production flag) + Settings UI with "test connection"
- [ ] `PaymentProvider` interface + DOKU implementation: `createCheckout`, `getStatus`, `verifyNotification`, `parseNotification`
- [ ] Invoice number scheme (`RM-…` / `RMSUB-…`) stored before redirecting
- [ ] `/api/webhooks/doku`: raw body, signature check, per-account secret lookup by `Client-Id`, dedup in `payment_notifications`, amount/currency check, single transaction update, fast 200
- [ ] Storefront checkout + pay-at-table via DOKU Checkout; return page shows "confirming payment…" until the notification arrives
- [ ] POS: show DOKU QRIS / send payment link for a bill
- [ ] Reconciliation job: Check Status for `pending` payments older than 15 minutes (scheduled Edge Function or Vercel Cron)
- [ ] Expiry handling + retry
- [ ] Refunds recorded; manual refund path where DOKU has no API refund
- [ ] Tests: signature vectors, duplicate notification, amount mismatch, FAILED ignored

**Exit:** online payments reconcile correctly in DOKU sandbox, then a real low-value production transaction.

---

## 10. M6 — Launch

- [ ] **Reservations**: settings (slots, length, party size, lead time, blackout dates), availability search, storefront booking, Resend confirmation with cancel link, manager timeline, seat → open order, no-shows, overlap prevention (exclusion constraint)
- [ ] **Customers**: auto-created profiles, history and spend, preferences/allergies, feedback with low-rating alerts (email), data deletion
- [ ] **Reports**: SQL report functions (`security invoker`), sales/staff/tables/customers/payments, date range + compare, CSV export
- [ ] **Staff schedules**: weekly shifts per location; optional POS PIN login
- [ ] **Theme customization**: logo/cover upload, colors with contrast warning, fonts, presets, live preview
- [ ] **Subscription billing**: monthly invoices in `platform_invoices`, paid through Restomate's DOKU account; Resend invoice and reminder emails; grace period → `past_due` → read-only; super admin billing pages
- [ ] Production readiness: Resend domain verified (SPF/DKIM/DMARC on `mail.restomate.app`), Supabase Auth SMTP set to Resend, DOKU production credentials, Arcjet live mode, error monitoring, backups (PITR), status page
- [ ] Bahasa Indonesia translations complete

**Exit:** public launch with paid plans.

---

## 11. M7 — After launch (backlog)

Custom domains · loyalty points · WhatsApp notifications · full offline POS · direct ESC/POS printing via local bridge · inventory and recipe costing · delivery app integrations · accounting sync.

---

## 12. Environments and delivery

| Environment | App | Database | Payments | Email |
|---|---|---|---|---|
| Local | `pnpm dev` | `supabase start` (Docker) | DOKU sandbox | Mailpit / `EMAIL_DELIVERY=log` |
| Preview | Vercel preview per PR | Supabase branch | DOKU sandbox | Resend (test domain) |
| Staging | `staging.restomate.app` | Supabase staging project | DOKU sandbox | Resend |
| Production | `restomate.app`, `app.restomate.app`, `*.restomate.app` | Supabase production project | DOKU production | Resend (`mail.restomate.app`) |

**CI (GitHub Actions)** on every PR: install → lint → typecheck → unit tests → `supabase db reset` + `supabase test db` → build. Playwright runs on preview deployments from M3 onward.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak | RLS on every table, helper functions, pgTAP isolation tests per table, code review checklist |
| Cache Components learning curve (Next 16) | Follow §2 patterns, keep session reads in the DAL, track `instant = false` opt-outs |
| Missed or duplicate DOKU notifications | Idempotent dedup table + Check Status reconciliation job |
| Restaurants without a DOKU account | Cash/EDC flows work without a gateway; onboarding guide for DOKU merchant signup (open question in `PROJECT.md`) |
| Unstable restaurant Wi-Fi | Realtime reconnect + refetch, locally persisted POS carts, offline mode in M7 |
| Email deliverability | Dedicated sending subdomain, SPF/DKIM/DMARC, Resend for both SMTP and API |
| Regional tax differences | Rates configurable per location, never hard-coded |

---

## 14. Decisions log

| Date | Decision |
|---|---|
| 2026-11-08 | Stack: Next.js (`apps/web`), Supabase Auth + DB, PostHog, Arcjet |
| 2026-11-08 | Four surfaces in one Next.js app: restaurant admin, super admin, customer site, frontend (signup) |
| 2026-11-08 | Payment gateway: DOKU (Checkout, Non-SNAP) for guest payments and Restomate's own subscription billing |
| 2026-11-08 | Email: Resend — Supabase Auth via SMTP, app email via API + React Email |
| 2026-11-08 | Launch market Indonesia: IDR (no minor unit), Asia/Jakarta, PB1/PBJT + service charge configurable per location |
| 2026-11-08 | Next.js 16.4 with Cache Components on; `proxy.ts` instead of `middleware.ts`; TypeScript 5.x |
| 2026-11-08 | Owner role has implicit all permissions; other roles are explicit permission lists |
| 2026-11-08 | Status snapshot corrected: the monorepo, `apps/web` and `supabase/` were marked done but weren't on `main`. Re-scheduled as MF-T01 / MF-T02 |
| 2026-11-08 | M0 broken into 32 tasks on HQ board `MF` (§4.0). Backend delivers typed contracts; UI codes against them in parallel and merges after |
| 2026-11-08 | Invitation preview before sign-in goes through a security-definer RPC (`get_invitation_preview`), not the service-role client, so the service role stays limited to webhooks, jobs and storefront intake |
| 2026-11-08 | Owned-organization cap per user (abuse guard): default 3, overridable in `platform_settings` |
| 2026-11-08 | DB error contract: triggers raise `PLAN_LIMIT:<key>`, `LAST_OWNER`, `SYSTEM_ROLE`; the app maps them to friendly messages |
| 2026-11-08 | M0 onboarding branding takes a colour + optional logo URL; logo upload to Supabase Storage lands with M6 theme customization |
| 2026-11-08 | Access rules (from QA's MF-T24 questions): `subscriptions` and `audit_logs` readable by the org owner + platform admins only; `audit_logs` written only by `private.write_audit`; `platform_settings` has no client access in M0; custom roles are owner-only |
| 2026-11-08 | Suspended org: members see only a notice page; `has_permission()` false and tenant reads blocked except their own `organizations` row; storefront "temporarily unavailable". `read_only` / `past_due` behaviour comes with M6 billing |
| 2026-11-08 | Staff: managers manage every role except owner; `max_staff` counts active members + pending invitations (not deactivated members); a duplicate pending invite is rejected ("use Resend") |
| 2026-11-08 | HQ `list_tasks` shows teammates titles only, so every PR description must include its task's acceptance checklist |
| 2026-11-08 | Review of PR #3: co-member profile reads (email, phone) limited to `staff.manage` holders; no client DELETE on `organization_members` (removal = deactivate); tables with no client access get an explicit restrictive `using (false)` policy so the RLS guard test stays strict |
| 2026-11-08 | `has_permission` fails closed for keys not in `permissions` (owners included). Non-owners can't change their own membership or `location_staff` rows. Members of a suspended org read only the `organizations` row (S2/S3 findings from the MF-T25 suite, fixed in MF-T33) |
| 2026-11-08 | Invitations carry an explicit `all_locations` flag (an empty location list never means "all"). The onboarding logo goes in `org_branding.logo_url` (https only); `logo_path` is reserved for Storage objects (M6). Client-set invite expiry is capped at 30 days (MF-T34) |
| 2026-11-08 | `org_branding.logo_path` is server-only (no client writes, not returned by `get_storefront`); clients and the storefront use only the https-only `logo_url` (S2 found by QA on PR #15) |
| 2026-11-08 | A sole owner's account deletion is blocked by `LAST_OWNER` (safe default). M6's account-deletion flow must require an ownership transfer or organization deletion first |
| 2026-11-08 | Integrity triggers run before RLS, so some forbidden writes return `SYSTEM_ROLE` / `PLAN_LIMIT:*` / `LAST_OWNER` (P0001) rather than 42501. App error mapping must handle both |
| 2026-11-08 | Merges are squash merges by ALAN (`gh pr merge --squash --delete-branch`). Stacked PRs must be rebased onto `main` after their base PR is squashed |
| 2026-11-08 | Load rebalancing (user-approved): MF-T10 (DOKU signature) and MF-T20 (public data, theme.ts, `lib/supabase/anon.ts`) moved from DAVIN to ADIT as a one-time ownership exception. Security-critical backend stays with DAVIN |
| 2026-11-08 | Backend/UI contracts are pinned in the backend task before UI work starts (MF-T07, T09, T13, T15, T20, T22). UI codes against typed seams that are replaced by real imports before merge |
| 2026-11-08 | 403/404 inside Suspense stream with HTTP 200 in Next 16. Requirement: the 403/404 view renders server-side and the payload contains no tenant data; authorization is enforced by `requirePermission` + RLS, not the status code |
| 2026-11-08 | Money is never negative in `lib/money.ts`; refunds/credits/discounts are separate positive rows (M3) |
| 2026-11-08 | Dashboard URLs: `/[org]/[location]/…` with the location id for location-scoped pages; org-level pages at `/[org]/…` |
| 2026-11-08 | Onboarding contract: `createOrganization(input: OnboardingInput)` (typed object, server-side redirect), `checkSlug → { status }` |
| 2026-11-08 | Unknown hosts return 404 in production until custom domains exist (M7) |
| 2026-11-08 | Seed inserts the reserved `demo` slug by disabling `organizations_slug_not_reserved` inside `seed.sql` (table owner only); no runtime bypass in the schema |
| 2026-11-08 | Seed adds a second tenant, **Other Bistro** (`other-bistro`), as the cross-tenant target for isolation e2e tests. Seed package prices are placeholders until pricing is decided (`PROJECT.md` → Still open #1) |
| 2026-11-08 | Further load moves from DAVIN to ADIT: MF-T08 (Arcjet/PostHog), MF-T12 (`lib/email`) and MF-T22 (super admin data; ADIT had built MF-T23 against its contract). Follow-up fixes go to whoever owns the module now (T38, T40 → ADIT). Same exception as the T10/T20 move; security-critical auth, onboarding and staff actions stay with DAVIN. **User confirmation of the T22 move is still pending** (ALAN moved it without asking first) |
| 2026-11-08 | Staff audit rows are written by AFTER triggers on `staff_invitations` / `organization_members` calling `private.write_audit` (MF-T17), not by a client-callable audit RPC (forgeable, not atomic) and not by the service role |
| 2026-11-08 | PostHog: explicit events only. Autocapture, session recording and heatmaps off; query params allowlisted (`utm_*`, `ref`); `/invite/{token}` and `/t/{token}` masked in every URL property (MF-T40). The PostHog wizard PR #42 was closed (it identified users by email) |
| 2026-11-08 | Email in production must use `EMAIL_DELIVERY=resend`; `log` mode is dev/test only (MF-T37) |
| 2026-11-08 | `updatePassword` requires a recovery/OTP sign-in within the last 10 minutes; passwords are limited to 72 UTF-8 bytes (bcrypt) (MF-T13) |
| 2026-11-08 | Open-redirect defence lives in the server-side `sanitizeNext` (`lib/auth/redirect.ts`); client-side checks are cosmetic and reuse the same function (MF-T39) |
| 2026-11-09 | Pages import Server Actions directly from `lib/*/actions`. A `'use server'` file can't re-export, so UI seams are deleted, not turned into re-exports (found by QA on #44) |
| 2026-11-09 | Supabase client key: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase's current name) is preferred; `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still accepted as a fallback (B1-T04) |
| 2026-11-09 | Member location scope changes go through one atomic `set_member_locations` RPC (B1-T02), not several separate writes |
| 2026-11-09 | Super admin suspend/reactivate reasons need at least 5 visible characters after stripping Unicode whitespace and zero-width characters, checked in both SQL and Zod; setting the same status again is a no-op with no audit row (B1-T03) |
| 2026-11-09 | Signed-in users opening /login or /signup are redirected (DAL, not proxy) to the sanitised `next` or `/`; `next` may never point back to an auth page (B1-T05) |
| 2026-11-09 | HQ marks a task done when *any* PR linked to it merges, including a contract-only Markdown PR (MSS-T01 closed on #89). ALAN reopens the task after a contract PR merges |
| 2026-11-09 | M0 signed off by REYKI (#97). An HQ task only starts when it's *assigned* (`assign_task`); a message alone doesn't wake an agent with no current task (REYKI sat idle on MF-T32) |
| 2026-11-09 | Tenant usage `limit` is 0 when an org has no live subscription (matches the plan-limit triggers); the UI shows "No plan" (MSS-T05) |
| 2026-11-09 | Packages are written only through the audited `admin_*_package` RPCs; `authenticated` has SELECT only on `packages` (MSS-T01 review) |
| 2026-11-09 | **User decision: real services go on a STAGING environment first.** Vercel Hobby (`restomate-staging`, `*.vercel.app`, no domain yet, so customer sites use `/s/{slug}`), Supabase `restomate-staging` in ap-southeast-1 created through the Vercel Marketplace, Resend test sender, Arcjet, PostHog, DOKU **sandbox**. Production (domain, Vercel Pro, DOKU production) comes later and needs the user's approval. Staging has no seed users with known passwords (B1-T19) |
| 2026-11-10 | Staging DB is live: #114 (B1-T19) merged, and the first **Deploy DB (staging)** run applied all 12 migrations to Supabase `restomate-staging` (run 42744236883). The deploy is gated on green CI for the exact `main` SHA (a manual run before CI finished was correctly refused). The Demo seed on staging is manual only (Actions → Deploy DB (staging) → `apply_seed`). S4 from REYKI, deferred: move `SUPABASE_STAGING_DB_URL` into a GitHub Environment |
| 2026-11-10 | Vercel preview deployments serve the app on their own `VERCEL_URL` / `VERCEL_BRANCH_URL` only when `VERCEL_ENV=preview` (exact `*.vercel.app` match, never from a header); production unknown hosts still 404 (#117, B1-T23). Requires Vercel "Automatically expose System Environment Variables" ON and the Supabase redirect pattern `https://*-alan-alkalifas-projects.vercel.app/**` |
| 2026-11-10 | B1-T15 (onboarding showed the marketing header) is fixed inside #90 rather than a separate PR: `main` had no marketing layout to branch from |
| 2026-11-10 | M3 orders + KOT contract merged (`docs/contracts/orders.md`, #121). **User decisions:** (1) a waiter or cashier may void an item they entered, with a reason, only while its kitchen ticket is still `new`; after that, and for any item without a station, `orders.void` (owner, manager) is required; (2) items with no kitchen station skip the KDS (no ticket) but stay on the order and bill; an order with no live tickets derives `accepted → preparing → ready` in one transaction |
| 2026-11-10 | M3 orders, ALAN's calls: waiters (`orders.create`) mark tables clean; QR/online approval is decided in the M4 contract; `remove_order_discount` ships in M3 (no deletes, removal columns + audit); no auto-ready for tickets; order and ticket numbers reset daily per location (`business_date` in the location's timezone, locked `order_counters` row); KDS timers fixed at 10/20 min (per-location setting → M7 backlog); the kitchen role may read prices through RLS, but the KDS payload omits them. Realtime uses private `location:{id}` channels only, with ids/status payloads |
| 2026-11-10 | MSC-T02's implementation no longer waits for #106 (that wait only throttled the QA queue); the draft opens early so REYKI's MSC-T03 suite can run against it, and it merges after #106 |
| 2026-11-10 | The local repo for ALAN's session is on a Windows mount: a host-side `git status` holds `index.lock` often and fetches are slow. ALAN works in a scratchpad `git worktree` for Markdown PRs |
| 2026-11-11 | Resumed after a usage-limit stop. QA throughput is the bottleneck (14 approved PRs waiting only on QA), so REYKI's PR QA batch 2 (MVM-T16) goes **before** the orders pgTAP suite (MSC-T03, put back to todo). #123 (MSC-T04) therefore merges after MVM-T16 + MSC-T03 |

### `instant = false` opt-outs
_None yet._

---

## 15. Next up

_Resumed 2026-11-11 after a usage-limit stop. #102 (MSS-T08) merged; all three agents re-assigned._

1. **REYKI, MVM-T16 (PR QA batch 2):** #127 → #128 → #126 → menu stack #77 → #79 → #80 → #82 → #84 → #86 → M1 #92 → #95 → #105 → #100 → #109 POS shell. Then MSC-T03 (orders pgTAP, gate for #123), then MSS-T03 / MSS-T07.
2. **DAVIN:** B1-T18 (before_user_created hook: refuse sign-ups when signup is off; the staging hook wiring is a dashboard step for the user). Then confirm migration timestamps on #123/#82/#84/#86 are after `20261110260000_platform_settings`. B1-T27 waits for #123.
3. **ADIT:** MSS-T13 (marketing site in Bahasa + `/en`) → #100 seam removal on the merged #102 + the (frontend) banner → #79 fix for the real e2e failure (`staff.spec.ts:191`, Cashier refusal on the per-location menu route).
4. **Merge order once QA passes:** #127, #128, #126 (any order) → #77 → #79 → #80 → #82 → #84 → #86 → #92 → #95 → #105 → #100 → #109 → #123. Rename-check migrations before each DB PR (staging `db push` refuses out-of-order timestamps).
5. **CI flake:** `supabase start` sometimes fails with a Storage transport error (`GET /storage/v1/bucket`); rerun the job. If it keeps recurring, open a B1 task to wait for Storage health before `db reset`.
6. **Before any deployed environment:** set `EMAIL_DELIVERY=resend`, `RESEND_API_KEY`, `EMAIL_FROM` and the Supabase publishable key; run Supabase advisors; the host must pass the client IP to Arcjet (it fails open without one). Production touches need the user's approval.
