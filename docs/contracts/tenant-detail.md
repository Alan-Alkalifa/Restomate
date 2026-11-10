# Contract: `lib/admin` tenant detail (M1 §5, MSS-T05)

Drafted 2026-11-09 by **DAVIN** for review by ALAN. **DAVIN** implements it (MSS-T05, branch `feat/mss-tenant-detail`). **ADIT** builds the page in a follow-up task. This file merges first, as its own Markdown-only PR. Changes need agreement from both, plus ALAN, and are made here first.

## Surface and binding

- Route: `app/(superadmin)/admin/tenants/[orgId]/`. Platform admins only.
- `getTenantDetail` is a data function. `sendOwnerPasswordReset` is a form action (`useActionState` shape). `ActionResult` is from `@/lib/auth/schemas`.
- Import the action **directly** from `@/lib/admin/tenant-actions` (a `'use server'` file exports async functions only). Types and constants live in `@/lib/admin/tenant-detail-types` (no `server-only`, safe in client components). The data function lives in `@/lib/admin/tenant-detail` (`server-only`).
- Both call `requirePlatformAdmin()` first. A non-admin gets `notFound()`, same as the other admin pages. The SQL re-checks `is_platform_admin()` and raises `FORBIDDEN` (`42501`).
- `orgId` is a uuid taken from the route. A value that is not a uuid, or an org that does not exist, makes `getTenantDetail` return `null` (the page calls `notFound()`).
- The tenant's own permissions do not apply here. A platform admin reads any organization, including suspended ones.

## Schema

No new tables. Two new `security definer` functions (`search_path = ''`, `execute` granted to `authenticated` only, each re-checks `is_platform_admin()`):

