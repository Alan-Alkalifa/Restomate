"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { subscribeLocation, type ConnectionStatus } from "@/lib/realtime/subscribe-location";
import { createClient } from "@/lib/supabase/client";
import { useOnline } from "./use-online";

const POLL_MS = 15_000;

/**
 * Keeps the POS grid in step with other screens at the same location. A change to a location menu row (for example
 * "sold out today" on another POS) arrives on the `menu:{locationId}` Realtime channel (#84); it is only a SIGNAL: the
 * page's RLS-filtered query is re-run (router.refresh), so a dropped or reordered event is harmless. Realtime does not
 * replay what was missed while offline, so a re-join, coming back online and returning to the tab all refetch too, and
 * while the channel is down a slow poll keeps the screen from going stale on bad Wi-Fi.
 */
export function usePosFeed(locationId: string) {
  const router = useRouter();
  const online = useOnline();
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [refreshing, startTransition] = useTransition();
  const refreshRef = useRef(() => {});
  useEffect(() => { refreshRef.current = () => startTransition(() => router.refresh()); }, [router]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const signal = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => refreshRef.current(), 250); };
    const stop = subscribeLocation(createClient(), locationId, { onOverride: signal, onResync: () => refreshRef.current(), onStatus: setConnection });
    const onVisible = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); if (timer) clearTimeout(timer); stop(); };
  }, [locationId]);

  const wasOnline = useRef(online);
  useEffect(() => { if (online && !wasOnline.current) refreshRef.current(); wasOnline.current = online; }, [online]);

  const live = online && connection === "connected";
  useEffect(() => {
    if (live) return;
    const id = setInterval(() => { if (navigator.onLine) refreshRef.current(); }, POLL_MS);
    return () => clearInterval(id);
  }, [live]);

  return { online, connection, refreshing, refresh: () => refreshRef.current() };
}
