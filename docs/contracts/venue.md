# Contract: `lib/venue` (M2 venue, MVM-T03)

Pinned 2026-11-09 by ALAN. **DAVIN** implements it (MVM-T01 schema, MVM-T03 lib). **ADIT** builds the tables pages against it (MVM-T04) and merges after MVM-T03. Changes need agreement from both, plus ALAN, and are made in this file first.

## URL and binding

- Route: `app/(dashboard)/[org]/[location]/tables/`. `[org]` is the org **slug**, `[location]` is the location **id** (uuid).
- Every mutation is a form action (the `useActionState` shape). `orgSlug` and `locationId` are **bound server-side** in the page, e.g. `createArea.bind(null, slug, locationId)`.
- No organization id ever travels in FormData. The server derives the org from the slug and the caller's membership, and checks that the location belongs to that org and that the caller can access it.
- Pages import actions **directly** from `@/lib/venue/actions`. A `'use server'` file cannot re-export.

## Schema (MVM-T01)

| Table | Key columns |
|---|---|
| `areas` | `id`, `organization_id`, `location_id`, `name` (1–60), `sort_order`, `is_active`, timestamps. Unique `(location_id, lower(name))` among active rows |
| `tables` | `id`, `organization_id`, `location_id`, `area_id`, `label` (1–20, unique per location among active rows), `capacity` (1–50), `shape` (`square` \| `round` \| `rect`), `status` (`available` \| `reserved` \| `occupied` \| `needs_cleaning`), `pos_x`, `pos_y` (nullable int), `is_active`, `qr_token` (server-generated, unique), `qr_rotated_at`, timestamps |

`qr_token` is **not** in the client SELECT grant: columns are granted individually, so clients must list columns explicitly (no `select('*')`).

RPCs: `rotate_table_qr_token(table_id uuid) returns text` (requires `tables.manage`), `get_table_qr_tokens(location_id uuid, table_ids uuid[] default null)` (requires `tables.manage` + location access; returns `table_id, label, area_name, qr_token` for active tables; the only way to read tokens), and `resolve_table_qr(token text)` (anon; returns only org slug, location id, table id and label).

SQL errors that the lib maps to codes:
- a unique-violation on the active-name index (`23505`) → `DUPLICATE_NAME`;
- `AREA_NOT_EMPTY` (P0001), raised by a trigger when an area with active tables is deactivated → `AREA_NOT_EMPTY`;
- `PLAN_LIMIT:max_tables` (P0001) → `PLAN_LIMIT`;
- `AREA_INACTIVE` (P0001), raised when an active table would point to an inactive area → `formError` "That area is inactive. Reactivate it first." (no new code);
- `TABLE_INACTIVE` (P0001), raised by rotating the QR of an inactive table → `formError` "Reactivate the table before replacing its QR code." (no new code);
- `42501` → `FORBIDDEN`.

## `apps/web/lib/venue/data.ts` (`server-only`)

```ts
export type Area = { id: string; name: string; sortOrder: number; isActive: boolean; tableCount: number };

export type VenueTable = {
  id: string; areaId: string; label: string; capacity: number;
  shape: 'square' | 'round' | 'rect';
  status: 'available' | 'reserved' | 'occupied' | 'needs_cleaning';
  posX: number | null; posY: number | null; isActive: boolean;
};

export function getVenue(orgSlug: string, locationId: string): Promise<{
  areas: Area[];
  tables: VenueTable[];
  canManage: boolean;                               // caller has tables.manage
  tableLimit: { used: number; max: number | null }; // "12 / 20" = used / max; max null = unlimited; used counts active tables in the org
}>;
// Any member with access to the location can read. Never returns qr_token.

export function getTableQrTokens(orgSlug: string, locationId: string, tableIds?: string[]):
  Promise<{ tableId: string; label: string; areaName: string; url: string }[]>;
// tables.manage only, via the get_table_qr_tokens RPC. url = `${storefront origin}/t/{qr_token}`. For the QR print task (later). Never cache it with a token in the key.
```

## `apps/web/lib/venue/actions.ts` (`'use server'`)

```ts
type VenueAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
// ActionResult from @/lib/auth/schemas
```

| Action | FormData fields | Notes |
|---|---|---|
| `createArea` | `name` | |
| `renameArea` | `areaId`, `name` | |
| `setAreaActive` | `areaId`, `active` (`'true'` \| `'false'`) | → `AREA_NOT_EMPTY` if the area still has active tables |
| `reorderAreas` | `areaIds` (repeated, the full new order) | |
| `createTable` | `areaId`, `label`, `capacity`, `shape` | → `PLAN_LIMIT` at `max_tables` |
| `updateTable` | `tableId`, `areaId`, `label`, `capacity`, `shape` | |
| `setTableActive` | `tableId`, `active` (`'true'` \| `'false'`) | reactivating also counts toward `PLAN_LIMIT` |
| `saveTablePositions` | `positions` = JSON `[{ tableId, posX, posY }]` (ints 0–999, ≤ 500 items) | floor plan task (later) |
| `rotateTableQr` | `tableId` | old printed codes stop working immediately |

## Errors

New members of `ActionErrorCode` in `lib/auth/schemas.ts`, added by DAVIN: **`DUPLICATE_NAME`**, **`AREA_NOT_EMPTY`**. Existing members reused: `PLAN_LIMIT` and `FORBIDDEN`.

Each result has `{ ok: false, code, formError }` with a friendly `formError`. `DUPLICATE_NAME` also sets `fieldErrors.name` (areas) or `fieldErrors.label` (tables). Zod validation errors come back in `fieldErrors`, keyed by the FormData names above.

## Side effects

Every mutation calls `updateTag('venue:{locationId}')` and writes an audit row via DB triggers. It also sends PostHog `area_created`, `table_created` and `table_qr_rotated`, with group = org and no PII and no tokens.
