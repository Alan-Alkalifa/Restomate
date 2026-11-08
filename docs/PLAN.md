# PLAN.md — Restomate implementation plan

> **How to use this file.** This is the working build plan. Tick boxes as work lands, and add a line to the *Decisions log* whenever a choice is made.
> - **What** we build and why → `PROJECT.md`
> - **How** we build it (stack, rules, conventions) → `CLAUDE.md`
> - **In what order, and what's done** → this file

Last updated: 2026-11-08

---

## 1. Status snapshot

| Area | State |
|---|---|
| Product spec (`PROJECT.md`) | ✅ Done (DOKU + Resend decided) |
| Engineering rules (`CLAUDE.md`) | ✅ Done. Needs the Next.js 16 corrections in §2 |
| Monorepo (pnpm + Turborepo) | ✅ Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore` |
| Next.js app (`apps/web`) | ✅ Scaffolded (Next 16.4.5, React 19.3, Tailwind v4, TypeScript 5). Dependencies installed |
| Supabase project config | ✅ `supabase/config.toml`: email confirmation on, Resend SMTP block, branded confirm/reset templates |
| Database migrations | ⏳ **Next step**, designed in §4.2 |
| Seed (Demo Restaurant) | ⬜ Not started |
| App code (auth, onboarding, shells) | ⬜ Not started |
| CI | ⬜ Not started |

---

## 2. Technical findings that change the docs

These came from the installed Next.js 16.4.5 and its bundled docs (`apps/web/node_modules/next/dist/docs/`). Apply them to `CLAUDE.md` before writing app code.

- [ ] **`middleware.ts` is now `proxy.ts`** (Next 16 renamed Middleware to Proxy). Update the layout tree and every mention in `CLAUDE.md`. Proxy is for optimistic checks and rewrites only: tenant host routing, session refresh, Arcjet. Never use it for authorization.
- [ ] **Cache Components is on by default** (`cacheComponents: true`, plus `partialPrefetching: true`):
  - Reading `cookies()`/`headers()` (that is, the Supabase session) outside a `<Suspense>` boundary is a **build error**.
  - Layouts must not `await` the session or dynamic `params` at the top level. Pass the promise down and await it inside a Suspense-wrapped child.
  - Session lookups use `'use cache: private'`. Session-derived data is cached with plain `'use cache'` keyed by user/org ID plus `cacheTag`, and refreshed with `updateTag` in Server Actions.
  - Never put emails, tokens or other personal data in cache keys or tags.
  - Escape hatch for a route that isn't ready yet: `export const instant = false`. Use it sparingly and track every use in §9.
- [ ] Next 16 writes an `AGENTS.md` in `apps/web` telling agents to read the bundled docs. Keep it committed.
- [ ] TypeScript stays on **5.x** (what Next 16 ships with), not TypeScript 7.

---

## 3. Milestone overview

| Milestone | Goal | Depends on | Size |
|---|---|---|---|
| **M0 Foundation** | Sign up, create a restaurant, invite staff with a role | — | L |
| **M1 Signup & super admin** | Public site, onboarding wizard, tenants list, packages | M0 | M |
| **M2 Venue & menu** | Areas, tables, floor plan, menu, QR codes | M0 | L |
| **M3 Service core (MVP)** | POS, orders, KOT/KDS, bills, cash, printing, payment tracking | M2 | XL |
| **M4 Customer site** | Branded storefront, QR ordering, online pickup | M2, M3 | L |
| **M5 Payments (DOKU)** | DOKU Checkout, pay-at-table, split/partial, reconciliation | M3, M4 | L |
| **M6 Launch** | Reservations, customers, reports, schedules, theming, subscription billing | M3–M5 | XL |
| **M7 After launch** | Custom domains, loyalty, WhatsApp, offline mode, ESC/POS, inventory | M6 | — |

M1 and M2 can run in parallel once M0 is done.

---

## 4. M0 — Foundation (detailed)

**Exit criteria:**
- A new user signs up, confirms their email (in Mailpit locally), and creates a restaurant with one location.
- They invite a staff member as Cashier. The invitee accepts and sees only what a cashier may see.
- A user from another restaurant cannot read any of it.

### 4.1 Repo and tooling
- [x] pnpm workspace + Turborepo, root scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `db:*`)
- [x] Next.js app in `apps/web`; dependencies installed: `@supabase/ssr`, `@supabase/supabase-js`, `@arcjet/next`, `posthog-js`, `posthog-node`, `resend`, `@react-email/components`, `zod`, `server-only`, `vitest`
- [x] `supabase init`, auth config, Resend SMTP block, email templates
- [ ] Add `typecheck` and `test` scripts to `apps/web/package.json`
- [ ] `packages/db` workspace package that exports the generated `Database` types
- [ ] `.env.example` (matches `CLAUDE.md` → *Environment variables*); `lib/env.ts` validates it with Zod
- [ ] Prettier + ESLint config; Conventional Commits
- [ ] `git init` and first commit

### 4.2 Database foundation (`supabase/migrations/…_foundation.sql`)
Conventions: text columns with `check` constraints instead of enums (easier to evolve), `created_at`/`updated_at` with a shared trigger, RLS on every table, and `(select auth.uid())` in policies for performance. Internal helper functions go in a non-exposed `private` schema.

**Tables**
- [ ] `profiles`: id = `auth.users.id`, full name, email copy, phone. Auto-created by a trigger on `auth.users`
- [ ] `platform_admins`: user_id. Only the service role writes it
- [ ] `packages`: code, name, monthly/yearly price (IDR), trial days, `limits` jsonb (`max_locations`, `max_staff`, `max_tables`), `features` text[], `is_active`, `is_public`, `is_default`
- [ ] `organizations`: slug (3–40 characters, `[a-z0-9-]`), name, status (`active | suspended | past_due | read_only`), default currency `IDR`, timezone `Asia/Jakarta`, contact email
- [ ] `reserved_slugs`: `www, app, admin, api, demo, mail, …`
- [ ] `subscriptions`: org ↔ package, status (`trialing | active | past_due | canceled`), period, `trial_ends_at`, `current_period_end`
- [ ] `locations`: org, name, address, city, phone, timezone, currency, `tax_rate_bps` (1000 = 10%), `service_charge_bps`, `tax_on_service_charge`, `is_active`
- [ ] `permissions`: catalog of permission keys
- [ ] `default_role_permissions`: template for the system roles
- [ ] `roles` (per org, `is_system`), `role_permissions`
- [ ] `organization_members`: org, user, role, status (`active | deactivated`), `all_locations`
- [ ] `location_staff`: member ↔ location
- [ ] `staff_invitations`: org, email, role, location IDs, `token_hash` (SHA-256), `expires_at`, `accepted_at`, `revoked_at`
- [ ] `org_branding`: logo, colors, font, theme jsonb
- [ ] `audit_logs`: org (nullable for platform actions), actor, action, entity, metadata
- [ ] `platform_settings`: key/value jsonb

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
- [ ] `is_platform_admin()`
- [ ] `is_org_member(org)`
- [ ] `has_permission(org, perm)`
- [ ] `has_location_access(location)`
- [ ] `my_permissions(org) → text[]` (for the UI)
- [ ] `private.org_limit(org, key)`, `private.write_audit(...)`

**RPCs**
- [ ] `is_slug_available(slug)`: anon + authenticated
- [ ] `create_organization(name, slug, location…, package_code?)`: **one transaction** creates the org, system roles and permissions, owner membership, first location, branding row, trialing subscription on the default package, and an audit entry. Caps owned organizations per user (abuse guard)
- [ ] `accept_invitation(token)`: hash matches, not expired or revoked, invitee's email matches `auth.jwt() ->> 'email'`
- [ ] `get_storefront(slug)`: public info, branding and active locations of an **active** org only. Anon
- [ ] `admin_set_org_status(org, status, reason)`: platform admin only, audited

**Triggers**
- [ ] Package limits on insert into `locations`, `organization_members` and `staff_invitations` (raise `PLAN_LIMIT:<key>`)
- [ ] The last active owner of an organization cannot be removed, deactivated or demoted
- [ ] System roles cannot be deleted, and the owner role's permissions cannot be edited
- [ ] `updated_at` maintenance; email sync from `auth.users` to `profiles`

### 4.3 Database tests
- [ ] Use `supabase test db` (pgTAP) in `supabase/tests/`
- [ ] Org A member cannot select/insert/update org B rows (every table)
- [ ] Cashier cannot manage staff; Manager cannot manage billing
- [ ] Removing the last owner fails; limits trigger at the package cap
- [ ] `accept_invitation` rejects a wrong email, an expired token and a reused token
- [ ] Fallback when Docker isn't available: run migrations against plain Postgres 16 with a small `auth` schema shim (`auth.users`, `auth.uid()`, `auth.jwt()`, `anon`/`authenticated`/`service_role` roles)

### 4.4 Seed (`supabase/seed.sql`, local only)
- [ ] Packages Starter / Growth / Pro with placeholder IDR prices, published. Growth is the trial default
- [ ] Platform admin `admin@restomate.local`
- [ ] **Demo Restaurant** (`demo` is reserved for the public marketing link and maps to this org):
  - owner `owner@demo.local`, plus one cashier, one waiter and one kitchen user
  - two locations (Jakarta Selatan, Bandung)
  - branding
- [ ] All seed passwords are local-only and documented in the README

### 4.5 App infrastructure (`apps/web/lib`)
- [ ] `env.ts` (Zod-validated; fails fast on boot)
- [ ] `supabase/server.ts`, `supabase/client.ts`, `supabase/proxy.ts` (session refresh), `supabase/admin.ts` (`server-only`)
- [ ] `auth/dal.ts`: `getCurrentUser()` (`'use cache: private'`), `requireUser()`, `getMembership(orgSlug)`, `requirePermission(orgId, perm)`, `requirePlatformAdmin()`
- [ ] `proxy.ts`:
  - resolve host → surface (`restomate.app` → frontend, `app.` → admin, `{slug}.` → storefront rewrite)
  - refresh the Supabase session
  - skip `/api/webhooks/doku`
- [ ] `arcjet.ts`: shared rules (shield + bot detection + rate limit; signup preset with email validation)
- [ ] `posthog/`: client provider, server capture, `events.ts` constants; group by organization
- [ ] `email/`: Resend client, `send()` wrapper with idempotency key and `EMAIL_DELIVERY=log` mode; `emails/StaffInvite.tsx`
- [ ] `money.ts`: currency exponent (IDR = 0), formatting `Rp 25.000`, tax + service charge calculation, with unit tests
- [ ] `payments/doku/signature.ts`: Non-SNAP signing and verification, with unit tests against DOKU's documented example. Built early because it is small and pure; the rest of DOKU is M5

### 4.6 Auth pages (`app/(auth)`)
- [ ] Login (email + password), with Arcjet protection
- [ ] Signup (name, email, password), with Arcjet signup protection; sends the confirm email via Supabase → Resend SMTP (Mailpit locally)
- [ ] `/auth/confirm` route handler (`verifyOtp` with `token_hash`), then redirect to `next`
- [ ] Forgot password → email → `/reset-password`
- [ ] Sign out (Server Action)

### 4.7 Onboarding (`app/(frontend)/onboarding`)
- [ ] Step 1: restaurant name + slug with a live availability check
- [ ] Step 2: first location (address, city, timezone, tax and service charge defaults)
- [ ] Step 3: logo + colors (skippable)
- [ ] Submit → `create_organization` RPC → redirect to `/{org}`. PostHog events `signup_completed`, `onboarding_completed`, `trial_started`

### 4.8 Staff invitations (`app/(dashboard)/[org]/staff`)
- [ ] Staff list (members + pending invites), gated by `staff.manage`
- [ ] Invite form: email, role, locations → insert invitation (raw token generated server-side, only the SHA-256 hash stored) → Resend email with accept link
- [ ] `/invite/[token]`: sign in or sign up with the invited email → `accept_invitation` → redirect to the org
- [ ] Resend and revoke invitations; change role; deactivate a member

### 4.9 Surface shells
- [ ] `(frontend)`: home placeholder, pricing page reading public `packages`, demo link
- [ ] `(dashboard)/[org]`: sidebar built from `my_permissions`, location switcher, setup checklist on the home page, locked-feature state from package features
- [ ] `(superadmin)/admin`: guarded by `platform_admins`; tenants list (search, status, plan) and suspend/reactivate
- [ ] `(storefront)/s/[tenant]`: branded placeholder page from `get_storefront`; "temporarily unavailable" for suspended orgs

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
- [ ] Super admin **Platform settings**: signup on/off, maintenance banner, tax presets
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

### `instant = false` opt-outs
_None yet._

---

## 15. Next up

1. Apply the §2 corrections to `CLAUDE.md`.
2. Write the foundation migration (§4.2) and run it against local Postgres.
3. Seed Demo Restaurant (§4.4).
4. Build the app infrastructure and auth pages (§4.5–4.6).
