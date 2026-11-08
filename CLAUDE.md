# CLAUDE.md — Restomate

Restomate is a multi-tenant restaurant management SaaS. Each restaurant (tenant) runs its POS, orders, kitchen, tables, reservations, staff and reports from one dashboard. It also gets a branded customer ordering site with QR-code table ordering.

Read this file before making changes. When something here conflicts with the code, the code wins. Flag the mismatch so this file can be updated.

---

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript 5.x, Server Components / Server Actions, Cache Components on) | Lives in `apps/web`. See *Next.js 16 rules* below |
| Auth | **Supabase Auth** | `@supabase/ssr` cookie sessions |
| Database | **Supabase Postgres** | RLS everywhere, Realtime for live order/KOT updates, Storage for logos and menu images |
| Analytics | **PostHog** | Product analytics for the dashboard, grouped by organization |
| Security | **Arcjet** | Bot protection, rate limiting, shield on public and auth routes |
| Payments | **DOKU** (DOKU Checkout, Non-SNAP API) behind a `PaymentProvider` adapter | QRIS, virtual accounts, e-wallets, cards. Used for restaurant guest payments **and** Restomate subscription billing (see Payments) |
| Email | **Resend** | Supabase Auth emails via Resend **SMTP**; app emails via the Resend API with React Email templates (see Email) |
| Styling | Tailwind CSS + CSS variables for tenant theming | |

Agent skills in use: `vercel/next.js`, `vercel-labs/agent-skills`, `supabase/agent-skills`, `PostHog/skills`, `arcjet/skills`. The Supabase and PostHog MCP servers are available. Use them to inspect schema, run read-only queries, check advisors and look up events. Do not use them for ad-hoc writes to production.

---

## Repository layout

```
apps/
  web/                      # Next.js app (dashboard + storefront + API)
    app/
      (frontend)/           # 4. Public site: landing, pricing (packages), restaurant signup/onboarding
        signup/  onboarding/
      (auth)/               # login, password reset, staff invite acceptance
      (dashboard)/[org]/    # 1. Restaurant admin: /[org]/[location]/...
        pos/  orders/  kitchen/  tables/  areas/  reservations/
        menu/  customers/  staff/  payments/  reports/  settings/
      (superadmin)/admin/   # 2. Super admin (platform staff only)
        tenants/  packages/  billing/  settings/
      (storefront)/s/[tenant]/   # 3. Customer site (rewritten from subdomain/custom domain)
        t/[tableToken]/          # QR table ordering entry point
      api/
        webhooks/doku/      # DOKU HTTP Notification endpoint (signature-verified, idempotent)
    lib/
      supabase/             # server.ts, client.ts, proxy.ts (session refresh), admin.ts (service role, server-only)
      auth/                 # session helpers, requirePermission()
      payments/             # PaymentProvider interface + doku/ (client, signature, notification)
      email/                # Resend client + send helpers (server-only)
      arcjet.ts             # shared Arcjet instances/rules
      posthog/              # client + server capture helpers
      money.ts              # minor-unit helpers, formatting
      theme.ts              # tenant theme -> CSS variables
    components/
      ui/                   # primitives
      pos/ kitchen/ storefront/ print/
    emails/                 # React Email templates (invite, order receipt, reservation, invoice)
    proxy.ts                # Next 16 Proxy (formerly middleware): session refresh + tenant host resolution + Arcjet. Never authorization
    AGENTS.md               # written by Next 16; tells agents to read node_modules/next/dist/docs. Keep it committed
supabase/
  migrations/               # SQL migrations — the source of truth for schema
  seed.sql
  functions/                # Edge Functions (if needed)
packages/
  db/                       # generated types (database.types.ts)
```

If the repo does not match this layout yet, follow the layout when creating new files.

---

## App surfaces

The front end is made up of four surfaces. They share one Next.js app, one design system and one database, but each has its own layout, its own audience and its own access rules. Never let one surface's navigation or data leak into another.

| # | Surface | Audience | Host / route | Access |
|---|---|---|---|---|
| 1 | **Restaurant admin** | Restaurant owners and staff | `app.restomate.app/[org]/...` | Signed in, member of the org, permission-checked |
| 2 | **Super admin** | Restomate platform team | `app.restomate.app/admin/...` | Signed in **and** listed in `platform_admins` |
| 3 | **Customer site** | Restaurant guests | `{slug}.restomate.app` or custom domain | Public (guest ordering) |
| 4 | **Frontend (signup)** | Restaurants evaluating Restomate | `restomate.app` | Public |

