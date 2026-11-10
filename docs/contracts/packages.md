# Contract: `lib/admin` packages (M1 §5, MSS-T01)

Drafted 2026-11-09 by **DAVIN** for review by ALAN. **DAVIN** implements it (MSS-T01). **ADIT** builds the super admin Packages UI against it. This file merges first, as its own Markdown-only PR. Changes need agreement from both, plus ALAN, and are made here first.

## Surface and binding

- Route: `app/(superadmin)/admin/packages/`. Platform admins only.
- Every mutation is a form action (the `useActionState` shape: `(prev: ActionResult | null, formData: FormData) => Promise<ActionResult>`). `ActionResult` is from `@/lib/auth/schemas`.
- Pages import actions **directly** from `@/lib/admin/package-actions` (a `'use server'` file cannot re-export, and it exports async functions only).
- Constants and types the UI needs (feature list, limit keys, labels, `PackageInput`) live in `@/lib/admin/package-schemas` (no `server-only`, safe to import in client components).
- Every action calls `requirePlatformAdmin()` first. A non-admin gets `notFound()` (same as the other admin pages). The SQL RPCs re-check `is_platform_admin()` and raise `FORBIDDEN` (`42501`), and RLS on `packages` already blocks direct writes by non-admins.
- No organization id exists in this feature. Plans are platform-wide. `packageId` in FormData is a plan id, validated as a uuid.

## Schema

No new tables. Uses `packages` as it is (`code`, `name`, `description`, `currency`, `price_monthly`, `price_yearly`, `trial_days`, `limits`, `features`, `is_active`, `is_public`, `is_default`, `sort_order`). The DB already enforces the code format, non-negative prices, trial 0–365, limits-is-object and a single default (partial unique index).

New SQL (migration by DAVIN), all `security definer`, `search_path = ''`, `execute` granted to `authenticated` only, each re-checks `is_platform_admin()`, each writes **one** `audit_logs` row in the same transaction (`organization_id` null, `actor_id` = the admin, `entity_type = 'package'`, `entity_id` = package id):

| RPC | Audit `action` | Audit `metadata` |
|---|---|---|
| `admin_create_package(input jsonb) returns uuid` | `package.created` | `{ before: null, after: {…} }` |
| `admin_update_package(package_id uuid, input jsonb) returns boolean` | `package.updated` | `{ before: {…changed fields}, after: {…changed fields} }`. No change → no write, no audit row, returns `false` |
| `admin_set_package_active(package_id uuid, active boolean) returns boolean` | `package.archived` / `package.restored` | `{ before: {is_active}, after: {is_active} }` |
| `admin_set_default_package(package_id uuid) returns boolean` | `package.default_changed` | `{ before: {default_code}, after: {default_code} }`. Locks the table rows, so two concurrent calls leave exactly one default |

There is **no delete**. Archiving sets `is_active = false`. The row is kept, so subscriptions keep their plan.

## `apps/web/lib/admin/packages.ts` (`server-only`)

```ts
export type AdminPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency: string;               // 'IDR' | 'USD'
  priceMonthly: number;           // integer minor units
  priceYearly: number;            // integer minor units
  trialDays: number;              // 0–365
  limits: Record<LimitKey, number | null>; // every known key is present; null = unlimited
  features: FeatureKey[];
  isActive: boolean;
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  subscriptionCount: number;      // all subscriptions, any status
  createdAt: string;              // ISO
  updatedAt: string;              // ISO
};

export function listPackagesForAdmin(): Promise<AdminPackage[]>;
// requirePlatformAdmin() inside. Includes inactive and hidden plans.
// Order: sortOrder, then priceMonthly. Not cached (always fresh for the admin page).
```

## `apps/web/lib/admin/package-schemas.ts` (shared, no `server-only`)

```ts
export const LIMIT_KEYS = ['max_locations', 'max_staff', 'max_tables', 'max_orders_per_month'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = ['qr_ordering', 'reservations', 'custom_domain', 'advanced_reports'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
// Adding a key = edit this file + the pricing/feature-gate copy. Unknown keys are rejected on write.

export const FEATURE_LABELS: Record<FeatureKey, string>;
export const LIMIT_LABELS: Record<LimitKey, string>;
export const CURRENCIES = ['IDR', 'USD'] as const;

export const packageInputSchema;       // Zod, see FormData below
export type PackageInput = z.infer<typeof packageInputSchema>;
```

