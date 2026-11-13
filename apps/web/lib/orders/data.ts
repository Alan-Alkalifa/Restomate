import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { KotStatus, OrderStatus } from "./transitions";
import { assertLocation } from "./shared";

export type Channel = "dine_in" | "takeaway" | "qr" | "online";

export type PosModifier = { id: string; name: string; priceDelta: number };
export type PosModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PosModifier[] };
export type PosItem = {
  id: string; name: string; description: string | null; price: number; imagePath: string | null; dietaryTags: string[];
  variants: { id: string; name: string; priceDelta: number }[]; modifierGroups: PosModifierGroup[];
};
export type PosCatalog = { currency: string; categories: { id: string; name: string; items: PosItem[] }[] };

export type OrderSummary = {
  id: string; orderNumber: number; channel: Channel; status: OrderStatus; tableLabel: string | null;
  itemCount: number; subtotal: number; currency: string; createdAt: string; updatedAt: string;
};
export type OrderLine = {
  id: string; roundNo: number; name: string; variantName: string | null; quantity: number; unitPrice: number;
  modifiersTotal: number; lineTotal: number; note: string | null; status: "active" | "void"; voidReason: string | null;
  modifiers: { name: string; priceDelta: number }[];
};
export type OrderDetail = OrderSummary & {
  roundCount: number; discountTotal: number; customerName: string | null; guestCount: number | null;
  lines: OrderLine[]; discounts: { id: string; amount: number; reason: string; removed: boolean }[];
  tickets: { id: string; ticketNumber: number; status: KotStatus; stationId: string }[];
};
export type KdsTicket = {
  id: string; ticketNumber: number; orderNumber: number; tableLabel: string | null; stationId: string; status: KotStatus;
  createdAt: string; items: { id: string; name: string; variantName: string | null; quantity: number; modifiersText: string; note: string | null; status: "pending" | "ready" | "void" }[];
};

const sv = z.string();
const menuSchema = z.object({
  categories: z.array(z.object({
    id: sv, name: sv,
    items: z.array(z.object({
      id: sv, name: sv, description: sv.nullish(), price: z.number(), image_path: sv.nullish(), dietary_tags: z.array(sv).default([]),
      variants: z.array(z.object({ id: sv, name: sv, price_delta: z.number() })).default([]),
      modifier_groups: z.array(z.object({
        id: sv, name: sv, min_select: z.number(), max_select: z.number(),
        modifiers: z.array(z.object({ id: sv, name: sv, price_delta: z.number() })).nullish(),
      })).default([]),
    })),
  })).default([]),
}).nullable();

/**
 * POS menu: published, active items available at this location right now, with the effective price, variants and
 * modifier groups. Needs pos.use. Call inside <Suspense>. Prices here are for display; the server recomputes on send.
 */
export async function getPosCatalog(orgSlug: string, locationId: string): Promise<PosCatalog> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "pos.use");
  assertLocation(ctx, locationId);
  const supabase = await createClient();
  const [menuRes, locRes] = await Promise.all([
    supabase.rpc("get_public_menu", { org_slug: orgSlug, location_id: locationId }),
    supabase.from("locations").select("currency").eq("id", locationId).eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const menu = menuSchema.safeParse(menuRes.data);
  return {
    currency: locRes.data?.currency ?? "IDR",
    categories: (menu.success ? menu.data?.categories ?? [] : []).map((c) => ({
      id: c.id, name: c.name,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, description: i.description ?? null, price: i.price, imagePath: i.image_path ?? null, dietaryTags: i.dietary_tags,
        variants: i.variants.map((v) => ({ id: v.id, name: v.name, priceDelta: v.price_delta })),
        modifierGroups: i.modifier_groups.map((g) => ({
          id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
          modifiers: (g.modifiers ?? []).map((m) => ({ id: m.id, name: m.name, priceDelta: m.price_delta })),
        })),
      })),
    })),
  };
}

const ORDER_COLS = "id, order_number, channel, status, table_id, round_count, subtotal, discount_total, currency, customer_name, guest_count, created_at, updated_at";

