"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOnline } from "@/components/pos/use-online";
import { createRefreshScheduler } from "./refresh-scheduler";
import { subscribeKitchen, type KitchenConnection } from "./subscribe-kitchen";

/** While the channel is down, poll the page data this often (the screen must not go stale on bad Wi-Fi). */
const POLL_MS = 15_000;

/**
 * Keeps the server-rendered ticket list fresh. Realtime events are only signals: each one (debounced) re-runs the page's
 * RLS-filtered query via router.refresh(), and so does a reconnect, coming back online, and returning to the tab.
 * Event order is never assumed because the refetch is the source of truth.
 */
export function useKitchenFeed(locationId: string) {
  const router = useRouter();
  const online = useOnline();
  const [connection, setConnection] = useState<KitchenConnection>("connecting");
  const [refreshing, startTransition] = useTransition();
  const refreshRef = useRef(() => {});
  useEffect(() => {
    refreshRef.current = () => startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const scheduler = createRefreshScheduler(() => refreshRef.current());
    const supabase = createClient();
    const unsubscribe = subscribeKitchen(supabase, locationId, {
      onSignal: () => scheduler.schedule(),
      onResync: () => refreshRef.current(),
      onStatus: setConnection,
    });
    const onVisible = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      scheduler.cancel();
      unsubscribe();
    };
  }, [locationId]);

  // Coming back online: refetch right away.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) refreshRef.current();
    wasOnline.current = online;
  }, [online]);

  // Fallback while the channel is not connected (or we are offline-then-online and it has not re-joined yet).
  const live = connection === "connected" && online;
  useEffect(() => {
    if (live) return;
    const id = setInterval(() => { if (navigator.onLine) refreshRef.current(); }, POLL_MS);
    return () => clearInterval(id);
  }, [live]);

  return { connection, online, refreshing, refresh: () => refreshRef.current() };
}