## `apps/web/lib/admin/package-actions.ts` (`'use server'`)

| Action | FormData fields | Notes |
|---|---|---|
| `createPackage` | the **plan fields** below | `code` is set here and never changes |
| `updatePackage` | `packageId` + the plan fields except `code` | changing `currency` while the plan has subscriptions → `PACKAGE_IN_USE` |
| `archivePackage` | `packageId`, `archived` (`'true'` \| `'false'`) | `'false'` restores. Archiving the default plan → `DEFAULT_PACKAGE` |
| `setDefaultPackage` | `packageId` | an archived plan → `PACKAGE_INACTIVE` |

**Plan fields**

| Field | Rule |
|---|---|
| `code` | `^[a-z][a-z0-9_-]{1,39}$` (same as the DB check). Create only |
| `name` | trimmed, 1–60 chars |
| `description` | trimmed, ≤ 300 chars, empty → `null` |
| `currency` | one of `CURRENCIES` |
| `priceMonthly`, `priceYearly` | **integer minor units as digits only** (`/^\d+$/`, safe integer). No decimals, separators, signs or exponents. IDR exponent is 0, so `250000` is Rp 250.000. USD is cents. The UI converts what the admin types into minor units before posting |
| `trialDays` | integer 0–365 |
| `limit_max_locations`, `limit_max_staff`, `limit_max_tables`, `limit_max_orders_per_month` | integer ≥ 0 (≤ 1 000 000), or **empty string = unlimited** (stored as JSON `null`). Always one field per key in `LIMIT_KEYS`. Other `limit_*` fields are rejected |
| `features` | repeated field, each value in `FEATURE_KEYS`, duplicates collapsed. Unknown value → field error on `features` |
| `isPublic` | `'true'` \| `'false'` (hidden plans are not on `/pricing`, but can be assigned) |
| `sortOrder` | integer 0–9999 |

## Errors

New members of `ActionErrorCode` in `lib/auth/schemas.ts`, added by DAVIN: **`DUPLICATE_CODE`**, **`NOT_FOUND`**, **`PACKAGE_IN_USE`**, **`DEFAULT_PACKAGE`**, **`PACKAGE_INACTIVE`**. Existing `FORBIDDEN` is reused (it only appears if the DB check fails after the server check passed).

Every failure is `{ ok: false, code?, formError?, fieldErrors? }`. Zod errors come back in `fieldErrors`, keyed by the FormData names above. Limit errors are keyed `limit_max_tables` etc.

| SQL error | Code | `formError` |
|---|---|---|
| unique violation on `code` (`23505`) | `DUPLICATE_CODE` (also `fieldErrors.code`) | "A plan with that code already exists." |
| `PACKAGE_NOT_FOUND` (P0001) | `NOT_FOUND` | "That plan no longer exists." |
| `PACKAGE_IN_USE` (P0001) | `PACKAGE_IN_USE` (also `fieldErrors.currency`) | "Plans with subscriptions can't change currency." |
| `DEFAULT_PACKAGE` (P0001) | `DEFAULT_PACKAGE` | "Set another plan as the default before archiving this one." |
| `PACKAGE_INACTIVE` (P0001) | `PACKAGE_INACTIVE` | "Restore the plan before making it the default." |
| `42501` | `FORBIDDEN` | "You don't have access to do that." |
| anything else | none | "Could not save the plan. Try again." |

A no-op update (nothing changed) returns `{ ok: true }` without an audit row.

## Side effects

- Every successful write calls `updateTag('packages')` (the tag `getPublicPackages` uses), so `/pricing` shows the change on the next request. A failed write does not.
- The audit row is written by the RPC, in the same transaction as the write. No audit row for a failed or no-op write.
- PostHog (server, `distinctId` = admin id, no group, no PII): events `package_created`, `package_updated`, `package_archived`, `package_default_changed`. `package_created` carries `{ code }`; `package_updated`, `package_archived` and `package_default_changed` carry `{ packageId }` and are sent only when the RPC reports a change (no-ops send nothing).
- Prices on a plan apply to **future** invoices only. Existing `platform_invoices` keep their stored amounts.

## Direct writes are closed

`authenticated` has `select` only on `packages`, and the admin RLS policy is select-only. Plans are created, edited, archived and defaulted **only** through the four RPCs, so every change has an audit row and a platform admin cannot delete a plan through PostgREST.