### 1. Restaurant admin
POS, menus, kitchen display (KDS), staff, and day-to-day operations: everything in the feature list that a restaurant uses to run service.
- Scoped to one organization and, inside it, one selected location (location switcher in the header).
- Navigation and actions are filtered by the user's permissions (see Roles and permissions).
- POS and KDS are full-screen, touch-first layouts without the regular sidebar.
- Features the tenant's package does not include are shown as locked with an upgrade prompt, and are also blocked server-side.

### 2. Super admin
Tenants, packages, billing and platform settings. Used only by the Restomate team.
- **Tenants:** list, search and view organizations; see usage, plan and status; suspend or reactivate; trigger a password reset for the owner.
- **Packages:** create and edit subscription plans (`packages`): price per billing period, trial length, limits (locations, staff, tables, orders per month) and feature flags (for example `qr_ordering`, `reservations`, `custom_domain`, `advanced_reports`).
- **Billing:** tenant subscriptions, invoices, failed payments, plan changes, manual credits.
- **Platform settings:** default currency and tax presets, supported payment gateways, email templates, maintenance banner, signup on/off.
- Access is granted only through a `platform_admins` table checked on the server **and** in RLS (`is_platform_admin()`). Never decide it from an email domain or a client-side flag.
- Super admin pages use the service-role client only inside server code, and every write goes to `audit_logs` with the platform admin's ID.
- If "view as tenant" (impersonation) is added, it must be read-only by default, time-limited, clearly bannered in the UI, and audit-logged.
- Super admin routes are excluded from search indexing and protected by Arcjet rate limiting.

### 3. Customer site
The public menu and ordering site each restaurant gets. **Demo Restaurant** is the seeded example tenant used for development, screenshots and the public demo link.
- Resolved by host in `proxy.ts` (see Customer storefront and QR ordering below).
- Fully branded from `org_branding`; no Restomate admin chrome.
- Shows only published menu items that are available at the selected location and time.
- Demo Restaurant lives in `supabase/seed.sql` with a realistic menu, areas, tables and QR tokens. Keep it working; e2e tests use it. Orders placed on the public demo must not trigger real payments (use gateway test mode or cash-only).

### 4. Frontend (signup)
The public Restomate marketing site, where new restaurants join the SaaS.
- Landing page, feature pages, pricing (rendered from active `packages`, never hard-coded), and a link to the Demo Restaurant.
- **Signup flow:** create account (Supabase Auth) → verify email → onboarding wizard (restaurant name, slug, first location, currency, timezone, logo/colors) → choose package or start trial → land in the restaurant admin.
- Signup creates the organization, the owner membership with the `owner` role, and a default location in **one transaction** (a single RPC), so a half-created tenant can never exist.
- Validate slug uniqueness and block reserved slugs (`www`, `app`, `admin`, `api`, `demo`, `mail`, etc.).
- Protect signup and login with Arcjet (bot detection, rate limits, email validation).
- Track the signup funnel in PostHog (`signup_started`, `signup_completed`, `onboarding_completed`, `trial_started`).

---

## Commands

```bash
pnpm install
pnpm dev                     # run apps/web
pnpm build && pnpm start
pnpm lint
pnpm typecheck
pnpm test                    # unit tests (Vitest)
pnpm test:e2e                # Playwright

supabase start               # local Postgres/Auth/Realtime/Storage
supabase migration new <name>
supabase db reset            # re-apply migrations + seed locally
supabase gen types typescript --local > packages/db/database.types.ts
```

After any schema change, create a migration, run `supabase db reset`, regenerate types, then run `pnpm typecheck`.

---

## Multi-tenancy (most important rule)

The hierarchy is: **organization → location → area → table**.

- `organizations` is the restaurant brand and billing entity. Its `slug` is used for the subdomain.
- `locations` are branches. Menu, tables, orders and staff schedules are per location. Menu items can be shared across locations with per-location overrides for price and availability.
- Every tenant-owned table has `organization_id` (and `location_id` where relevant). It is `NOT NULL` and indexed.
- **RLS is enabled on every table in `public`.** No exceptions. Policies check membership through SQL helpers:
  - `is_org_member(org_id uuid)`
  - `has_permission(org_id uuid, perm text)`
