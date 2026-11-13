import { cleanNote, clampQty, findItem, unitPrice, validateSelection, type PublicItem, type PublicMenu, type Selection } from "./menu-model";

/*
 * Storefront cart. It lives in the guest's browser (localStorage), per tenant AND location, and stores IDS ONLY (item,
 * variant, modifiers, note, quantity), never a name or a price. On load it is re-validated against the CURRENT menu:
 * anything that was removed, sold out, or no longer satisfies its modifier rules is dropped and reported, and every price
 * shown is re-derived from the menu. The server re-validates and re-prices again at submission.
 */
export type StoredLine = { itemId: string; variantId: string | null; modifierIds: string[]; note: string; qty: number };
export type CartLine = StoredLine & { key: string; name: string; variantName: string | null; modifierNames: string[]; unitPrice: number };

export type DropReason = "unavailable" | "sold_out" | "options_changed";
export type Dropped = { itemId: string; name: string | null; reason: DropReason };

export const STORAGE_VERSION = 1;
export const storageKey = (tenant: string, locationId: string): string => `restomate:cart:v${STORAGE_VERSION}:${tenant}:${locationId}`;

/** Same dish, same options, same note = same line (quantities merge). Modifier order does not matter. */
export const lineKey = (l: Pick<StoredLine, "itemId" | "variantId" | "modifierIds" | "note">): string =>
  JSON.stringify([l.itemId, l.variantId, [...l.modifierIds].sort(), l.note]);

export type CartAction =
  | { type: "add"; item: PublicItem; selection: Selection; note: string; qty: number }
  | { type: "setQty"; key: string; qty: number }
  | { type: "remove"; key: string }
  | { type: "clear" }
  | { type: "replace"; lines: StoredLine[] };

const merge = (lines: StoredLine[]): StoredLine[] => {
  const out = new Map<string, StoredLine>();
  for (const l of lines) {
    const k = lineKey(l);
    const have = out.get(k);
    out.set(k, have ? { ...have, qty: clampQty(have.qty + l.qty) } : l);
  }
  return [...out.values()];
};

export function cartReducer(state: StoredLine[], a: CartAction): StoredLine[] {
  switch (a.type) {
    case "add": {
      // A sold-out item or an invalid selection can never enter the cart, whatever the UI did.
      if (a.item.soldOut || validateSelection(a.item, a.selection).length > 0) return state;
      return merge([...state, { itemId: a.item.id, variantId: a.selection.variantId, modifierIds: [...a.selection.modifierIds].sort(), note: cleanNote(a.note), qty: clampQty(a.qty) }]);
    }
    case "setQty":
      return a.qty <= 0 ? state.filter((l) => lineKey(l) !== a.key) : state.map((l) => (lineKey(l) === a.key ? { ...l, qty: clampQty(a.qty) } : l));
    case "remove":
      return state.filter((l) => lineKey(l) !== a.key);
    case "clear":
      return [];
    case "replace":
      return a.lines;
  }
}

/**
 * Re-validates stored lines against the current menu and prices them from it. Returns the lines that are still valid and
 * the ones that were dropped (so the UI can say so instead of silently losing them).
 */
export function revalidate(stored: readonly StoredLine[], menu: PublicMenu): { lines: CartLine[]; dropped: Dropped[] } {
  const lines: CartLine[] = [];
  const dropped: Dropped[] = [];
  for (const s of stored) {
    const item = findItem(menu, s.itemId);
    if (!item) { dropped.push({ itemId: s.itemId, name: null, reason: "unavailable" }); continue; }
    if (item.soldOut) { dropped.push({ itemId: s.itemId, name: item.name, reason: "sold_out" }); continue; }
    const sel: Selection = { variantId: s.variantId, modifierIds: s.modifierIds };
    if (validateSelection(item, sel).length > 0) { dropped.push({ itemId: s.itemId, name: item.name, reason: "options_changed" }); continue; }
    lines.push({
      ...s, qty: clampQty(s.qty), note: cleanNote(s.note), key: lineKey(s), name: item.name,
      variantName: item.variants.find((v) => v.id === s.variantId)?.name ?? null,
      modifierNames: item.modifierGroups.flatMap((g) => g.modifiers).filter((m) => s.modifierIds.includes(m.id)).map((m) => m.name),
      unitPrice: unitPrice(item, sel),
    });
  }
  // Two stored lines can become identical after a menu change: merge them.
  const byKey = new Map<string, CartLine>();
  for (const l of lines) { const have = byKey.get(l.key); byKey.set(l.key, have ? { ...have, qty: clampQty(have.qty + l.qty) } : l); }
  return { lines: [...byKey.values()], dropped };
}

/** Sum of item prices only. Service charge and tax are added by the server at checkout. */
export const itemsSubtotal = (lines: readonly Pick<CartLine, "unitPrice" | "qty">[]): number => lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
export const itemCount = (lines: readonly Pick<StoredLine, "qty">[]): number => lines.reduce((a, l) => a + l.qty, 0);

// ---- persistence (every access wrapped: private windows, blocked storage and quota errors must never break the page) ----
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const getStore = (): Store | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };

const isStoredLine = (x: unknown): x is StoredLine => {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return typeof l.itemId === "string" && (l.variantId === null || typeof l.variantId === "string")
    && Array.isArray(l.modifierIds) && l.modifierIds.every((m) => typeof m === "string")
    && typeof l.note === "string" && typeof l.qty === "number" && Number.isFinite(l.qty);
};

/** Parses what was stored, dropping anything malformed (a corrupt or hand-edited value yields an empty cart, never a throw). */
export function parseStored(raw: string | null): StoredLine[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return merge(data.filter(isStoredLine).slice(0, 100).map((l) => ({ ...l, note: cleanNote(l.note), qty: clampQty(l.qty), modifierIds: [...l.modifierIds].sort() })));
  } catch { return []; }
}

export function loadStored(tenant: string, locationId: string, store: Store | null = getStore()): StoredLine[] {
  try { return parseStored(store?.getItem(storageKey(tenant, locationId)) ?? null); } catch { return []; }
}
export function saveStored(tenant: string, locationId: string, lines: readonly StoredLine[], store: Store | null = getStore()): void {
  try {
    if (!store) return;
    if (lines.length === 0) store.removeItem(storageKey(tenant, locationId));
    else store.setItem(storageKey(tenant, locationId), JSON.stringify(lines));
  } catch { /* storage unavailable or full: the cart simply is not remembered */ }
}
