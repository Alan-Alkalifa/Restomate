import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

/*
 * Per-location Realtime for client components (menu availability now, orders / KDS later).
 *
 * What is sent: Postgres Changes on `location_menu_overrides` and `tables`, filtered to ONE location.
 *  - RLS decides who receives what: a subscriber only gets rows they could select (member of the org AND with access
 *    to the location). Other orgs and location-scoped staff without access receive nothing.
 *  - `tables` is published with a column list that excludes qr_token / qr_rotated_at, so a token can never be in a
 *    payload. Do not widen that list (see migration 20261109120000_realtime_location.sql).
 *  - The channel name `menu:{id}` is only a label (the private order channel is `location:{id}`; the names must not collide in supabase-js); it grants nothing. Authorization is the table RLS.
 *
 * Reconnects (REQUIRED reading for callers): Realtime does not replay events missed while offline, and event order is
 * not guaranteed. Treat every event as a hint to refetch or merge by id, never as the source of truth. `onResync` fires
 * whenever the channel (re)joins after a drop; refetch the page data there (e.g. router.refresh() or your data hook).
 * Show a "reconnecting" state from `onStatus` (POS and KDS run on unstable Wi-Fi).
 *
 * Usage (in a client component's effect):
 *   useEffect(() => subscribeLocation(supabase, locationId, { onOverride: refetch, onTable: refetch, onResync: refetch }), [...]);
 */
export type OverrideRow = {
  id: string; organization_id: string; location_id: string; item_id: string; price_override: number | null;
  is_available: boolean; sold_out_until: string | null; kitchen_station_id: string | null; created_at: string; updated_at: string;
};
/** Exactly the published columns of public.tables (no qr_token). */
export type TableRow = {
  id: string; organization_id: string; location_id: string; area_id: string; label: string; capacity: number;
  status: "available" | "reserved" | "occupied" | "needs_cleaning"; pos_x: number | null; pos_y: number | null;
  shape: "square" | "round" | "rect"; is_active: boolean; updated_at: string;
};
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

export type LocationHandlers = {
  onOverride?: (payload: RealtimePostgresChangesPayload<OverrideRow>) => void;
  onTable?: (payload: RealtimePostgresChangesPayload<TableRow>) => void;
  /** Called on every re-join after a drop (not on the first connect): refetch, you may have missed events. */
  onResync?: () => void;
  onStatus?: (status: ConnectionStatus) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Subscribe to one location. Returns the unsubscribe function (use it as the effect cleanup). */
export function subscribeLocation(
  // Loosely typed on purpose: the generated Database type is not needed for payload handling.
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  locationId: string,
  handlers: LocationHandlers,
): () => void {
  if (!UUID.test(locationId)) throw new Error("subscribeLocation: locationId must be a uuid");
  const filter = `location_id=eq.${locationId}`;
  let everConnected = false;
  let dropped = false;
  let closed = false;

  const channel: RealtimeChannel = client
    .channel(`menu:${locationId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "location_menu_overrides", filter }, (p) =>
      handlers.onOverride?.(p as RealtimePostgresChangesPayload<OverrideRow>))
    .on("postgres_changes", { event: "*", schema: "public", table: "tables", filter }, (p) =>
      handlers.onTable?.(p as RealtimePostgresChangesPayload<TableRow>))
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        handlers.onStatus?.("connected");
        if (everConnected && dropped) handlers.onResync?.();
        everConnected = true;
        dropped = false;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        dropped = true;
        handlers.onStatus?.("reconnecting");
      } else if (status === "CLOSED") {
        dropped = true;
        handlers.onStatus?.(everConnected ? "reconnecting" : "closed");
      }
    });
  handlers.onStatus?.("connecting");

  return () => {
    closed = true;
    void client.removeChannel(channel);
    handlers.onStatus?.("closed");
  };
}
