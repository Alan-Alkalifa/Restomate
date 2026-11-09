# Contract: platform settings (M1 §5, MSS-T08)

Drafted 2026-11-09 by **DAVIN** for review by ALAN. **DAVIN** implements it (MSS-T08, branch `feat/mss-platform-settings`). **ADIT** builds the super admin Settings page and the public banner in a follow-up task. This file merges first, as its own Markdown-only PR. Changes need agreement from both, plus ALAN, and are made here first.

## Surface and binding

- Admin route: `app/(superadmin)/admin/settings/`. Platform admins only.
- Every mutation is a form action (`useActionState` shape). `ActionResult` is from `@/lib/auth/schemas`.
- Import the actions **directly** from `@/lib/admin/settings-actions` (`'use server'`, async functions only). Types, defaults and Zod schemas live in `@/lib/admin/platform-settings-schemas` (no `server-only`, safe in client components). Admin read: `@/lib/admin/platform-settings` (`server-only`). Public read and the signup check: `@/lib/public/platform-flags` (`server-only`).
- Every action calls `requirePlatformAdmin()` first (non-admin → `notFound()`). The SQL re-checks `is_platform_admin()` and raises `FORBIDDEN` (`42501`).
- `platform_settings` keeps **no client grants and no client policy**. All access is through the three `security definer` functions below.

## Settings (typed keys only)

| Key | Value | Default when the row is missing |
|---|---|---|
| `signup` | `{ enabled: boolean }` | `{ enabled: true }` |
| `maintenance_banner` | `{ enabled: boolean, message: string, level: 'info' \| 'warning' }` | `{ enabled: false, message: '', level: 'info' }` |
| `tax_presets` | `{ presets: TaxPreset[], defaultCode: string }` | see below |
| `owned_org_cap` | `{ max: integer 1–100 }` | `{ max: 3 }` |

Unknown keys are rejected in SQL (`INVALID_SETTING_KEY`) and in Zod (`strictObject`).

**`signup`**: `enabled: false` stops new accounts and new organizations (see *Signup enforcement*). Existing users can still sign in. Platform admins are **not** exempt on the public flow.

**`maintenance_banner`**: `message` is **plain text**, trimmed, ≤ 200 characters, with no control characters and **no `<` or `>`**. When `enabled` is true the message must be non-empty. The UI renders it as a text node, never as HTML.

**`tax_presets`**: rates are **integer basis points** (`1000` = 10%), never floats. A JSON number that is not an integer is rejected.

```ts
export type TaxPreset = {
  code: string;               // ^[a-z][a-z0-9_-]{1,29}$, unique within the list
  label: string;              // trimmed, 1–60 chars
  taxRateBps: number;         // integer 0–10000 (PB1/PBJT is up to 1000)
  serviceChargeBps: number;   // integer 0–10000
  taxOnServiceCharge: boolean; // true = tax is computed on subtotal + service charge (CLAUDE.md default order)
};
```

1–20 presets; `defaultCode` must be one of their codes. Default list when the row is missing: `pb1_10` "PB1 10%" (1000 / 0 / true) and `pb1_10_sc5` "PB1 10% + service 5%" (1000 / 500 / true), `defaultCode: 'pb1_10'`. **These are presets only.** Locations copy a preset when they are created (M3 wires that); changing the list never touches an existing location.

**`owned_org_cap`**: how many organizations one user may own. It is stored in the **existing row `max_owned_organizations` as a bare integer** (`3`), because `create_organization` already reads that row. The API name `owned_org_cap` / `{ max }` is what the RPC, the Zod schema and the audit log use; the RPC translates. No change to `create_organization`. An invalid stored value falls back to 3, as today.

## Schema

No new tables. New SQL (migration by DAVIN), all `security definer`, `search_path = ''`:

| Function | Callable by | Returns |
|---|---|---|
| `admin_get_platform_settings()` | `authenticated`, platform admins only (`42501` otherwise) | `jsonb` with all four keys, defaults filled in |
| `admin_update_platform_setting(key text, value jsonb)` | `authenticated`, platform admins only | `boolean` (`true` = changed) |
| `get_public_platform_flags()` | `anon`, `authenticated` | `{ "signupEnabled": boolean, "maintenanceBanner": { enabled, message, level } \| null }` and **nothing else**: no tax presets, no cap, no other key |

`admin_update_platform_setting` validates the value per key in SQL (type, range, length, uniqueness, `defaultCode`), sets `updated_by`, and writes **one** `audit_logs` row in the same transaction: `action = 'platform_setting.updated'`, `organization_id` null, `actor_id` = the admin, `entity_type = 'platform_setting'`, `entity_id` = the API key, `metadata = { key, before, after }`. Writing the same value again (after normalisation) returns `false`, writes nothing, and adds no audit row. Invalid input raises `INVALID_SETTING` (`P0001`).

`get_public_platform_flags().maintenanceBanner` is `null` when the banner is disabled, so a disabled banner never leaks its text.

## Signup enforcement (server-side)

When `signup.enabled` is false:

1. **`signUp` action** (`lib/auth/actions.ts`) returns `{ ok: false, code: 'SIGNUP_DISABLED', formError: "Sign-ups are closed right now." }` before it calls Supabase Auth. It runs after the Arcjet check.
2. **`createOrganization` action** (`lib/onboarding/actions.ts`) returns the same result before it calls the RPC.
3. **The database refuses too.** A `before insert` trigger on `organizations` raises `SIGNUP_DISABLED` (`P0001`). That covers a direct call to the `create_organization` RPC with a user's own session, which the actions cannot see. `mapCreateOrganizationError` maps it to the same `SIGNUP_DISABLED` result.
4. Sign-in, password reset and everything an existing user does are unchanged.

