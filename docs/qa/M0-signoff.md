# M0 exit sign-off (MF-T32)

Owner: REYKI · Date: 2026-11-09 · Commit under test: `fd7303d` (main) · Sources: `docs/PLAN.md` §4.10, `docs/qa/M0-test-plan.md`, `CLAUDE.md`.

## Verdict

**M0 exit criteria: PASS**, with the gaps listed under "What was not tested". No open S1 or S2 bugs. Two S3 and two S4 findings are open (none block M0).

Honest scope note: the three exit criteria are verified by Playwright e2e and pgTAP (CI, green on main). I did **not** do a separate hand-driven browser walkthrough: the sandbox dev server was too slow for it (see "What was not tested"). My local Playwright reruns were not clean for that same reason, so the e2e evidence below is the CI run, not my sandbox.

## 1. PLAN §4.10 criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 4.10.1 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | **PASS** | Fresh clone of main at `ccecd6d`, all exit 0: typecheck 2/2 tasks, lint 1/1, unit tests **487 passed (37 files)**, build OK (CI env with fake `NEXT_PUBLIC_*`). CI "Lint, typecheck, unit tests, build" success on `fd7303d`. |
| 4.10.2 | `supabase db reset` + `supabase test db` | **PASS** | Fresh clone: reset applied all migrations incl. `venue_schema` and seed; pgTAP **20 files, 1357 tests, Result: PASS**. CI "Supabase db reset + pgTAP" success on `fd7303d`. |
| 4.10.3 | Walkthrough of the exit criteria in a browser | **PASS via e2e** (no manual walk, see below) | Latest green CI on main: https://github.com/Alan-Alkalifa/Restomate/actions/runs/42635603974 (`fd7303d`): Playwright **140 passed**, all three CI jobs success. |

### M0 exit criteria (PLAN §4 exit) and their specs

| Exit criterion | Result | Spec / test evidence |
|---|---|---|
| 1. Sign up, confirm email (Mailpit), create a restaurant with one location | **PASS** | `e2e/auth.spec.ts` (signup → Mailpit → confirm link → `/onboarding`, spent link → `link_expired`, login/sign-out, reset), `e2e/onboarding.spec.ts` (wizard, slug taken in another tab → no half tenant). pgTAP RPC suite `060_rpcs` (not read line by line for atomicity; relies on the e2e "no half tenant" case). Merged via MF-T28 #64, MF-T29 #65. |
| 2. Invite a Cashier; invitee accepts and sees only cashier things | **PASS** | `e2e/staff.spec.ts` "Cashier lifecycle (exit criterion 2)", "invitation links" (resend kills old link; revoke/expiry/garbage show one generic page; different signed-in user), "analytics" (invite token never reaches PostHog). pgTAP `050_staff_invitations`, `070_invitation_hardening`. MF-T30 #68. |
| 3. Another restaurant's user cannot read any of it | **PASS** | `e2e/isolation.spec.ts` (org B / no-membership user vs org A via UI, URL IDs, PostgREST). pgTAP isolation suite (20 files; matrix across org/location/role/invitation/branding tables). |

Surfaces (not an exit criterion but in §4.9): `e2e/surfaces.spec.ts` covers super admin guard (404 for non-admin on every `/admin` page), tenants list, suspend/reactivate with audit row and storefront "unavailable" + noindex, pricing from `packages`. MF-T31 #85.

## 2. Secret scan (client bundle)

`apps/web/.next/static` of the fresh build (38 files):