- Never trust an `organization_id` sent from the client. Derive it from the route plus the user's membership, and let RLS enforce it.
- The service-role client (`lib/supabase/admin.ts`) is server-only. Use it only in webhooks, background jobs and the public storefront order intake. Always scope those queries by tenant explicitly.
- Each new table's migration must include its RLS policies and a test that a member of org A cannot read or write org B's rows.

---

## Domain model (core tables)

- **Identity and staff:** `profiles`, `organization_members` (user ↔ org, role), `roles`, `role_permissions`, `location_staff`, `staff_shifts`
- **Venue:** `locations`, `areas` (zones), `tables` (capacity, status, `qr_token`)
- **Menu:** `menu_categories`, `menu_items`, `item_variants`, `modifier_groups`, `modifiers`, `location_menu_overrides` (price, availability, stock-out)
- **Orders:** `orders` (channel: `dine_in | takeaway | qr | online`), `order_items` (price/name snapshot at time of order), `order_item_modifiers`, `order_events` (audit trail)
- **Kitchen:** `kitchen_tickets` (KOT), `kitchen_ticket_items`, `kitchen_stations`
- **Reservations:** `reservations` (party size, time slot, table/area, status), `reservation_settings` per location
- **Billing:** `bills`, `bill_items`, `payments` (many per bill: partial and split; `invoice_number`, `gateway_session_id`, `expires_at`), `refunds`, `tax_rates`, `discounts`, `payment_gateway_accounts` (per-org DOKU credentials, encrypted), `payment_notifications` (raw DOKU notifications, dedup key)
- **Customers:** `customers` (per org), `customer_preferences`, `customer_feedback`, `loyalty_ledger`
- **Branding:** `org_branding` (logo, colors, fonts, theme JSON), `custom_domains`
- **Platform (super admin):** `platform_admins`, `packages` (plans: price, period, limits, feature flags), `subscriptions` (org ↔ package, status, trial end, period end), `platform_invoices`, `platform_settings`, `audit_logs`

### State machines (keep transitions in one place, `lib/orders/transitions.ts`)

- **Order:** `draft → placed → accepted → preparing → ready → served → completed`, plus `cancelled` from any pre-`served` state
- **KOT:** `new → in_progress → ready → bumped`
- **Table:** `available → reserved → occupied → needs_cleaning → available`
- **Payment status (on bill):** `unpaid → partially_paid → paid`, plus `refunded` / `partially_refunded`. Derive it from the sum of `payments`; never set it by hand.
- **Reservation:** `pending → confirmed → seated → completed`, plus `no_show` and `cancelled`

Record every transition in `order_events` / `audit_logs` with actor and timestamp.

---

## Money, tax and time

- Store money as **integer minor units** (`bigint`) with a `currency` column. Never use floats.
- The default currency is **IDR**, which has no minor unit in practice: store whole Rupiah (`Rp 25.000` → `25000`). Use the currency's exponent from `lib/money.ts` (IDR = 0, USD = 2) instead of assuming 2 decimals. DOKU amounts are sent as whole Rupiah integers.
- Default tax preset is the Indonesian regional restaurant tax (**PB1**, now formally PBJT for food and beverages; up to 10%, set by each regional government) plus an optional **service charge**. Never hard-code the rate. Both are configurable per location; the order is service charge first, then tax on the subtotal plus service charge, unless the location's setting says otherwise.
- Snapshot item names, prices, tax rates and modifiers onto `order_items` / `bill_items`. Later menu edits must not change past orders.
- Each location has a timezone and currency. Store `timestamptz`. Do date bucketing for reports in the location's timezone.
- Do rounding and tax computation in one module (`lib/money.ts`) and test it.

---

## Roles and permissions

Default roles: `owner`, `manager`, `cashier`, `waiter`, `kitchen`. Owners can create custom roles.

Permissions are strings, for example: `menu.manage`, `orders.create`, `orders.void`, `pos.discount`, `payments.refund`, `reports.view`, `staff.manage`, `tables.manage`, `reservations.manage`, `settings.branding`, `billing.manage`.

Check permissions twice:
1. In Postgres, via RLS using `has_permission()`.
2. In every Server Action or route handler, via `requirePermission(orgId, 'perm')` from `lib/auth`. Hide UI the user cannot use, but never rely on hiding alone.

Staff can be limited to specific locations (`location_staff`).

---

## Real-time

