import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/*
 * KDS Realtime (docs/contracts/orders.md, "Realtime"): the PRIVATE broadcast channel `location:{locationId}`.
 *  - Private only: `config: { private: true }`. Authorization is the realtime.messages RLS policy (org member +
 *    location access + orders.view or kitchen.view), so another org or another location's staff receive nothing.
 *  - Events carry ids and statuses only. We never read them as data: every event is a SIGNAL to refetch through the
 *    RLS-filtered page query. A dropped, duplicated or reordered event is therefore harmless.
 *  - Realtime does not replay what was missed while offline: `onResync` fires on every re-join after a drop, refetch there.
 */
export type KitchenConnection = "connecting" | "connected" | "reconnecting" | "closed";
export const KITCHEN_EVENTS = ["ticket.changed", "ticket_item.changed", "order.changed"] as const;
export type KitchenEvent = (typeof KITCHEN_EVENTS)[number];

export type KitchenHandlers = {
  /** Any ticket/order event. Refetch (debounced by the caller). */
  onSignal: (event: KitchenEvent) => void;
  /** The channel re-joined after a drop (not the first connect): refetch, events may have been missed. */
  onResync: () => void;
  onStatus?: (status: KitchenConnection) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Client = Pick<SupabaseClient, "channel" | "removeChannel"> & { realtime?: { setAuth: (token?: string | null) => Promise<void> | void } };

/** Subscribe to one location. Returns the unsubscribe function (use it as the effect cleanup). */
export function subscribeKitchen(client: Client, locationId: string, handlers: KitchenHandlers): () => void {
  if (!UUID.test(locationId)) throw new Error("subscribeKitchen: locationId must be a uuid");
  let everConnected = false;
  let dropped = false;
  let closed = false;
  let channel: RealtimeChannel | null = null;

  const open = () => {
    if (closed) return;
    let ch = client.channel(`location:${locationId}`, { config: { private: true } });
    for (const event of KITCHEN_EVENTS) ch = ch.on("broadcast", { event }, () => handlers.onSignal(event));
    channel = ch.subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        handlers.onStatus?.("connected");
        if (everConnected && dropped) handlers.onResync();
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
  };

  handlers.onStatus?.("connecting");
  // A private channel needs the user's JWT on the realtime socket before it joins.
  Promise.resolve(client.realtime?.setAuth()).then(open, open);

  return () => {
    closed = true;
    if (channel) void client.removeChannel(channel);
    handlers.onStatus?.("closed");
  };
}