Both actions check the flag through `isSignupEnabled()` in `lib/public/platform-flags.ts`, which calls `get_public_platform_flags` **uncached**. The cached `getPublicPlatformFlags()` is for display only, so a stale cache can never let a signup through.

**Known limit (not fixed here):** the Server Action cannot stop someone from calling Supabase Auth's `/signup` endpoint directly with the public key. Such an account can exist but can never create an organization (point 3). Closing it completely needs a Supabase Auth `before_user_created` hook (`supabase/config.toml` and the dashboard setting), which is outside this task's files. Proposed as a follow-up.

## `apps/web/lib/admin/platform-settings-schemas.ts` (shared, no `server-only`)

```ts
export type BannerLevel = 'info' | 'warning';
export type MaintenanceBanner = { enabled: boolean; message: string; level: BannerLevel };
export type TaxPreset = { /* as above */ };
export type PlatformSettings = {
  signup: { enabled: boolean };
  maintenanceBanner: MaintenanceBanner;
  taxPresets: { presets: TaxPreset[]; defaultCode: string };
  ownedOrgCap: { max: number };
};

export const BANNER_MESSAGE_MAX = 200;
export const TAX_PRESETS_MAX = 20;
export const OWNED_ORG_CAP_RANGE = { min: 1, max: 100 } as const;
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings;
export const signupSchema, maintenanceBannerSchema, taxPresetsSchema, ownedOrgCapSchema; // Zod, strict
```

## `apps/web/lib/admin/platform-settings.ts` (`server-only`)

```ts
export function getPlatformSettings(): Promise<PlatformSettings>;
// requirePlatformAdmin() inside. Calls admin_get_platform_settings as the signed-in user. Not cached.
```

## `apps/web/lib/public/platform-flags.ts` (`server-only`)

```ts
export type PublicPlatformFlags = { signupEnabled: boolean; maintenanceBanner: MaintenanceBanner | null };
export function getPublicPlatformFlags(): Promise<PublicPlatformFlags>;
// 'use cache' + cacheTag('platform-flags') + cacheLife('minutes'), cookie-less anon client. For display (banner, hiding the signup link).
// If the call fails it returns { signupEnabled: true, maintenanceBanner: null } and logs, so a settings outage never takes the site down.
export function isSignupEnabled(): Promise<boolean>;
// Uncached. Used by the signUp and createOrganization actions. If the call fails it returns true (the database trigger still enforces).
```

Safe to call from the public layout inside `<Suspense>`.

## `apps/web/lib/admin/settings-actions.ts` (`'use server'`)

| Action | FormData fields |
|---|---|
| `updateSignup` | `enabled` (`'true'` \| `'false'`) |
| `updateMaintenanceBanner` | `enabled` (`'true'` \| `'false'`), `message` (string), `level` (`'info'` \| `'warning'`) |
| `updateTaxPresets` | `presets` (a JSON string of `TaxPreset[]`, ≤ 20 items, ≤ 8 KB), `defaultCode` |
| `updateOwnedOrgCap` | `max` (digits only, 1–100) |

Each: `requirePlatformAdmin()` → Zod `strictObject` (unknown fields rejected; unknown fields become `formError`) → RPC → on a real change `updateTag('platform-flags')` and PostHog `platform_setting_updated` with `{ key }` only (`distinctId` = admin id, no group, no values, no message text). A no-op returns `{ ok: true }` with no tag refresh, no audit row and no event. A failed write does none of these.

`updateTag('platform-flags')` is called for **every** key (the tag is cheap and keeps the rule simple), not only `signup` and `maintenance_banner`.

## Errors

New `ActionErrorCode` member, added by DAVIN: **`SIGNUP_DISABLED`**. Existing `FORBIDDEN` and `RATE_LIMITED` are reused.

Every failure is `{ ok: false, code?, formError?, fieldErrors? }`. Zod errors come back in `fieldErrors` keyed by the FormData names above (`presets` errors are reported on `presets`, with the failing index in the message, e.g. "Preset 2: tax rate must be between 0 and 10000.").

| SQL error | Code | `formError` |
|---|---|---|
| `42501` | `FORBIDDEN` | "You don't have access to do that." |
| `INVALID_SETTING` / `INVALID_SETTING_KEY` (P0001) | none | "That value isn't allowed." |
| `SIGNUP_DISABLED` (P0001, from the trigger) | `SIGNUP_DISABLED` | "Sign-ups are closed right now." |
| anything else | none | "Could not save the setting. Try again." |

## Tests

- pgTAP: `platform_settings` still has no client grant or policy; owner, manager and anon get `42501` from both admin RPCs; anon can call `get_public_platform_flags` and gets exactly two keys; a disabled banner returns `null`; each key rejects unknown keys, wrong types, a rate above 10000 bps, a non-integer rate, a banner over 200 characters or containing `<`, an empty enabled banner, a duplicate or missing `defaultCode`, a cap outside 1–100; one audit row with `before`/`after` per real change and none for a no-op; with signup disabled `create_organization` fails with `SIGNUP_DISABLED` and with it enabled it succeeds; a new `owned_org_cap` takes effect in `create_organization`.
- Vitest: Zod for each action, the call order, `updateTag('platform-flags')` only after a real change, PostHog payload `{ key }` only, `SIGNUP_DISABLED` from `signUp` and `createOrganization` (and that sign-in is unaffected), and the failure fallbacks of `getPublicPlatformFlags` / `isSignupEnabled`.