- Use Supabase Realtime (Postgres changes or broadcast) for the kitchen display, the live order board, table status and incoming QR/online orders.
- Subscribe per location channel (`location:{id}`). RLS still applies to what a client receives.
- The UI must recover from dropped connections: refetch on reconnect, and never assume event order.

---

## Customer storefront and QR ordering

- Tenant sites resolve by host in `proxy.ts`: `{slug}.restomate.app` or a verified custom domain is rewritten to `/(storefront)/s/[tenant]`.
- A QR code encodes `/t/{qr_token}`. The token maps to a table and location. Tokens are random, can be rotated, and never expose internal IDs.
- Storefront order intake runs server-side. Recompute prices from the database and never trust client totals. Validate item availability and location opening hours.
- Customers may order as guests (phone/email optional). Link them to a `customers` record when they identify themselves.
- Branding is applied by injecting `org_branding` as CSS variables at the storefront layout. No per-tenant code branches.

---

## Payments

The payment gateway is **DOKU** (Indonesia). Use **DOKU Checkout** (hosted payment page) with the **Non-SNAP** API. Checkout covers QRIS, bank virtual accounts, e-wallets (OVO, DANA, ShopeePay, LinkAja), cards and paylater on one page, so we do not integrate each method separately.

**Two separate money flows. Never mix them.**
1. **Guest payments** (restaurant ← guest): each organization connects its **own** DOKU merchant account (Client ID + Secret Key) in Settings. Credentials are stored encrypted (`payment_gateway_accounts`), read only on the server, and never returned to the browser.
2. **Subscription billing** (Restomate ← restaurant): uses **Restomate's own** DOKU merchant account from environment variables. Recorded in `subscriptions` / `platform_invoices`.

**Adapter.** All gateway code sits behind `PaymentProvider` in `lib/payments/`:
`createCheckout(input) → { paymentUrl, sessionId, expiresAt }`, `getStatus(invoiceNumber)`, `verifyNotification(headers, rawBody, path)`, `parseNotification(rawBody)`. DOKU is the only implementation for now. Adding another gateway must not require changes outside `lib/payments/`.

**DOKU request signing (Non-SNAP).** Every request and every notification uses the same scheme:
```
Digest    = base64(sha256(rawBody))                    # omitted for GET
Component = "Client-Id:{id}\nRequest-Id:{uuid}\nRequest-Timestamp:{ISO8601 UTC}\nRequest-Target:{path}\nDigest:{digest}"
Signature = "HMACSHA256=" + base64(hmacSha256(Component, SECRET_KEY))
```
- Hosts: `https://api-sandbox.doku.com` (sandbox) and `https://api.doku.com` (production), chosen by `DOKU_ENV`.
- For outgoing requests, `Request-Target` is the DOKU path (Checkout: `/checkout/v1/payment`). For incoming notifications it is **our** notification path (`/api/webhooks/doku`).
- Signing lives in one module (`lib/payments/doku/signature.ts`) with unit tests against DOKU's documented examples.

**Invoice numbers.** `invoice_number` is unique per merchant account and is how a notification is matched back. Format: `RM-{orgShortId}-{billNumber}-{attempt}` for guest bills, `RMSUB-{orgShortId}-{yyyymm}-{attempt}` for subscriptions. Store it on the `payments` row before redirecting to DOKU.

**Notifications (`/api/webhooks/doku`).**
- Read the **raw** body (`await req.text()`) before parsing. Verify the signature with a constant-time compare; reject with 401 on mismatch.
- Look up which DOKU account (organization or platform) the `Client-Id` header belongs to, and verify with that account's secret.
- **Idempotent:** DOKU can send the same notification more than once. Record each in `payment_notifications` with a unique key (`client_id`, `invoice_number`, `request_id`) and skip duplicates.
- Parse the JSON leniently (DOKU adds fields over time). Treat `transaction.status = SUCCESS` as paid. For Checkout, **ignore `FAILED`** notifications: the guest can retry on the same page, and expiry is handled by the payment's `expires_at`.
- Before marking paid, check the amount and currency match the stored `payments` row. Then update `payments` and the bill's derived status in **one transaction**.
- Return HTTP 200 quickly once recorded. DOKU only needs 200 to consider the notification delivered.
- If a notification is missed, a reconciliation job calls DOKU's Check Status API for `pending` payments older than 15 minutes.