async function tableLabels(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, locationId: string, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map<string, string>();
  const { data } = await supabase.from("tables").select("id, label").eq("organization_id", orgId).eq("location_id", locationId).in("id", wanted);
  return new Map((data ?? []).map((t) => [t.id, t.label]));
}

type OrderRow = {
  id: string; order_number: number; channel: string; status: string; table_id: string | null; round_count: number;
  subtotal: number; discount_total: number; currency: string; customer_name: string | null; guest_count: number | null;
  created_at: string; updated_at: string;
};
const summary = (o: OrderRow, label: string | null, itemCount: number): OrderSummary => ({
  id: o.id, orderNumber: o.order_number, channel: o.channel as Channel, status: o.status as OrderStatus, tableLabel: label,
  itemCount, subtotal: o.subtotal, currency: o.currency, createdAt: o.created_at, updatedAt: o.updated_at,
});

/** Live order board: open orders at a location, newest first. Needs orders.view. */
export async function getOpenOrders(
  orgSlug: string, locationId: string, filter: { channel?: Channel[]; status?: OrderStatus[] } = {},
): Promise<OrderSummary[]> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "orders.view");
  assertLocation(ctx, locationId);
  const supabase = await createClient();
  let q = supabase.from("orders").select(ORDER_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId)
    .not("status", "in", "(completed,cancelled)").order("created_at", { ascending: false }).limit(200);
  if (filter.channel?.length) q = q.in("channel", filter.channel);
  if (filter.status?.length) q = q.in("status", filter.status);
  const { data: orders } = await q;
  const rows = (orders ?? []) as OrderRow[];
  if (!rows.length) return [];
  const [labels, items] = await Promise.all([
    tableLabels(supabase, ctx.org.id, locationId, rows.map((o) => o.table_id)),
    supabase.from("order_items").select("order_id, quantity").eq("organization_id", ctx.org.id).eq("status", "active").in("order_id", rows.map((o) => o.id)),
  ]);
  const counts = new Map<string, number>();
  for (const i of items.data ?? []) counts.set(i.order_id, (counts.get(i.order_id) ?? 0) + i.quantity);
  return rows.map((o) => summary(o, o.table_id ? labels.get(o.table_id) ?? null : null, counts.get(o.id) ?? 0));
}

async function detail(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, locationId: string, o: OrderRow): Promise<OrderDetail> {
  const [labels, items, discounts, tickets] = await Promise.all([
    tableLabels(supabase, orgId, locationId, [o.table_id]),
    supabase.from("order_items").select("id, round_id, item_name, variant_name, quantity, unit_price, modifiers_total, line_total, note, status, void_reason, created_at")
      .eq("organization_id", orgId).eq("order_id", o.id).order("created_at"),
    supabase.from("order_discounts").select("id, amount, reason, removed_at").eq("organization_id", orgId).eq("order_id", o.id).order("created_at"),
    supabase.from("kitchen_tickets").select("id, ticket_number, status, kitchen_station_id").eq("organization_id", orgId).eq("order_id", o.id).order("ticket_number"),
  ]);
  const itemRows = items.data ?? [];
  const [rounds, mods] = await Promise.all([
    supabase.from("order_rounds").select("id, round_no").eq("order_id", o.id),
    itemRows.length
      ? supabase.from("order_item_modifiers").select("order_item_id, name, price_delta").eq("organization_id", orgId).in("order_item_id", itemRows.map((i) => i.id))
      : Promise.resolve({ data: [] as { order_item_id: string; name: string; price_delta: number }[] }),
  ]);
  const roundNo = new Map((rounds.data ?? []).map((r) => [r.id, r.round_no]));
  const modsByItem = new Map<string, { name: string; priceDelta: number }[]>();
  for (const m of mods.data ?? []) modsByItem.set(m.order_item_id, [...(modsByItem.get(m.order_item_id) ?? []), { name: m.name, priceDelta: m.price_delta }]);
  const lines: OrderLine[] = itemRows.map((i) => ({
    id: i.id, roundNo: roundNo.get(i.round_id) ?? 1, name: i.item_name, variantName: i.variant_name, quantity: i.quantity,
    unitPrice: i.unit_price, modifiersTotal: i.modifiers_total, lineTotal: i.line_total, note: i.note,
    status: i.status === "void" ? "void" : "active", voidReason: i.void_reason, modifiers: modsByItem.get(i.id) ?? [],
  }));
  return {
    ...summary(o, o.table_id ? labels.get(o.table_id) ?? null : null, lines.filter((l) => l.status === "active").reduce((n, l) => n + l.quantity, 0)),
    roundCount: o.round_count, discountTotal: o.discount_total, customerName: o.customer_name, guestCount: o.guest_count, lines,
    discounts: (discounts.data ?? []).map((d) => ({ id: d.id, amount: d.amount, reason: d.reason, removed: d.removed_at !== null })),
    tickets: (tickets.data ?? []).map((t) => ({ id: t.id, ticketNumber: t.ticket_number, status: t.status as KotStatus, stationId: t.kitchen_station_id })),
  };
}

