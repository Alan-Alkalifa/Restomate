# Contract: setup checklist progress (M1 §5 "Onboarding polish", MSS-T10 / MSS-T11)

Pinned 2026-11-09 by **ALAN**. **DAVIN** implements the data function (MSS-T10). **ADIT** builds the checklist on the org home page (MSS-T11) against a seam at the same path. Changes need agreement from both, plus ALAN, and are made here first.

## Where it shows

The "Set up your restaurant" section on `app/(dashboard)/[org]/page.tsx`. It replaces the static M0 checklist. It's read inside the existing `<Suspense>` child, after `requireOrgContext(org)`.

## `apps/web/lib/onboarding/progress.ts` (`server-only`)

```ts
import type { OrgContext } from "@/lib/auth/dal";

export const SETUP_STEPS = ["location", "tables", "menu", "staff", "branding"] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

export type SetupStep = {
  key: SetupStepKey;
  done: boolean;
  /** Path relative to the org, e.g. "settings", "{locationId}/tables", "menu", "staff". null = the user can't act on it */
  href: string | null;
};

export type SetupProgress = {
  steps: SetupStep[];   // always all five, in SETUP_STEPS order
  completed: number;    // count of done steps
  total: number;        // 5
};

export function getSetupProgress(ctx: OrgContext): Promise<SetupProgress>;
```

- Reads through the **signed-in user's client**, so RLS applies. No service role and no org id from the client. The org comes from `ctx`.
- Cached with `'use cache'` + `cacheTag('setup-progress:' + orgId)`. Keyed by org id only, with no user data in the key. The actions that change an input (create location, table or menu item, invite staff, save branding) call `updateTag('setup-progress:' + orgId)`. If an action doesn't call it yet, the cache life (`'minutes'`) bounds the staleness. Each later PR that touches those actions adds the tag.
- `href` is `null` when the user lacks the permission for that step (`settings.manage` for location and branding, `tables.manage` for tables, `menu.manage` for menu, `staff.manage` for staff). A step the user can't act on still shows its done state.

## Done rules

| Step | Done when | href |
|---|---|---|
| `location` | ≥ 1 **active** location has an address **or** the org has ≥ 2 active locations (the onboarding location alone, with no details, is not "done") | `settings` |
| `tables` | ≥ 1 **active** table in any active location | `{firstActiveLocationId}/tables` |
| `menu` | ≥ 1 **available** menu item (`menu_items`, from MVM-T06). Until #73 merges, `false` | `menu` |
| `staff` | ≥ 1 active member other than the owner(s), **or** ≥ 1 pending invitation | `staff` |
| `branding` | `org_branding.logo_url` is set **or** `primary_color` differs from the onboarding default | `settings` |

The exact column names come from the migrations on `main`. If a rule can't be expressed with existing columns, DAVIN says so before implementing it, and the table is updated here first.

## UI (MSS-T11)

- A progress line ("2 of 5 done") and a list: each step is a ≥ 48px row with a checked or unchecked state (text plus icon, not colour alone), the label, and a link when `href` is set.
- When `completed === total`, show a short "You're all set" state, and the section can be collapsed.
- No PostHog event in this task. `getSetupProgress` is cached, so it must have no side effects. A completion event, if wanted later, belongs in the actions that complete a step.