**Other rules**
- Supported methods at the POS: cash, card on the restaurant's own EDC terminal (recorded only), DOKU online (QRIS shown on screen / link sent to guest), split and partial payments.
- Refunds are recorded in `refunds`. Gateway refunds through DOKU depend on the payment method; where DOKU does not support an API refund, record it as a manual refund with a note.
- Use DOKU sandbox credentials in development and on the Demo Restaurant. Production credentials never appear in seed files, logs or the client.
- Never log secret keys, full notification headers, or card data.

---

## Email (Resend)

All email goes through **Resend**, sent from a verified subdomain (for example `mail.restomate.app`), never from the root domain.

**1. Supabase Auth emails → Resend SMTP.** Sign-up confirmation, password reset, magic link, email change and invites are sent by Supabase Auth through custom SMTP. Configure it in Supabase → Authentication → SMTP (or the Resend integration for Supabase):

| Setting | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — `587` (STARTTLS) also works |
| Username | `resend` |
| Password | a Resend API key (`re_...`) with sending access only |
| Sender | `Restomate <no-reply@mail.restomate.app>` |

Supabase's built-in mailer is heavily rate-limited and is only acceptable for local development (local Supabase uses Inbucket/Mailpit). Customize the auth email templates in Supabase so they match Restomate's branding.

**2. App emails → Resend API.** Everything else (staff invitations with role info, reservation confirmations, order receipts, subscription invoices, payment-failed notices, low-rating feedback alerts) is sent from server code through `lib/email/` using the `resend` Node SDK and React Email templates in `emails/`.
- `lib/email/` is server-only. Never import it into client components.
- One function per email type (`sendStaffInvite`, `sendReservationConfirmation`, …) with typed props; no ad-hoc HTML strings.
- Guest-facing emails are branded with the restaurant's `org_branding` (logo, colors) and use the restaurant name as the sender name: `"{Restaurant} via Restomate" <orders@mail.restomate.app>`, with `reply_to` set to the restaurant's contact email.
- Pass an idempotency key (for example `reservation-confirm/{reservationId}`) so retries never send duplicates.
- Sending email must never block or fail the main action. Queue or `after()` the send, log failures, and allow a manual resend.
- In development, set `EMAIL_DELIVERY=log` to print emails to the console instead of sending.

---

## Environment variables

Defined and validated with Zod in `apps/web/lib/env.ts`. Keep `.env.example` in sync. Anything without `NEXT_PUBLIC_` is server-only.

```
NEXT_PUBLIC_APP_URL=            # https://app.restomate.app
NEXT_PUBLIC_ROOT_DOMAIN=        # restomate.app (used for tenant subdomains)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
ARCJET_KEY=
RESEND_API_KEY=
EMAIL_FROM=                     # Restomate <no-reply@mail.restomate.app>
EMAIL_DELIVERY=                 # resend | log
DOKU_ENV=                       # sandbox | production
DOKU_CLIENT_ID=                 # Restomate's own merchant account (subscription billing)
DOKU_SECRET_KEY=
APP_ENCRYPTION_KEY=             # 32-byte key for encrypting tenant gateway credentials
```

---

## Printing (bills and KOTs)

- Start with browser printing: dedicated print routes under `components/print/` with print CSS sized for 80mm and 58mm thermal paper.
- Keep the print layout data-driven (logo, address, tax ID and footer come from settings).
- Direct ESC/POS printing via a local bridge is a later phase. Keep the print data model separate from the HTML so it can be reused.

---

## Reports

- Build reports from SQL (views or `security invoker` RPC functions) so RLS still applies. Do not aggregate in JavaScript over large result sets.
- Core reports: sales by day/hour/item/category/location, payment method mix, outstanding and partial payments, staff performance (orders, sales, voids, discounts), table turnover, reservation no-shows, repeat customers.
- Add indexes for report filters (`organization_id, location_id, created_at`).
- Export to CSV.

---

## Security (Arcjet)

- Configure rules in `lib/arcjet.ts` and reuse them. Do not create ad-hoc instances.
- Apply **bot detection + rate limiting + shield** to: auth routes, storefront order submission, reservation creation, customer feedback forms and public API routes.
- Exclude the DOKU notification route (`/api/webhooks/doku`) from bot detection and rate limiting. It relies on signature verification instead.
- Validate all input with Zod at server boundaries (Server Actions, route handlers).
- If AI features are added (for example menu description generation), run user-supplied text through Arcjet's prompt-injection protection before it reaches a model.

---

## Analytics (PostHog)

