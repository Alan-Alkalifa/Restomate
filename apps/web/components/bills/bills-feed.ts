"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useOnline } from "@/components/pos/use-online";
import { createClient } from "@/lib/supabase/client";

/*
 * Bills Realtime (docs/contracts/bills.md, "Realtime"): the PRIVATE channel `location:{locationId}:payments`.
 * Events carry ids and statuses only, and are SIGNALS: each one re-runs the page's RLS-filtered query. A dropped,
 * duplicated or reordered event is harmless; a re-join refetches because Realtime does not replay what was missed.
 * Only payments.view holders may join (the realtime.messages policy); a waiter (bills.print only) never subscribes.
 */
export type PaymentsConnection = "connecting" | "connected" | "reconnecting" | "closed";
export const PAYMENT_EVENTS = ["bill.changed", "payment.changed", "cash_session.changed"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Client = Pick<SupabaseClient, "channel" | "removeChannel"> & { realtime?: { setAuth: (token?: string | null) => Promise<void> | void } };

export function subscribePayments(client: Client, locationId: string, h: { onSignal: () => void; onResync: () => void; onStatus?: (s: PaymentsConnection) => void }): () => void {
  if (!UUID.test(locationId)) throw new Error("subscribePayments: locationId must be a uuid");
  let everConnected = false, dropped = false, closed = false;
  let channel: RealtimeChannel | null = null;
  const open = () => {
    if (closed) return;
    let ch = client.channel(`location:${locationId}:payments`, { config: { private: true } });
    for (const event of PAYMENT_EVENTS) ch = ch.on("broadcast", { event }, () => h.onSignal());
    channel = ch.subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        h.onStatus?.("connected");
        if (everConnected && dropped) h.onResync();
        everConnected = true;
        dropped = false;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        dropped = true;
        h.onStatus?.("reconnecting");
      } else if (status === "CLOSED") {
        dropped = true;
        h.onStatus?.(everConnected ? "reconnecting" : "closed");
      }
    });
  };
  h.onStatus?.("connecting");
  Promise.resolve(client.realtime?.setAuth()).then(open, open); // a private channel needs the user's JWT first
  return () => {
    closed = true;
    if (channel) void client.removeChannel(channel);
    h.onStatus?.("closed");
  };
}

const POLL_MS = 15_000;

/** Keeps the server-rendered bill fresh: signals (debounced), re-join, back online, tab focus, and a polling fallback. */
export function useBillsFeed(locationId: string, live: boolean) {
  const router = useRouter();
  const online = useOnline();
  const [connection, setConnection] = useState<PaymentsConnection>("connecting");
  const [refreshing, startTransition] = useTransition();
  const refreshRef = useRef(() => {});
  useEffect(() => { refreshRef.current = () => startTransition(() => router.refresh()); }, [router]);

  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const signal = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => refreshRef.current(), 250); };
    const stop = subscribePayments(createClient(), locationId, { onSignal: signal, onResync: () => refreshRef.current(), onStatus: setConnection });
    const onVisible = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); if (timer) clearTimeout(timer); stop(); };
  }, [locationId, live]);

  const wasOnline = useRef(online);
  useEffect(() => { if (online && !wasOnline.current) refreshRef.current(); wasOnline.current = online; }, [online]);

  const connected = live ? connection === "connected" && online : online;
  useEffect(() => {
    if (!live || connected) return;
    const id = setInterval(() => { if (navigator.onLine) refreshRef.current(); }, POLL_MS);
    return () => clearInterval(id);
  }, [live, connected]);

  return { online, connection: live ? connection : ("closed" as PaymentsConnection), refreshing, refresh: () => refreshRef.current() };
}
