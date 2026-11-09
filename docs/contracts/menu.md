# Contract: `lib/menu` (M2 menu, MVM-T08)

Pinned 2026-11-09 by ALAN. The schema is MVM-T06 (PR #73). **DAVIN** implements `lib/menu` (MVM-T08). **ADIT** builds the menu editor (MVM-T09) and the per-location availability page (MVM-T10) against it, and they merge after MVM-T08. Changes need agreement from both, plus ALAN, and are made in this file first.

## URLs and binding

- Org-level menu editor: `app/(dashboard)/[org]/menu/`. Items, categories, variants and modifier groups are shared by all locations.
- Per-location availability: `app/(dashboard)/[org]/[location]/menu/`. It covers price overrides, availability, "sold out today" and kitchen stations. `[location]` is the location **id** (uuid).
- Every mutation is a form action (the `useActionState` shape) with `orgSlug` (and `locationId` for location actions) **bound server-side**. No organization id ever travels in FormData.
- Pages import directly from `@/lib/menu/data` and `@/lib/menu/actions`. A `'use server'` file cannot re-export.

## Money

- Every price is an **integer in minor units**, as a decimal string in FormData (e.g. `"35000"` = Rp 35.000; IDR has exponent 0).
- The UI displays prices with `formatMoney(amount, currency)` from `lib/money.ts`. It turns typed input into minor units using `currencyExponent(currency)`; for IDR (exponent 0) the typed whole-rupiah value **is** the minor-unit value. It never uses floats. If a shared parse helper is needed (e.g. for USD with 2 decimals), ADIT asks for `parseMoneyInput` to be added to `lib/money.ts` (DAVIN's file) rather than writing maths in components.
- The server validates: integer, `0 ≤ price ≤ 1_000_000_000_000`. Variant `priceDelta` may be negative (≥ −1_000_000_000_000). Modifier `priceDelta` ≥ 0.
- **Currency:** all locations of an org use the org's currency (Decisions log, 2026-11-09). `getMenu` returns it.

## `apps/web/lib/menu/data.ts` (`server-only`)

```ts
export type DietaryTag = 'vegetarian' | 'vegan' | 'halal' | 'spicy' | 'contains_nuts' | 'gluten_free';

export type MenuCategory = { id: string; name: string; description: string | null; sortOrder: number; isActive: boolean; itemCount: number };
export type MenuVariant = { id: string; name: string; priceDelta: number; sortOrder: number; isActive: boolean };
export type MenuItem = {
  id: string; categoryId: string; name: string; description: string | null;
  basePrice: number; imagePath: string | null; dietaryTags: DietaryTag[];
  isPublished: boolean; isActive: boolean; sortOrder: number;
  variants: MenuVariant[];          // active and inactive, ordered
  modifierGroupIds: string[];       // ordered
};
export type Modifier = { id: string; name: string; priceDelta: number; sortOrder: number; isActive: boolean };
export type ModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; sortOrder: number; isActive: boolean; modifiers: Modifier[] };

export function getMenu(orgSlug: string): Promise<{
  currency: string;                 // org currency, e.g. 'IDR'
  categories: MenuCategory[]; items: MenuItem[]; modifierGroups: ModifierGroup[];
  canManage: boolean;               // has menu.manage
}>;
// Any org member can read.

export type KitchenStation = { id: string; name: string; sortOrder: number; isActive: boolean };
export type LocationMenuRow = {
  itemId: string; categoryId: string; name: string; isPublished: boolean; isActive: boolean;
  basePrice: number; priceOverride: number | null; effectivePrice: number;
  isAvailable: boolean; soldOutUntil: string | null /* ISO; null = not sold out */; kitchenStationId: string | null;
};
export function getLocationMenu(orgSlug: string, locationId: string): Promise<{
  currency: string; timezone: string;
  rows: LocationMenuRow[]; stations: KitchenStation[];
  canManage: boolean;               // menu.manage: overrides and stations
  canToggleSoldOut: boolean;        // menu.manage OR orders.create
}>;
// Any member with access to the location can read.
```

## `apps/web/lib/menu/actions.ts` (`'use server'`)

```ts
type MenuAction = (orgSlug: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
type LocationMenuAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
```

Org-level (`menu.manage`):

| Action | FormData fields |
|---|---|
| `createCategory` | `name`, `description` (optional) |
| `updateCategory` | `categoryId`, `name`, `description` |
| `setCategoryActive` | `categoryId`, `active` (`'true'` \| `'false'`) |
| `reorderCategories` | `categoryIds` (repeated, full order) |
| `createItem` | `categoryId`, `name`, `description`, `basePrice`, `dietaryTags` (repeated), `isPublished` (`'true'`, or absent = false) |
| `updateItem` | `itemId` + the same fields as `createItem` |
| `setItemActive` | `itemId`, `active` |
| `setItemPublished` | `itemId`, `published` |
| `reorderItems` | `categoryId`, `itemIds` (repeated, full order within the category) |
| `saveItemVariants` | `itemId`, `variants` = JSON `[{ id?, name, priceDelta }]` (full list; rows missing from the list are deactivated; ≤ 20) |
| `createModifierGroup` | `name`, `minSelect`, `maxSelect` |
| `updateModifierGroup` | `groupId`, `name`, `minSelect`, `maxSelect` |
| `setModifierGroupActive` | `groupId`, `active` |
| `saveGroupModifiers` | `groupId`, `modifiers` = JSON `[{ id?, name, priceDelta }]` (full list, same semantics; ≤ 30) |
| `setItemModifierGroups` | `itemId`, `groupIds` (repeated, ordered; may be empty) |

Location-level:

| Action | Permission | FormData fields |
|---|---|---|
| `setLocationOverride` | `menu.manage` | `itemId`, `priceOverride` (`''` = clear), `isAvailable` (`'true'`, or absent = false), `kitchenStationId` (`''` = none) |
| `toggleSoldOut` | `menu.manage` or `orders.create` | `itemId`, `soldOut` (`'true'` \| `'false'`); calls `set_item_sold_out` |
| `createStation` | `menu.manage` | `name` |
| `renameStation` | `menu.manage` | `stationId`, `name` |
| `setStationActive` | `menu.manage` | `stationId`, `active` |

**Checkbox rule (lesson from B1-T09):** a boolean that comes from a checkbox treats an **absent field as false**. The UI also posts an explicit hidden `false`.

## Errors

- `{ ok: false, code?, formError?, fieldErrors? }`, with `ActionResult` from `@/lib/auth/schemas`.
- `DUPLICATE_NAME` (an active category, group or station name is taken) also sets `fieldErrors.name`. `FORBIDDEN` is reused.
- Zod errors come back in `fieldErrors`, keyed by the FormData names above. Errors inside the JSON lists use `variants` / `modifiers` with a readable message, e.g. "Variant 2: enter a name".
- `minSelect > maxSelect`, or `maxSelect < 1`, → `fieldErrors.maxSelect`.
- The UI must render `fieldErrors` (the B1-T10 pattern); nothing may fail silently.

## Side effects

- Every org-level mutation calls `updateTag('menu:{orgId}')`. Location mutations call `updateTag('menu:{orgId}:{locationId}')`.
- Audit rows are written by DB triggers.
- PostHog events: `menu_item_created`, `menu_item_updated`, `menu_item_sold_out_toggled` (group = org, no PII).
- Images (Supabase Storage upload) are a later task. `imagePath` is read-only for now.