- Dashboard: identify staff users by user ID and use **group analytics** with `organization` (and optionally `location`) as groups.
- Storefront: track anonymous funnel events (menu viewed, item added, checkout started, order placed). **Do not send customer PII** (names, phone numbers, emails) to PostHog.
- Event names use `snake_case` with an object_action pattern (`order_placed`, `reservation_created`, `menu_item_updated`). Keep a list in `lib/posthog/events.ts`.
- Use feature flags for gradual rollouts of new modules.

---

## Next.js 16 rules

Next.js 16 changed several defaults. When these rules and older Next.js habits disagree, these rules win. When they disagree with the installed docs in `apps/web/node_modules/next/dist/docs/`, the installed docs win; flag the mismatch so this file can be updated.

- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed Middleware to Proxy. Use it only for optimistic checks and rewrites: tenant host routing, Supabase session refresh, Arcjet. Never make an authorization decision there; authorization happens in the DAL (`lib/auth`) and in RLS. The DOKU notification route (`/api/webhooks/doku`) is skipped by the proxy matcher.
- **Cache Components is on** (`cacheComponents: true`, `partialPrefetching: true`).
  - Reading `cookies()` or `headers()` (and so the Supabase session) outside a `<Suspense>` boundary is a **build error**.
  - Layouts must not `await` the session or dynamic `params` at the top level. Pass the promise down and await it inside a Suspense-wrapped child.
  - Session lookups (`getCurrentUser()` in `lib/auth/dal.ts`) use `'use cache: private'`.
  - Session-derived data is cached with plain `'use cache'`, keyed by user or org ID plus a `cacheTag`, and refreshed with `updateTag` in Server Actions.
  - Never put emails, tokens or other personal data in cache keys or tags.
  - Escape hatch for a route that isn't ready yet: `export const instant = false`. Use it sparingly and record every use in `docs/PLAN.md` (*`instant = false` opt-outs*).
- **TypeScript stays on 5.x** (what Next 16 ships with), not TypeScript 7.
- Keep `apps/web/AGENTS.md` committed. Read the bundled docs before using an API you are unsure about.

---

## Conventions

- TypeScript strict mode. No `any` without a comment explaining why.
- Prefer Server Components and Server Actions. Use client components only for interactivity (POS, KDS, table map, drag and drop).
- Data access goes through typed helpers using the generated `Database` types.
- Validate with Zod. Share schemas between the form and the action.
- Keep UI states complete: loading, empty, error and offline/reconnecting (POS and KDS screens run on unstable restaurant Wi-Fi).
- Dates: store UTC, display in the location's timezone.
- Accessibility: the POS and KDS must be fully usable on touch screens with large hit targets.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:` …).

---

## Testing

- Unit tests (Vitest) for money/tax math, order state transitions, permission checks, DOKU signature generation/verification and notification idempotency.
- Database tests for RLS: cross-tenant reads and writes must fail.
- Playwright end-to-end tests for the critical flows: QR order → KOT → serve → bill → split payment → print; reservation → seat; staff role restrictions.

---

## Do not

- Disable RLS or add a `using (true)` policy on tenant data.
- Import `lib/supabase/admin.ts` into client components or any file without `import 'server-only'`.
- Edit an already-applied migration. Write a new one.
- Trust prices, totals, `organization_id` or roles that come from the client.
- Store money as floats.
- Hard-code tenant branding or create per-tenant code paths.
- Grant super admin access any way other than the `platform_admins` table.
- Hard-code plan prices or feature limits; read them from `packages`.
- Enforce package limits only in the UI; check them on the server too.
- Mark a payment paid from a browser redirect (DOKU's return URL). Only a verified DOKU notification or a Check Status API call can do that.
- Send DOKU or Resend secrets to the browser, or use Restomate's DOKU account for a restaurant's guest payments.

---

## Build order (suggested)

1. Auth, organizations, locations, membership, roles and permissions, RLS helpers; seed Demo Restaurant
2. Frontend (signup): signup + onboarding RPC that creates a tenant in one transaction
3. Super admin foundation: `platform_admins`, tenants list, packages with feature flags and limits
4. Restaurant admin: areas, tables and menu management
5. POS and order management, with the KOT and kitchen display (Realtime)
6. Bills, payments (cash first, then DOKU Checkout), partial payments, bill printing
7. Customer site: QR ordering and the branded storefront, with theme customization
8. Reservations and table management
9. Customers, loyalty and feedback
10. Reports, staff scheduling, and super admin billing (subscriptions, invoices, plan enforcement)