/** One order with its lines, modifiers, discounts and tickets. Needs orders.view. */
export async function getOrder(orgSlug: string, locationId: string, orderId: string): Promise<OrderDetail | null> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "orders.view");
  assertLocation(ctx, locationId);
  if (!z.string().uuid().safeParse(orderId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select(ORDER_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId).eq("id", orderId).maybeSingle();
  return data ? detail(supabase, ctx.org.id, locationId, data as OrderRow) : null;
}

/** The open order on a table, if any. Needs orders.view. */
export async function getTableOrder(orgSlug: string, locationId: string, tableId: string): Promise<OrderDetail | null> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "orders.view");
  assertLocation(ctx, locationId);
  if (!z.string().uuid().safeParse(tableId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select(ORDER_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId)
    .eq("table_id", tableId).not("status", "in", "(completed,cancelled)").maybeSingle();
  return data ? detail(supabase, ctx.org.id, locationId, data as OrderRow) : null;
}

/**
 * Kitchen display: tickets that are not bumped, oldest first, no prices. `now` is the server time for the timers
 * (fixed 10/20 minute amber/red thresholds are applied by the client). Needs kitchen.view.
 */
export async function getKdsTickets(
  orgSlug: string, locationId: string, stationId?: string,
): Promise<{ now: string; tickets: KdsTicket[] }> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "kitchen.view");
  assertLocation(ctx, locationId);
  await connection(); // the server clock is read below: request time only
  const supabase = await createClient();
  let q = supabase.from("kitchen_tickets").select("id, order_id, ticket_number, kitchen_station_id, status, created_at")
    .eq("organization_id", ctx.org.id).eq("location_id", locationId).neq("status", "bumped").order("created_at").limit(200);
  if (stationId && z.string().uuid().safeParse(stationId).success) q = q.eq("kitchen_station_id", stationId);
  const { data: tickets } = await q;
  const rows = tickets ?? [];
  const now = new Date().toISOString();
  if (!rows.length) return { now, tickets: [] };
  const orderIds = [...new Set(rows.map((t) => t.order_id))];
  const [items, orders] = await Promise.all([
    supabase.from("kitchen_ticket_items").select("id, ticket_id, item_name, variant_name, quantity, modifiers_text, note, status")
      .eq("organization_id", ctx.org.id).in("ticket_id", rows.map((t) => t.id)),
    supabase.from("orders").select("id, order_number, table_id").eq("organization_id", ctx.org.id).in("id", orderIds),
  ]);
  const orderById = new Map((orders.data ?? []).map((o) => [o.id, o]));
  const labels = await tableLabels(supabase, ctx.org.id, locationId, (orders.data ?? []).map((o) => o.table_id));
  return {
    now,
    tickets: rows.map((t) => {
      const o = orderById.get(t.order_id);
      return {
        id: t.id, ticketNumber: t.ticket_number, orderNumber: o?.order_number ?? 0,
        tableLabel: o?.table_id ? labels.get(o.table_id) ?? null : null, stationId: t.kitchen_station_id,
        status: t.status as KotStatus, createdAt: t.created_at,
        items: (items.data ?? []).filter((i) => i.ticket_id === t.id).map((i) => ({
          id: i.id, name: i.item_name, variantName: i.variant_name, quantity: i.quantity, modifiersText: i.modifiers_text, note: i.note,
          status: i.status as "pending" | "ready" | "void",
        })),
      };
    }),
  };
}