- No occurrences of `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `DOKU_SECRET_KEY`, `APP_ENCRYPTION_KEY`, `service_role`: **0 hits**.
- No Resend (`re_...`), Stripe-style, or JWT-shaped secrets; local service-role JWT payload and `sb_secret_` prefix: **0 hits**.
- The actual values of the four server secrets present in the sandbox environment: **absent** from the bundle.

**PASS.** Caveat: the build used fake `NEXT_PUBLIC_*` values (same as CI), so this proves no server secret is bundled, not that the deployed public values are right.

## 3. Reject-list re-check

| Rule | Result | How checked |
|---|---|---|
| Every public table has RLS | **PASS** | `pg_class.relrowsecurity` query: 0 tables without RLS (19 tables). |
| No `using (true)` on tenant data | **PASS** | Only `reserved_slugs`, `permissions`, `default_role_permissions` (reference data, SELECT only). |
| Every public table has a cross-tenant test | **FAIL (S3)** | `areas` is not referenced by any isolation test (BUG-M0-01). the word `tables` matches two files but I did not verify a table-level cross-tenant case. Tracked by MVM-T02. |
| No client-supplied prices/totals/`organization_id`/roles | **PASS** | Grep of `formData.get(organization_id/org_id/...)`: none. Server actions derive org from route + membership (also covered by e2e). Not an exhaustive audit. |
| Admin client is server-only | **PASS** | `lib/supabase/admin.ts` starts with `import "server-only"`; it is the only file that creates the admin client. |
| No money floats | **PASS** | Grep for `parseFloat`/`toFixed`/`Number(price...)`: only `Number(divRound(BigInt...))` in `lib/money.ts` (BigInt math). |
| No session read outside `<Suspense>` | **PASS (build)** | `pnpm build` succeeds with Cache Components on (this would be a build error). See BUG-M0-03 for dev-server noise. |
| `instant = false` uses all listed in PLAN | **PASS** | No `instant = false` in the codebase; PLAN §14 list says "None yet". |

## 4. Live Arcjet check

Setup: production build (`next build` + `next start`) with the **real sandbox `ARCJET_KEY`**, local Supabase, fake DOKU/Resend values (production env validation requires them). Driven with curl against the login server action (`/login`, multipart replay of the form fields). Mode is LIVE because `NODE_ENV=production`.

Setup caveat: on loopback Arcjet could not read a client IP ("ip value was empty", fingerprint failed, request failed open, as designed). I set `ARCJET_ENV=development` for the test, which makes Arcjet use `127.0.0.1` for every request (it ignores `X-Forwarded-For`), so all test requests shared one rate-limit key.

| Check | Result | Evidence |
|---|---|---|
| Rate limit (`ajAuth`, 10 per 1 min) | **PASS** | Clean window, browser-like headers, 12 login attempts: attempts 1-10 reached the credential check ("Invalid email or password"), **11 and 12 denied** ("Too many attempts"). Exactly the configured limit. |
| Bot detection | **PASS (with caveat)** | `curl/8.5.0` user agent was denied on its first request in a fresh window. The same requests with a spoofed browser user agent but minimal headers were also denied; with a full set of browser headers (sec-ch-ua, Sec-Fetch-*, Accept-Language) they were allowed. Caveat: the UI shows one message for every denial reason (see BUG-M0-02), so I inferred "bot" from timing/order, not from a reason code. |
| Fail-open without client IP | **Observed** | Missing IP: Arcjet errors and the request is allowed. Matches the documented design. Not a bug, but note for deployment: the host must supply the client IP (Vercel does). |
| Shield | **Not isolated** | Proxy shield is on for public/auth paths, but I did not send an attack payload. No false positives on normal page loads. |
| Disposable-email rejection on signup | **Not tested live** | Local known-provider list is covered by unit tests (`lib/arcjet.test.ts`). Arcjet's own DISPOSABLE/NO_MX lookup is documented best-effort (B1-T07) and I did not retest it. |
| `/api/webhooks/doku` excluded | **Not applicable in M0** | Route excluded in `proxy.ts` matcher (unit test `proxy.test.ts`); route itself arrives in M5. |

## 5. What was not tested

- **Manual browser walkthrough** of the exit criteria on desktop and tablet viewports (planned in MF-T32). The sandbox dev server needs ~24 s for a cold route compile and dropped connections (`ECONNRESET`) under the e2e specs, so hand-driving was impractical. Coverage is the 140 CI e2e tests (Chromium desktop + Pixel 7 "mobile" project), not a human pass.
- **Local Playwright rerun in my sandbox.** Three attempts failed on timeouts caused by the slow server and, once, by sandbox env vars (`DOKU_ENV`, `APP_ENCRYPTION_KEY` set to invalid values made the after-response invite mail throw an env error). I stopped and relied on CI. I did not rerun the failing specs individually, so I can't say they are free of a real flake; CI passed them (one earlier main run, `42620520973`, failed only because the Mailpit container could not start: infrastructure, not a test).
- Arcjet: shield payloads, disposable-email via the Arcjet service, behaviour behind a real proxy/CDN with real client IPs.
- Real email delivery (Resend) and Supabase SMTP: e2e uses a Resend mock and Mailpit.
- Real Supabase project (hosted): all testing was against the local stack. The sandbox's hosted Supabase URL was deliberately not used.
- WebKit/Firefox spot checks, screen-reader/keyboard audit, Lighthouse (no customer site yet), Realtime/Storage (no M0 tables use them).
- Supabase advisors (security/performance) were not run in this task.
- Package-limit enforcement on the server was checked only to the extent the pgTAP/e2e suites cover it.

## 6. Open bugs

| ID | Severity | Title | Details |
|---|---|---|---|
| BUG-M0-01 | **S3** | No cross-tenant isolation test for `areas` (and thin coverage for `tables`) | `venue_schema` migration is on main; `grep -w areas supabase/tests/isolation/*.sql` finds nothing. CLAUDE.md requires a cross-tenant test per new table. RLS itself is enabled. Repro: grep as above. Owner: REYKI to close in MVM-T02. |
| BUG-M0-02 | **S4** | Login/signup show "Too many attempts" for every Arcjet denial, including bot and shield | `lib/auth/actions.ts` maps all reasons except `EMAIL_INVALID` to the rate-limit message. A blocked bot or shield hit looks like a rate limit and is hard to diagnose. Expected: distinct (or at least logged) reason. Role: anonymous. |
| BUG-M0-03 | **S4** | Dev server logs `Date.now()` prerender and `instant` validation errors on `/admin/*`, `/[org]/staff`, `/[org]/[location]/[section]` | Seen in `next dev` while specs ran: "Route ... encountered the unstable value `Date.now()` while prerendering" (about 170 lines) and "Could not validate `instant` ... NEXT_REDIRECT". `pnpm build` and CI pass, so I treat it as dev-only noise, but it may hide real errors and may indicate time reads (`lib/staff/data.ts`, `lib/staff/actions.ts`) outside a cached/dynamic boundary. Needs DAVIN/ADIT triage. Not reproduced in a production build. |
| BUG-M0-04 | **S3** | Env validation failure inside `after()` is swallowed as a log line: invite mail is silently not sent | With an invalid `DOKU_ENV`/`APP_ENCRYPTION_KEY` present, `inviteStaff` returns success but `sendStaffInvite` throws in `after()` (`safeAcceptUrl` reads `serverEnv`, which validates all vars). The owner sees the invite created and no mail; the plan says failures should be logged and allow manual resend, which exists, so severity is S3. Suggest the email path should not depend on unrelated vars (DOKU, encryption). Repro: start the app with `DOKU_ENV=bogus`, invite a staff member as owner. |

No S1 or S2 bugs found. No data leak, permission bypass or payment error observed.

## 7. Recommendation

Tick M0 in PLAN.md. Carry BUG-M0-01 into MVM-T02, and queue BUG-M0-03/04 for DAVIN/ADIT triage in M1.
