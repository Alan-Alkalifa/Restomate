# M0 test plan (Foundation)

Owner: REYKI · Task: MF-T24 · Sources: `docs/PLAN.md` §4, `docs/PROJECT.md` §4.9 / §5.2, `CLAUDE.md`.
Reference for every M0 PR verification. Companion files: `BUG_TEMPLATE.md`, `PR_REPORT_TEMPLATE.md`.

> **Status note.** `list_tasks` returns task titles only. Per-task cases in §4 are derived from the PLAN §4 checklist; dev PR descriptions must include the task's acceptance criteria and QA focus, and those win where they differ. Open questions were answered by ALAN (§9) and are now the expected results.

## 1. Scope and environment

- Local only: `supabase start`, `pnpm dev`, Mailpit (Supabase Inbucket/Mailpit, usually http://127.0.0.1:54324), `EMAIL_DELIVERY=log` where noted. DOKU sandbox only. Never production, never real emails.
- Reset between runs: `supabase db reset` (re-applies migrations + `seed.sql`). Every destructive test starts from a reset or creates its own throwaway data.
- Browsers: latest Chromium for e2e; spot-check WebKit/Firefox on auth pages. Viewports: 1280×800 and 400×800.
- Pre-flight for every PR: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `supabase db reset && supabase test db`, then Playwright (once MF-T28+ exist).
- Fallback if Docker is unavailable: plain Postgres 16 + auth shim (PLAN §4.3). Record in the PR report that the fallback was used.

## 2. Test data

Seeded by MF-T05 (`supabase/seed.sql`). Passwords are local-only and documented in the README (take them from there; never copy into tests as literals outside e2e fixtures).

| User | Org | Role | Notes |
|---|---|---|---|
| `owner@demo.local` | Demo Restaurant (**org A**, slug `demo`) | owner | all locations |
| `manager@demo.local` | org A | manager | seeded (MF-T05, per ALAN) |
| `cashier@demo.local` | org A | cashier | |
| `waiter@demo.local` | org A | waiter | |
| `kitchen@demo.local` | org A | kitchen | |
| `owner@other.local` | Other Bistro (`other-bistro`) (**org B**) | owner | org B, needed for every cross-tenant test; seeded per ALAN |
| `admin@restomate.local` | none | platform admin | in `platform_admins` |

Org A has two locations: Jakarta Selatan, Bandung. Packages: Starter (1 loc / 5 staff / 20 tables), Growth (3 / 25 / 100, trial default), Pro (unlimited).

Extra fixtures created by tests (not seeded): a deactivated member of org A, an expired invitation, a revoked invitation, an org on Starter at its staff cap, a suspended org, a user with no membership, a user who is owner of the max number of organizations.

Helper conventions for pgTAP/e2e: impersonate via `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","email":"<email>"}'`; anon via `set local role anon`.

## 3. Exit criteria cases

### M0-E1: sign up, confirm email, create a restaurant with one location

| Step | Action | Expected |
|---|---|---|
| E1.1 | Open `/signup` as a visitor. Submit name, new email `qa+e1@test.local`, valid password | Redirect/notice "check your email". No session yet. A row exists in `auth.users` unconfirmed, `profiles` row auto-created with email copy |
| E1.2 | Try to open `/onboarding` and `/{any-org}` before confirming | Redirected to `/login`; no data shown |
| E1.3 | Open Mailpit, find the confirmation email | Exactly one email, to that address only, branded Restomate template, sender `Restomate <no-reply@…>`; link points to `/auth/confirm?token_hash=…&type=…` |
| E1.4 | Click the link | Session cookie set; redirected to `next` (onboarding). Link reuse shows an error, not a second session. Tampered `token_hash` shows an error |
| E1.5 | Onboarding step 1: name "QA Resto", type slug; try `www`, `app`, `admin`, `demo`, a 2-char slug, uppercase, spaces, an existing slug | Reserved/invalid/taken slugs rejected with a clear message and live availability indicator; valid slug shown available |
| E1.6 | Step 2: address, city, timezone, tax (PB1 bps) and service charge; submit with invalid values (negative, >10000 bps, empty) | Invalid values rejected server-side. Defaults: IDR, Asia/Jakarta |
| E1.7 | Step 3: skip logo/colors | Allowed. Second run: upload logo and pick colors; saved to `org_branding` |
| E1.8 | Submit | One transaction created: organization (active), 5 system roles with permissions, owner membership (active, all_locations), exactly **one** location, `org_branding` row, trialing subscription on the default package (Growth), audit entry. Redirect to `/{slug}` showing the setup checklist |
| E1.9 | Force a failure (duplicate slug race: submit same slug twice in parallel; or kill the RPC mid-way via a bad location value) | No half-created tenant: zero org/roles/members rows for the failed attempt |
| E1.10 | Submit the form twice quickly (double click/refresh) | One organization only |
| E1.11 | Create orgs repeatedly with the same user | Owned-org cap hit → friendly error (abuse guard) |
| E1.12 | PostHog (or `log` capture) | `signup_completed`, `onboarding_completed`, `trial_started` captured once each; no email/name in properties; grouped by organization |
| E1.13 | Wrong-state access | Signed-in user with an org visiting `/onboarding` is handled sensibly (redirect or second org per cap); unconfirmed user cannot call the RPC directly |

### M0-E2: invite a Cashier; invitee accepts and sees only cashier things

| Step | Action | Expected |
|---|---|---|
| E2.1 | As owner of org A open Staff page | Members + pending invites list. Sidebar shows all owner items |
| E2.2 | Invite `cashier2@test.local`, role Cashier, location Jakarta Selatan only | Invitation row: `token_hash` is 64-hex SHA-256, **raw token not stored anywhere** (check DB, logs, audit metadata); `expires_at` in the future; email sent once to that address (Mailpit) with accept link `/invite/<token>`; branded; sender per CLAUDE.md |
| E2.3 | Invite same email again while pending | Rejected or replaces per spec; Decided: duplicate pending invite for same email+org is rejected with "Already invited, use Resend"; inviting an existing active member is rejected; never two valid tokens for same email+org |
| E2.4 | Resend the invite | New token; old link stops working; one new email; idempotency key prevents duplicate on retry |
| E2.5 | Open the old/revoked/expired/garbage link | Generic "invalid or expired" page; no information on whether the email/org exists |
| E2.6 | Open valid link signed out | Prompted to sign in / sign up; email field fixed to the invited address (or mismatch rejected) |
| E2.7 | Sign up as invitee, confirm email (Mailpit), return to link | `accept_invitation` succeeds; membership active with Cashier role; `location_staff` only Jakarta Selatan; invitation `accepted_at` set; redirect to `/{org}` |
| E2.8 | Re-use the same link | Fails (reused token) |
| E2.9 | Sign in as a *different* user (email mismatch) and open the link | Rejected; nothing changes |
| E2.10 | Cashier sidebar | Only: POS, Orders (view), Payments (view), Customers (view), Kitchen (view), Tables (view). **No** Staff, Settings, Billing, Reports, Menu manage, Locations |
| E2.11 | Cashier types `/{org}/staff` and `/{org}/settings` URLs | Denied (403/redirect). Server Actions for invite/role change called directly are rejected |
| E2.12 | Cashier location switcher | Only Jakarta Selatan; Bandung URL/ID denied |
| E2.13 | Cashier API check with the cashier's JWT against PostgREST (`/rest/v1/staff_invitations`, `organization_members`, `roles`, insert/update) | Reads limited per matrix (§5); writes denied |
| E2.14 | Owner changes cashier to Waiter, then deactivates | Role change takes effect on next request (sidebar changes). Deactivated: loses all org access immediately, including active session (PROJECT §4.9) |
| E2.15 | Package limit: org on Starter with 5 staff, invite a 6th | Server rejects with `PLAN_LIMIT:max_staff`, UI shows upgrade prompt; also counts pending invites per spec |
| E2.16 | Role/permission change by Manager | Decided: manager can invite/manage manager, cashier, waiter, kitchen; cannot assign the owner role or touch an owner membership (UI and direct API) |

### M0-E3: another restaurant's user cannot read any of it

User: `owner@other.local` (org B) and a no-membership user, both against org A (Demo) data.

| Step | Action | Expected |
|---|---|---|
| E3.1 | Browse `/demo`, `/demo/staff`, `/demo/settings` | Not-found-style response, **identical** to a non-existent org (no enumeration) |
| E3.2 | Replace org/location/invitation/member IDs in URLs and Server Action payloads with org A's | Denied or not found; no data |
| E3.3 | PostgREST as org B user: select on every M0 table filtered by `organization_id=<A>` | 0 rows (not error that reveals existence) |
| E3.4 | PostgREST insert/update/delete on org A rows from org B | Denied / 0 rows affected; verify with service role that nothing changed |
| E3.5 | Insert into org B's table with `organization_id` = A | Rejected by RLS `with check` |
| E3.6 | Call RPCs with org A ids: `my_permissions(A)`, `has_permission(A,…)`, `admin_set_org_status`, `accept_invitation` with A's token | Empty / false / forbidden |
| E3.7 | `get_storefront('demo')` as anon | Only public info + branding + active locations; no member, invite, email-of-staff or billing data |
| E3.8 | Org B user sees profiles/emails of org A staff? | No |
| E3.9 | Realtime/Storage | n.a. in M0 (no realtime tables); note if any bucket exists |
| E3.10 | Run the full §5 matrix | All cells match |

## 4. Per-task test cases (MF-T01 … MF-T23)

Format: ID · what to check · expected. "Pass" requires the task's own acceptance criteria *and* the rows below.

### MF-T01: monorepo + Next.js scaffold (ADIT)
- M0-T01-1 Fresh clone: `pnpm install` then `typecheck`, `lint`, `test`, `build` succeed. Scripts exist in `apps/web/package.json` and root.
- M0-T01-2 `packages/db` exports the `Database` type and resolves from `apps/web` (typecheck imports it).
- M0-T01-3 `.env.example` matches CLAUDE.md env list; no real values; `.env*` ignored by git (`git ls-files | grep env`).
- M0-T01-4 Prettier/ESLint configured; Conventional Commits enforced or documented. TypeScript is 5.x and `strict` is on. `AGENTS.md` committed in `apps/web`.
- M0-T01-5 Layout matches CLAUDE.md tree (route groups); `middleware.ts` does **not** exist (it is `proxy.ts`).

### MF-T02: foundation migration (DAVIN)
- M0-T02-1 `supabase db reset` applies cleanly twice in a row.
- M0-T02-2 Every table in `public` has RLS enabled: `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity` returns 0 rows. No policy with `using (true)` on tenant tables.
- M0-T02-3 All tables in PLAN §4.2 exist with listed columns, `NOT NULL` + index on `organization_id`; slug check (3–40, `[a-z0-9-]`); status/role `check` constraints.
- M0-T02-4 Helper functions are `security definer`, `stable`, `search_path = ''`; internal helpers live in `private`, not exposed via API. `execute` revoked from `anon` where not intended.
- M0-T02-5 Policies use `(select auth.uid())`. Supabase advisors (security + performance) show no new warnings.
- M0-T02-6 Permission catalog = the 23 keys; default role permission sets match PLAN table exactly (Owner implicit; Manager = all except `billing.manage`, `settings.manage`, `locations.manage`; Cashier/Waiter/Kitchen as listed).
- M0-T02-7 `profiles` auto-created on `auth.users` insert; email sync on change; `updated_at` maintained.
- M0-T02-8 Isolation matrix §5 passes (pgTAP, MF-T25).

### MF-T03: staff_invitations + RPCs (DAVIN)
- M0-T03-1 `is_slug_available`: true/false correct; reserved, invalid, existing slugs false; callable by anon; no timing/enumeration beyond boolean.
- M0-T03-2 `create_organization`: see E1.8/E1.9/E1.11; unauthenticated caller denied; client cannot pick role, status, package outside public/default, or owner id; package code must be public + active.
- M0-T03-3 `accept_invitation`: rejects wrong email, expired, revoked, reused, unknown token, null token, token for deactivated-then-reinvited user; email compared case-insensitively against `auth.jwt()->>'email'`; succeeds once; creates membership + location_staff atomically; race: two parallel accepts → one membership.
- M0-T03-4 Existing member accepting a second invite to the same org does not duplicate membership or escalate silently (existing active member invite is rejected at invite time; accept path must also be safe).
- M0-T03-5 `get_storefront`: anon OK; suspended/read_only/unknown slug → same "unavailable/not found" shape per spec; only active locations; no emails/ids beyond what is public.
- M0-T03-6 `admin_set_org_status`: platform admin only (not org owner, not anon); reason required; writes audit log with admin id; invalid status rejected.
- M0-T03-7 Token hash only: raw token never in any table, log or audit metadata.

### MF-T04: integrity triggers (DAVIN)
- M0-T04-1 Limits: insert location/member/invitation at cap → error `PLAN_LIMIT:<key>`; below cap OK; Pro unlimited; changing package re-evaluates; `max_staff` counts active members + pending (unexpired, unrevoked) invitations; deactivated, expired and revoked do not count; accepting an invite at exactly the cap succeeds (no double count) while a new invite at the cap fails; failed attempt leaves no row.
- M0-T04-2 Last active owner cannot be deleted, deactivated or demoted (update role, update status, delete). Two owners → one can leave. Race: two owners demote each other concurrently → at least one active owner remains.
- M0-T04-3 System roles cannot be deleted/renamed; Owner role's permissions cannot be edited; custom roles can.
- M0-T04-4 Triggers also hold when called through service role (documented exception: none).
- M0-T04-5 Cannot move a member/role/location across organizations (cross-org FK integrity: `role_id` from org B on an org A member rejected; `location_staff` location from another org rejected).

### MF-T05: seed + generated types (DAVIN)
- M0-T05-1 `supabase db reset` loads seed with no errors; re-runnable.
- M0-T05-2 Users in §2 exist and can log in; roles correct; platform admin in `platform_admins`; Demo has 2 locations + branding; packages Starter/Growth/Pro published, Growth default, placeholder IDR prices.
- M0-T05-3 No production secrets, no real emails/domains, passwords documented in README only as local.
- M0-T05-4 `database.types.ts` regenerated equals committed (`supabase gen types … | diff`); `pnpm typecheck` passes.
- M0-T05-5 `demo` slug resolves to Demo org although reserved for new signups.

### MF-T06: env, Supabase clients, proxy (DAVIN)
- M0-T06-1 App fails fast with readable error when a required env var is missing/invalid. `NEXT_PUBLIC_` only for allowed vars.
- M0-T06-2 `lib/supabase/admin.ts` begins with `import 'server-only'`; build fails if imported in a client component (try in a scratch branch, do not commit). `grep -r "SUPABASE_SERVICE_ROLE_KEY\|ARCJET_KEY\|RESEND_API_KEY\|DOKU_SECRET\|APP_ENCRYPTION_KEY"` in `.next/static` after build → 0 hits.
- M0-T06-3 Proxy: host → surface mapping (`restomate.app` frontend, `app.` dashboard/admin, `{slug}.` storefront rewrite); unknown host handled; `/api/webhooks/doku` is skipped (no Arcjet, no session work). Test with `Host` header via curl.
- M0-T06-4 Proxy refreshes session but performs no authorization (an unauthenticated direct request to a protected page still gets denied by the page/DAL, not only proxy).
- M0-T06-5 Host header spoofing: `Host: evil.com`, `Host: app.restomate.app.evil.com`, `Host: demo.restomate.app:3000` do not reach the wrong tenant or cause open redirects.

### MF-T07: auth DAL (DAVIN)
- M0-T07-1 `getCurrentUser` returns null signed out; uses `getUser()`-grade verification, not an unverified cookie claim.
- M0-T07-2 `requirePermission(orgId, perm)`: owner passes any; each role passes exactly its permissions (table-driven unit test over 5 roles × 23 permissions); deactivated member fails; non-member fails; unknown permission string fails closed.
- M0-T07-3 `getMembership(orgSlug)`: derives org from slug + user, not from client input; non-member and non-existent slug produce the same result.
- M0-T07-4 `requirePlatformAdmin`: only users in `platform_admins`; not by email domain (`x@restomate.local` not in table → denied).
- M0-T07-5 Session read happens inside `<Suspense>` (build with Cache Components passes); cache keys/tags contain no email or token; cache is not shared across users (log in as A then B, no bleed).
- M0-T07-6 Permission change takes effect without a stale cached permission beyond the documented window.

### MF-T08: Arcjet + PostHog (DAVIN)
- M0-T08-1 Single shared instance in `lib/arcjet.ts`; rules: shield + bot + rate limit; signup preset validates email (disposable/invalid rejected). Behaviour with no `ARCJET_KEY` locally is defined (dry-run/log), never silently open in production config.
- M0-T08-2 Rate limit: N+1 rapid login/signup requests → 429 with friendly message, from one IP; other IP unaffected.
- M0-T08-3 PostHog: `events.ts` names are snake_case object_action; server capture sets `organization` group; no PII (email, name, phone) in any event or identify traits; disabled cleanly when key missing.

### MF-T09: money (DAVIN)
- M0-T09-1 Currency exponent IDR = 0, USD = 2; amounts are integers (`bigint`/safe integer), no float math; non-integer input rejected.
- M0-T09-2 Format `Rp 25.000` (id-ID separators), `Rp 0`, negative, large (≥ 1.000.000.000). Never `Rp 25.000,00`.
- M0-T09-3 Tax + service charge table-driven cases (bps): service first, then tax on subtotal+service (default); `tax_on_service_charge=false` → tax on subtotal only. Examples: subtotal 100000, svc 500 bps, tax 1000 bps → svc 5000, tax 10500, total 115500. Rounding at .5 boundaries (e.g. 12345 × 10% → defined rule), 0 bps, 10000 bps, subtotal 0, subtotal 1.
- M0-T09-4 Rounding is done once, in the module; sum of parts equals total (no 1-rupiah drift) for 1,000 random subtotals (property test).

### MF-T10: DOKU signature (DAVIN)
- M0-T10-1 Digest = base64(sha256(rawBody)); omitted for GET. Component string order/newlines exactly per CLAUDE.md; `Signature = "HMACSHA256=" + base64(hmac)`.
- M0-T10-2 Matches DOKU's documented example vector. DAVIN requests docs.doku.com access at MF-T10. A self-computed vector is temporary only and is not final proof; keep the case open until the documented vector is used.
- M0-T10-3 Verification: valid → true; any change in body (1 byte), path, Client-Id, Request-Id, timestamp, or signature → false; wrong secret → false; missing headers → false (no throw).
- M0-T10-4 Constant-time compare (`timingSafeEqual`), handles different-length signatures without throwing.
- M0-T10-5 Uses raw body string, not re-serialised JSON (whitespace/key-order variants fail).
- M0-T10-6 Timestamp skew policy is defined and tested (if none is specified, record as a finding). No secret in logs/test output.

### MF-T11: StaffInvite template (ADIT)
- M0-T11-1 Renders with typed props (restaurant name, inviter, role, accept URL, expiry); preview in React Email dev server; HTML + plain text.
- M0-T11-2 Escapes props (restaurant name `<script>`, `"` , emoji, long name) with no HTML injection; accept URL only comes from props.
- M0-T11-3 Branding: org colors/logo when present, sane fallback when absent; contrast ok; renders at 400px; dark-mode safe.
- M0-T11-4 No tracking pixels or third-party assets beyond what is specified.

### MF-T12: lib/email (DAVIN)
- M0-T12-1 `import 'server-only'`; not importable from a client component.
- M0-T12-2 `EMAIL_DELIVERY=log` prints, does not call Resend; `resend` mode passes an idempotency key (e.g. `staff-invite/{invitationId}`); retrying the same send does not create a second email.
- M0-T12-3 Sender `"{Restaurant} via Restomate" <…@mail.restomate.app>`, `reply_to` is restaurant contact email; recipient exactly the invitee.
- M0-T12-4 Send failure (Resend 4xx/5xx/network) is logged, does not throw into the calling action, and a manual resend is possible. Logs contain no API key and no raw invite token.
- M0-T12-5 One function per email type with typed props; no ad-hoc HTML strings.

### MF-T13: auth Server Actions + /auth/confirm (DAVIN)
- M0-T13-1 Signup/login/logout/forgot/reset actions validate input with Zod; weak password, bad email, huge input (10 KB) rejected cleanly.
- M0-T13-2 Login error is identical for unknown email vs wrong password (no enumeration); signup with an already-registered email does not reveal that (or follows Supabase's configured behaviour; record which). Forgot password responds identically for known/unknown emails.
- M0-T13-3 `/auth/confirm`: valid `token_hash` → session + redirect to `next`. **Open redirect**: `next=https://evil.com`, `//evil.com`, `/\evil.com`, `javascript:`, encoded variants → ignored, fallback to a safe default. Missing/invalid/expired/reused token → error page, no session.
- M0-T13-4 Sign out clears cookies server-side and invalidates the session (old refresh token no longer works).
- M0-T13-5 Cookies are `HttpOnly`, `Secure` (in prod), `SameSite=Lax`.
- M0-T13-6 Arcjet applied on these actions (see T08-2).
- M0-T13-7 Password reset: link single-use; after reset, record whether other sessions are invalidated (not specified; report as observation).

### MF-T14: auth pages (ADIT)
- M0-T14-1 Login, signup, forgot, reset pages render; all states: loading (pending button, double-submit blocked), field errors, server error, success.
- M0-T14-2 Mobile 400px: no horizontal scroll; inputs ≥ 16px font (no iOS zoom); touch targets ≥ 44px.
- M0-T14-3 Keyboard: tab order, Enter submits, visible focus, labels associated, errors announced (`aria-live`/`aria-describedby`); password show/hide is a button with a label; autocomplete attributes (`email`, `current-password`, `new-password`).
- M0-T14-4 Signed-in user visiting `/login` is redirected; `next` param honoured only if safe.
- M0-T14-5 Sign-out button works from the shell.

### MF-T15: onboarding actions (DAVIN)
- M0-T15-1 `checkSlug`: Zod-validated, rate limited, returns only available/unavailable + reason class; no org names leaked.
- M0-T15-2 `createOrganization`: requires session + confirmed email; ignores any client `organization_id`, role, status, package price/limits; rejects invalid timezone (not an IANA name), currency not in allowed list, tax bps out of range; maps `PLAN_LIMIT`/slug-taken to friendly errors; calls the single RPC (no multi-call sequence that can half-create).
- M0-T15-3 Cache invalidation (`updateTag`) so the new org shows up in the user's org list immediately; no stale redirect to 404.
- M0-T15-4 PostHog events from the action (E1.12).

### MF-T16: onboarding wizard UI (ADIT)
- M0-T16-1 Three steps with progress, back/next preserve entered values; refresh mid-way behaviour defined (draft kept or restart, no crash).
- M0-T16-2 Slug field: lowercases/sanitises, debounced live check, loading state, race-safe (older response does not override newer).
- M0-T16-3 Step 3 skippable; logo upload limits (type, size ≤ limit, SVG sanitised or rejected); colors validated hex; contrast warning if present.
- M0-T16-4 Submit shows pending state, prevents double submit, shows server errors on the right field; success redirect to `/{slug}`.
- M0-T16-5 Mobile + keyboard + screen-reader basics (as T14-2/3). IDR and Asia/Jakarta preselected; timezone list usable.
- M0-T16-6 Whole flow ≤ 5 minutes by a human (PROJECT §5.2); measured once manually.

### MF-T17: staff actions + data (DAVIN)
- M0-T17-1 Every action begins with `requirePermission(orgId,'staff.manage')`; cashier/waiter/kitchen calling invite/resend/revoke/role/deactivate directly (curl/Server Action replay) → forbidden.
- M0-T17-2 Invite: Zod-validated email, role must belong to **this** org, location ids must belong to this org (org-B location id → rejected); raw token generated server-side with ≥128 bits entropy, only SHA-256 stored; link built from `NEXT_PUBLIC_APP_URL`, not from request `Host`.
- M0-T17-3 Resend rotates token, resets expiry, invalidates old link; revoke sets `revoked_at` and link fails; accepted invitation cannot be resent/revoked.
- M0-T17-4 Role change/deactivate: last-owner protection surfaces as a friendly error; manager cannot touch owner; user cannot change own role to higher; deactivate kills sessions (verify an existing session's next request fails).
- M0-T17-5 Everything audited in `audit_logs` with actor + timestamp, org-scoped; audit metadata contains no token/email body beyond need.
- M0-T17-6 Email send failure does not roll back or hang the invite action; error shown, manual resend works.
- M0-T17-7 `accept` action: see T03-3 plus session email must match; redirects only to the invited org.

### MF-T18: admin shell (ADIT)
- M0-T18-1 `[org]` layout does not `await` session/params at top level (build passes; no `instant=false` unless logged in PLAN §14).
- M0-T18-2 Sidebar from `my_permissions`: for each of 5 roles the visible items equal the role table (snapshot test). Hidden ≠ protected: each hidden route returns 403/redirect when typed.
- M0-T18-3 Location switcher lists only accessible locations; switching persists; URL with inaccessible location denied.
- M0-T18-4 Home checklist renders; empty/loading/error states; locked-feature state for features missing from the package (and server-side blocked).
- M0-T18-5 Suspended org (decided): members see only a "suspended" notice page with no dashboard data; DB level `has_permission()` is false and tenant reads are blocked except the org's own `organizations` row (name/status); storefront shows "temporarily unavailable". `read_only`/`past_due` are M6, not tested.
- M0-T18-6 Mobile nav usable at 400px; skip link, landmarks, focus management.
- M0-T18-7 Unknown org slug and org the user doesn't belong to → identical not-found.

### MF-T19: staff pages + /invite/[token] (ADIT)
- M0-T19-1 Staff list shows members + pending invites; empty state; gated by `staff.manage` (cashier gets denied page).
- M0-T19-2 Invite form validation, pending state, duplicate-email message, limit-reached upgrade prompt, success toast; role dropdown contains only system roles available.
- M0-T19-3 Resend/revoke/role change/deactivate each with confirmation, loading and error states; last-owner error readable; owner row has no destructive actions for the sole owner.
- M0-T19-4 `/invite/[token]`: valid → sign-in/sign-up flow keeping the token (not leaked in `Referer`, analytics or logs; page sets `Referrer-Policy: no-referrer`, `noindex`); invalid/expired/used → same generic message; mismatched account → clear instruction to switch account.
- M0-T19-5 Mobile + keyboard basics.

### MF-T20: public data helpers (DAVIN)
- M0-T20-1 `getPublicPackages`: only `is_active` and `is_public`; archived/private plans never returned; sorted; prices from DB (change DB price → pricing updates after cache tag refresh).
- M0-T20-2 `getStorefront`: delegates to `get_storefront`; suspended/unknown → unavailable; no private fields in returned object (assert shape); cached safely (no per-user data).
- M0-T20-3 No service-role usage where an anon call suffices.

### MF-T21: frontend shell + storefront placeholder (ADIT)
- M0-T21-1 Home and pricing render logged out; pricing equals active public packages (limits + features) and shows no hard-coded price; empty-packages state; demo link goes to Demo Restaurant.
- M0-T21-2 `{slug}.restomate.app` placeholder (use `demo.localhost` or Host header): branded by `org_branding` CSS variables (no per-tenant code branch); unknown slug → 404; suspended → "temporarily unavailable" (no org data).
- M0-T21-3 Mobile 400px; Lighthouse mobile baseline recorded (target ≥ 90 for storefront; not blocking in M0); meta tags; storefront of suspended org not indexed.
- M0-T21-4 Branding values cannot inject CSS/JS (try `red;} body{display:none` as a color via DB; must be sanitised or validated).

### MF-T22: super admin data + actions (DAVIN)
- M0-T22-1 `listTenants`/`setOrgStatus` begin with `requirePlatformAdmin()`; org owner, anon, and non-admin users denied (direct Server Action replay).
- M0-T22-2 Search + status filter + pagination: SQL-injection-ish input (`%`, `'`, `_`) handled; large list performance acceptable.
- M0-T22-3 `setOrgStatus`: reason required; audit entry has admin id (org-scoped + platform view); effect: suspended org → members blocked, storefront unavailable; reactivate restores. Invalid status rejected.
- M0-T22-4 Service-role client used only server-side; every write audited.

### MF-T23: super admin shell (ADIT)
- M0-T23-1 `/admin` guard: anon → login; non-admin signed in → not-found/forbidden (no hint admin exists); admin → tenants list.
- M0-T23-2 Tenants list: search, status badge, plan, signup date; empty/loading/error; suspend/reactivate with confirm dialog + reason; list updates after action.
- M0-T23-3 `noindex` meta + `X-Robots-Tag` on `/admin/*`; excluded from sitemap; Arcjet rate limiting applied.
- M0-T23-4 Org owner opening `/admin` gets same response as a stranger.
- M0-T23-5 Admin chrome never appears in restaurant admin and vice versa (surface separation).

### QA tasks (MF-T24 … MF-T32): self-checks
- M0-T25 pgTAP suite implements §5 completely; each table has ≥ 1 positive and ≥ 1 negative test per cell class; suite fails when a policy is dropped (mutation spot check).
- M0-T26 Abuse tests cover §3 E2/E3 and T03/T04 items.
- M0-T27 CI runs lint, typecheck, unit, `db reset` + `test db`, build; fails on any; no secrets in workflow.
- M0-T28…31 Playwright specs map 1:1 to E1/E2/E3 cases above; deterministic (fresh `db reset`, unique emails per run, Mailpit API for emails).
- M0-T32 Sign-off report lists all case IDs with result.

## 5. Isolation matrix

Applies to every table in PLAN §4.2 plus `staff_invitations` (17 tables). Drives MF-T25 (cross-tenant/role matrix) and MF-T26 (abuse cases).

**Actors**: `anon` · `authN` (signed in, no membership) · `B-any` (member of org B, any role, targeting org A rows) · A-`cashier` · A-`waiter` · A-`kitchen` · A-`manager` · A-`owner` · A-`deact` (deactivated member of A) · `padmin` (platform admin).
**Cell**: allowed operations among **S**elect / **I**nsert / **U**pdate / **D**elete on **org A** rows (or global rows). `-` = none. `own` = only the caller's own row. `loc` = limited to locations the member is assigned to. Every denied cell must be tested and must give 0 rows / permission error and **leave data unchanged** (verify with service role). Denied reads must return 0 rows, not an error that reveals existence.

| Table | anon | authN | B-any | cashier | waiter | kitchen | manager | owner | deact | padmin |
|---|---|---|---|---|---|---|---|---|---|---|
| `profiles` | - | S,U own | S,U own | S,U own | S,U own | S,U own | S co-members; U own | S co-members; U own | S,U own | S |
| `platform_admins` | - | - | - | - | - | - | - | - | - | S own |
| `packages` | S public+active | S public+active | S public+active | same | same | same | S own plan too | S own plan too | S public | SIUD |
| `organizations` | - | - | S own org B only | S | S | S | S | S,U (name/contact only; not slug/status) | - | S (U only via `admin_set_org_status`) |
| `reserved_slugs` | - | S | S | S | S | S | S | S | S | S (writes: service role only) |
| `subscriptions` | - | - | - | - | - | - | - | S | - | S |
| `locations` | - | - | - | S loc | S loc | S loc | S (all if `all_locations`); no IUD | S,I,U (D soft only) | - | S |
| `permissions` | - | S | S | S | S | S | S | S | - | S |
| `default_role_permissions` | - | S | S | S | S | S | S | S | - | S |
| `roles` | - | - | - | S | S | S | S | S,I,U,D (non-system) | - | S |
| `role_permissions` | - | - | - | S | S | S | S | S,I,U,D (never owner role) | - | S |
| `organization_members` | - | - | - | S own | S own | S own | S all; U non-owner | S all; U (last-owner guard) | - | S |
| `location_staff` | - | - | - | S own | S own | S own | S,I,U,D (non-owner) | S,I,U,D | - | S |
| `staff_invitations` | - | - | - | - | - | - | S,I,U (revoke) | S,I,U (revoke) | - | S |
| `org_branding` | - | - | - | S | S | S | S,U | S,U | - | S |
| `audit_logs` | - | - | - | - | - | - | - | S | - | S (incl. org null) |
| `platform_settings` | - | - | - | - | - | - | - | - | - | - (read only inside definer functions; writes service role; audited admin function arrives in M1) |

Rules that apply to **all** rows:
1. **I/U/D on every table is `-` for anon, authN, B-any and deact**, without exception. No table is writable by org members' direct `organization_id` choice: inserts with a foreign `organization_id` are rejected by `with check`.
2. Nobody except the service role writes: `platform_admins`, `reserved_slugs`, `permissions`, `default_role_permissions`, `platform_settings` (no client access at all in M0), `audit_logs` (written by `private.write_audit` only; no client I/U/D, including owner and padmin).
3. `organization_members` and `organizations` have no direct client **I**/**D**: creation only through `create_organization` / `accept_invitation`; removal = deactivate.
4. `staff_invitations.token_hash` must not be selectable by any client role (column privilege or view). Test `select token_hash` as owner → error/empty.
5. Cashier/waiter/kitchen/manager cannot escalate: update own `organization_members.role_id`/`status`/`all_locations` → denied; insert a membership for self → denied; update `role_permissions` → denied.
6. Deactivated member: all org-scoped reads return 0 rows immediately, with the old JWT still valid.
7. Manager may not touch owner membership or assign the owner role (decided); manager never has `billing.manage`, `settings.manage`, `locations.manage` (locations I/U denied, subscriptions S denied).
8. Cross-org FK integrity: a row in org A cannot reference an org B role/location/member (see T04-5).
9. Anon `execute` on RPCs: only `is_slug_available` and `get_storefront`. All others (`create_organization`, `accept_invitation`, `admin_set_org_status`, `my_permissions`, helpers) are denied for anon. `private` schema functions not callable via API.
10. Suspended org A: for every actor `has_permission(A,…)` is false and tenant reads return 0 rows, except the org's own `organizations` row (name/status) for members.
11. User in two orgs (A and B): every query is scoped per org; rights in B do not leak into A.

Function/RPC matrix (each × same actors): `is_platform_admin` (true only padmin), `is_org_member(A)` (true only active A members), `has_permission(A,p)` (per role table; false for deact/non-member/unknown p), `has_location_access(loc)` (assigned or `all_locations` only), `my_permissions(A)` (own perms; empty for non-member, never another user's), `create_organization` (authenticated + confirmed only), `accept_invitation` (see T03-3), `admin_set_org_status` (padmin only), `get_storefront` (anon OK, active only).

## 6. Quality checklist (applied to every UI PR)

- Loading, empty, error states present and sensible.
- Mobile width ~400px: no horizontal scroll, touch targets ≥ 44px (POS/KDS larger from M3).
- Keyboard: logical tab order, visible focus, Esc closes dialogs, no keyboard traps; form labels and error association; contrast AA.
- Rupiah formatting `Rp 25.000`; no floats; dates shown in the location's timezone.
- No console errors/warnings on the happy path; no failed network requests; no hydration warnings.
- Navigation: back button and refresh behave; stale tab after sign-out is handled.
- Cache Components: no session read outside Suspense (build passes); no cross-user data after switching accounts in the same browser.

## 7. Security checklist (run on every PR; mirrors ALAN's reject list)

Reject / FAIL if any is true:
1. [ ] **New table without RLS or without a cross-tenant pgTAP test** (and its policies in the same migration).
2. [ ] **Price, total, `organization_id`, role or permission taken from the client** instead of derived server-side.
3. [ ] **Authorization only in the UI** (or only in `proxy.ts`): every Server Action / route handler calls `requirePermission` / `requirePlatformAdmin`, and RLS backs it. Test by calling the action/endpoint directly.
4. [ ] **Session / cookies / headers read outside `<Suspense>`** or top-level `await` of session/params in a layout; unexplained `instant = false` (must be logged in PLAN §14).
5. [ ] **A secret that could reach the browser**: non-`NEXT_PUBLIC_` var used in client code; service-role client without `server-only`; secrets in `.next/static`, page source, network responses, logs, or committed files (`git grep -nE "(sk_|re_[A-Za-z0-9]{10,}|service_role|SECRET)"`, check `.env*` not tracked).
6. [ ] **Money stored or computed as float** (`number` with decimals, `numeric` for amounts, `parseFloat`, `toFixed` for math).

Also check:
7. [ ] **Open redirects**: every `next`/`redirect`/`returnTo` param accepts only same-origin relative paths (try `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:`, encoded forms).
8. [ ] **Enumeration**: login, signup, forgot password, slug check, invite link, `/org/slug`, super admin URL give the same response for "exists but not yours" and "does not exist".
9. [ ] **PII to PostHog**: no email, name, phone, token, address in events/identify/group properties (inspect captured payloads).
10. [ ] **Tokens**: invitation token only as SHA-256 hash in DB; not in logs, audit metadata, analytics, `Referer`, or cache keys/tags.
11. [ ] **Input validation**: Zod at every Server Action / route handler boundary; oversized and malformed input rejected.
12. [ ] **Package limits** enforced on the server (trigger or action), not only UI.
13. [ ] **Suspended org** blocked as specified (members, storefront, writes).
14. [ ] **Service-role usage** scoped by tenant explicitly and only in allowed places (webhooks, jobs, storefront intake, super admin).
15. [ ] **Audit**: sensitive actions recorded with actor + timestamp; super admin writes always.
16. [ ] **Email**: correct recipient only, correct branding, one send per retry (idempotency), no raw tokens in logs.
17. [ ] **Headers/cookies**: `HttpOnly`/`Secure`/`SameSite`; `noindex` on admin and invite pages; no secrets in error pages or stack traces in production mode.
18. [ ] **Arcjet** on auth routes and public RPC-calling endpoints; `/api/webhooks/doku` excluded from bot/rate-limit.
19. [ ] Conventional Commit titles; PR touches only files listed in the task.

Any data leak, permission bypass or payment error is **S1**: message ALAN immediately and stop sign-off.

## 8. Reporting

- Bugs: `docs/qa/BUG_TEMPLATE.md` (severity S1–S4 as defined there).
- PR verdicts: `docs/qa/PR_REPORT_TEMPLATE.md`.
- Milestone: MF-T32 produces the M0 exit sign-off listing every case ID above with pass/fail and open bugs.

## 9. Decisions from ALAN (were open questions)

1. Seed: `manager@demo.local` is seeded. Org B is Other Bistro (`other-bistro`), owner `owner@other.local`.
2. Reads: `subscriptions` and `audit_logs`: owner of that org + platform admin only (manager none); no client I/U/D on `audit_logs` for anyone. `platform_settings`: no client access in M0. `permissions` and `default_role_permissions`: select for any authenticated user, none for anon. `reserved_slugs`: select for authenticated, writes service role only.
3. Manager (has `staff.manage`) manages manager/cashier/waiter/kitchen only; cannot assign the owner role or touch an owner membership. Custom roles: owner only at DB level, no UI in M0.
4. `max_staff` counts active members + pending invitations; deactivated do not count; accepting at exactly the cap succeeds.
5. Suspended org behaviour as in M0-T18-5 and matrix rule 10.
6. Duplicate pending invite is rejected ("Already invited, use Resend"); inviting an existing active member is rejected.
7. DOKU vector: see M0-T10-2.
8. Every dev PR description must include its task's acceptance criteria and QA focus (list_tasks shows titles only). Per-task cases in §4 are updated from those when a PR arrives.
