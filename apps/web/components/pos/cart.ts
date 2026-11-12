import { unitPrice, validateSelection, type PosCatalog, type PosItem, type Selection } from "./pos-model";

export const MAX_QTY = 99;
export const MAX_NOTE = 200;
export type OrderType = "dine_in" | "takeaway";

export type CartLine = {
  key: string; itemId: string; name: string;
  variantId: string | null; variantName: string | null;
  modifiers: { id: string; name: string; priceDelta: number }[];
  note: string; qty: number;
  /** Display only. The server recomputes every price at submit. */
  unitPrice: number;
};
export type CartState = { lines: CartLine[]; orderType: OrderType };
export const emptyCart: CartState = { lines: [], orderType: "dine_in" };

export type CartAction =
  | { type: "add"; item: PosItem; selection: Selection; note: string; qty: number }
  | { type: "setQty"; key: string; qty: number }
  | { type: "setNote"; key: string; note: string }
  | { type: "remove"; key: string }
  | { type: "clear" }
  | { type: "setOrderType"; orderType: OrderType }
  | { type: "replace"; state: CartState };

const clampQty = (q: number) => Math.min(MAX_QTY, Math.max(1, Math.floor(q) || 1));
const cleanNote = (n: string) => n.trim().slice(0, MAX_NOTE);
const lineKey = (itemId: string, variantId: string | null, modifierIds: string[], note: string) =>
  [itemId, variantId ?? "", [...modifierIds].sort().join(","), note].join("|");

function merge(lines: CartLine[]): CartLine[] {
  const out: CartLine[] = [];
  for (const l of lines) {
    const same = out.find((o) => o.key === l.key);
    if (same) same.qty = Math.min(MAX_QTY, same.qty + l.qty);
    else out.push({ ...l });
  }
  return out;
}

export function cartReducer(state: CartState, a: CartAction): CartState {
  switch (a.type) {
    case "add": {
      if (a.item.soldOut || validateSelection(a.item, a.selection).length > 0) return state; // an invalid line can never be added
      const variant = a.item.variants.find((v) => v.id === a.selection.variantId) ?? null;
      const modifiers = a.item.groups.flatMap((g) => g.modifiers).filter((m) => a.selection.modifierIds.includes(m.id));
      const note = cleanNote(a.note);
      const line: CartLine = {
        key: lineKey(a.item.id, variant?.id ?? null, modifiers.map((m) => m.id), note), itemId: a.item.id, name: a.item.name,
        variantId: variant?.id ?? null, variantName: variant?.name ?? null, modifiers, note, qty: clampQty(a.qty),
        unitPrice: unitPrice(a.item, a.selection),
      };
      return { ...state, lines: merge([...state.lines, line]) };
    }
    case "setQty":
      return { ...state, lines: a.qty <= 0 ? state.lines.filter((l) => l.key !== a.key) : state.lines.map((l) => (l.key === a.key ? { ...l, qty: clampQty(a.qty) } : l)) };
    case "setNote":
      return { ...state, lines: merge(state.lines.map((l) => {
        if (l.key !== a.key) return l;
        const note = cleanNote(a.note);
        return { ...l, note, key: lineKey(l.itemId, l.variantId, l.modifiers.map((m) => m.id), note) };
      })) };
    case "remove":
      return { ...state, lines: state.lines.filter((l) => l.key !== a.key) };
    case "clear":
      return { ...state, lines: [] };
    case "setOrderType":
      return { ...state, orderType: a.orderType };
    case "replace":
      return a.state;
  }
}

/** Display-only "Estimated" total. Never posted. */
export const estimatedTotal = (s: CartState) => s.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
export const itemCount = (s: CartState) => s.lines.reduce((n, l) => n + l.qty, 0);

const storageKey = (locationId: string) => `restomate:pos-cart:${locationId}`;

/**
 * Rebuilds a stored cart against the current catalog: lines whose item is gone, sold out or no longer valid are
 * dropped, and names and prices are re-read from the catalog (a stale stored price is never trusted).
 */
export function sanitizeCart(raw: unknown, catalog: PosCatalog): CartState {
  if (typeof raw !== "object" || raw === null) return emptyCart;
  const r = raw as { lines?: unknown; orderType?: unknown };
  const orderType: OrderType = r.orderType === "takeaway" ? "takeaway" : "dine_in";
  let state: CartState = { lines: [], orderType };
  if (!Array.isArray(r.lines)) return state;
  for (const l of r.lines.slice(0, 100)) {
    if (typeof l !== "object" || l === null) continue;
    const x = l as { itemId?: unknown; variantId?: unknown; modifiers?: unknown; note?: unknown; qty?: unknown };
    const item = catalog.items.find((i) => i.id === x.itemId);
    if (!item) continue;
    const selection: Selection = {
      variantId: typeof x.variantId === "string" ? x.variantId : null,
      modifierIds: Array.isArray(x.modifiers) ? x.modifiers.map((m) => (m as { id?: unknown })?.id).filter((id): id is string => typeof id === "string") : [],
    };
    state = cartReducer(state, { type: "add", item, selection, note: typeof x.note === "string" ? x.note : "", qty: typeof x.qty === "number" ? x.qty : 1 });
  }
  return state;
}

export function loadCart(locationId: string, catalog: PosCatalog): CartState {
  try {
    const text = window.localStorage.getItem(storageKey(locationId));
    return text ? sanitizeCart(JSON.parse(text), catalog) : emptyCart;
  } catch {
    return emptyCart; // storage blocked, or the stored value is not JSON
  }
}

export function saveCart(locationId: string, state: CartState): void {
  try {
    if (state.lines.length === 0) window.localStorage.removeItem(storageKey(locationId));
    else window.localStorage.setItem(storageKey(locationId), JSON.stringify({ lines: state.lines, orderType: state.orderType }));
  } catch {
    // Works without storage: the cart just isn't persisted.
  }
}