| RPC | Returns | Notes |
|---|---|---|
| `admin_get_tenant_detail(org_id uuid)` | `jsonb`, or `null` when the org does not exist | One round trip, one snapshot, so the counts agree with each other. Read-only |
| `admin_prepare_owner_password_reset(org_id uuid, user_id uuid)` | `text` (the owner's email) | See *Password reset*. Writes the audit row. Not callable by anything but the platform admin |

### Usage definitions (the same as the plan-limit triggers)

`usage` must count exactly what the triggers in `20261108040000_foundation_triggers.sql` and `20261109000000_venue_schema.sql` count. pgTAP proves it by moving each counter and then hitting the limit.

| Key | Count |
|---|---|
| `max_locations` | `locations` of the org where `is_active` |
| `max_staff` | `private.staff_count(org, null, null)`: **active** members (`organization_members.status = 'active'`) **plus pending invitations** (not accepted, not revoked, not expired). The function is reused, not re-implemented. A deactivated member is not counted |
| `max_tables` | `tables` of the org where `is_active` |
| `max_orders_per_month` | **Always `0` until M3** creates orders. The field exists so the UI does not change later. The UI should show it as "—" or "Not tracked yet" rather than "0 of N" |

`limit` comes from `private.org_limit`, the function the triggers call: the package limit of the org's live subscription (`trialing`, `active`, `past_due`), `null` = unlimited. An org with **no live subscription** has `limit: 0` for every key, because the triggers refuse every new location, member, invitation and table in that case. The UI should show it as "no plan" rather than "0 allowed".

## `apps/web/lib/admin/tenant-detail-types.ts` (shared, no `server-only`)

```ts
export const TENANT_LIMIT_KEYS = ["max_locations", "max_staff", "max_tables", "max_orders_per_month"] as const;
export type TenantLimitKey = (typeof TENANT_LIMIT_KEYS)[number]; // same keys as package-schemas LIMIT_KEYS; kept here so this file has no dependency on the packages PR

export type TenantDetail = {
  org: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended" | "past_due" | "read_only";
    createdAt: string;                 // ISO
  };
  locations: { id: string; name: string; timezone: string; currency: string; isActive: boolean }[]; // all, active first, then by name
  subscription: TenantSubscription | null;   // the current one (see below); null = none
  subscriptionHistory: TenantSubscription[];  // every subscription, newest first (createdAt desc); includes the current one
  usage: Record<TenantLimitKey, { used: number; limit: number | null }>; // every key present
  owners: { userId: string; name: string | null; email: string }[]; // active owners only; platform-admin payload only
  auditTrail: TenantAuditEntry[];            // last 50 rows for this org, newest first
};

export type TenantSubscription = {
  id: string;
  packageCode: string;
  packageName: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  billingPeriod: "monthly" | "yearly";
  trialEndsAt: string | null;          // ISO
  currentPeriodEnd: string | null;     // ISO
  canceledAt: string | null;           // ISO
  createdAt: string;                   // ISO
};

export type TenantAuditEntry = {
  id: number;
  action: string;                      // e.g. 'org.status_changed', 'tenant.owner_password_reset'
  actorName: string | null;            // profiles.full_name; null = system or unknown (show "System"). Never an email
  createdAt: string;                   // ISO
  metadata: Record<string, unknown>;   // see *Audit trail*
};
```

**Current subscription** = the newest subscription whose status is not `canceled`; if every subscription is canceled, the newest one; none → `null`. It is the same row `subscriptionHistory[0]` unless an older active one exists beside a newer canceled one.

## `apps/web/lib/admin/tenant-detail.ts` (`server-only`)

```ts
export function getTenantDetail(orgId: string): Promise<TenantDetail | null>;
// requirePlatformAdmin() inside. Not cached (always fresh). Calls admin_get_tenant_detail as the signed-in user:
// no service role. null = not a uuid, or no such organization.
```

## Audit trail

- The RPC returns the **last 50** `audit_logs` rows with `organization_id = org_id`, newest first.
- `actorName` comes from `profiles.full_name`. No email, ever.
- `metadata` is returned as stored, with any top-level key named `email` or ending in `_email` **removed** (defence in depth: no writer should put one there).
- `tenant.owner_password_reset` rows carry `entity_type = 'user'`, `entity_id` = the owner's user id, `metadata = {}`. They never contain an email.

## Password reset: `apps/web/lib/admin/tenant-actions.ts` (`'use server'`)

```ts
export async function sendOwnerPasswordReset(prev: ActionResult | null, formData: FormData): Promise<ActionResult>;
```

| FormData field | Rule |
|---|---|
| `orgId` | uuid |
| `userId` | uuid. Must be an **active owner** of `orgId` |

Order of work, so a failure at one step never reaches the next:

1. `requirePlatformAdmin()`. Non-admin → `notFound()`.
2. Zod (both uuids, no other keys). Errors → `fieldErrors` keyed `orgId` / `userId`.
3. **Arcjet**: `protect(ajAuth)` from `lib/arcjet.ts` (bot + shield + the shared auth rate limit; no new preset, no edit to `lib/arcjet.ts`). Denied → `{ ok: false, code: 'RATE_LIMITED' }`.
4. `admin_prepare_owner_password_reset(orgId, userId)`: in one transaction it re-checks `is_platform_admin()`, checks that `userId` is an **active** member of `orgId` whose role is `owner` (a deactivated owner, a manager, or a user of another organization all fail the same way), enforces the **per-admin limit of 5 per rolling hour** (counted from this admin's `tenant.owner_password_reset` audit rows), writes **one** audit row, and returns the owner's email.
5. The email goes through the cookie-less `createAnonClient()`: `resetPasswordForEmail(email, { redirectTo: confirmUrl('/reset-password') })`. This is the same mechanism and the same recovery email template as `/forgot-password` (`token_hash` link, so no PKCE cookie is needed). It does **not** use the service role and does **not** set cookies on the admin's browser. Provider errors (including Supabase's per-address cooldown) are swallowed and logged without the address.
6. `updateTag` is not needed (nothing cached changes). PostHog `tenant_password_reset_sent` with `{ orgId }` only, `distinctId` = admin id. Sent after step 5, whether or not the provider accepted the mail (the action cannot know).

The audit row is written **before** the mail is sent, so an attempt is always on record; a send that then fails still counts toward the hourly limit.

### Results

`{ ok: true }` means "we asked Supabase to send it". It never says whether the mail was delivered.

| Situation | Result |
|---|---|
| Not a platform admin | `notFound()` |
| Malformed `orgId` / `userId` | `{ ok: false, fieldErrors }` |
| Arcjet denies | `{ ok: false, code: 'RATE_LIMITED', formError: "Too many attempts. Try again later." }` |
| Per-admin limit reached (`RATE_LIMITED`, P0001) | same as above |
| `userId` is not an active owner of `orgId` (`NOT_AN_OWNER`, P0001), or `orgId` does not exist | `{ ok: false, code: 'NOT_FOUND', formError: "That owner no longer exists." }` (one message for every cause, so it cannot probe other organizations) |
| `42501` | `{ ok: false, code: 'FORBIDDEN', formError: "You don't have access to do that." }` |
| `OWNER_HAS_NO_EMAIL` (P0001): the owner's profile has no address | `{ ok: false, formError: "Could not send the reset email. Try again." }` (same generic error; nothing is audited) |
| Anything else | `{ ok: false, formError: "Could not send the reset email. Try again." }` |
| Success | `{ ok: true }` |

`ActionErrorCode` gains `NOT_FOUND` (added by DAVIN; the packages contract adds the same member, so whichever PR merges second just keeps one). `RATE_LIMITED` and `FORBIDDEN` already exist.

## Privacy rules

- The owner's email is returned only inside the platform-admin payload (`owners[].email`) and by `admin_prepare_owner_password_reset`, to the server. It is never written to `audit_logs`, never logged, and never sent to PostHog.
- PostHog events carry ids only (`orgId`), no names, no emails.
- `console.error` lines for this feature contain the error message only, never the address.

## Tests

- pgTAP (`supabase/tests/database/`): the owner of the demo org, a manager, and `anon` get `42501` from both RPCs; the platform admin gets the full payload; unknown org → `null`; usage moves when a location, a table or an invitation is added and when a member is deactivated, and matches what the triggers enforce; the reset RPC rejects a non-owner, a deactivated owner and a user of another org with the same error; exactly one audit row, with no email; the sixth call in an hour is refused.
- Vitest (`lib/admin`, mocked Supabase and Arcjet): every row of the *Results* table, the call order (Arcjet before the RPC, the RPC before the mail), and that no email reaches PostHog or `console`.
