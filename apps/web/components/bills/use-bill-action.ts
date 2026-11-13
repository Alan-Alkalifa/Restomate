"use client";

import { useActionState } from "react";
import type { BillAction, BillActionResult, createAttemptTracker } from "./bills-model";

type Tracker = ReturnType<typeof createAttemptTracker>;

/** Canonical form of a request (sorted fields, `clientRef` left out): the same body must keep the same clientRef. */
export function canonicalBody(fd: FormData): string {
  return JSON.stringify([...fd.entries()].filter(([k]) => k !== "clientRef").map(([k, v]) => [k, String(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Runs a bound Server Action with `useActionState`.
 *  - With a `tracker`, `clientRef` is added here: one per attempt, REUSED when the same request is retried (flaky Wi-Fi),
 *    new only when the request changes, reset after a success. The server replays a repeated clientRef safely.
 *  - A network failure (offline, dropped request) must not crash the screen: it becomes an inline "try again" result
 *    and keeps the clientRef, so the retry is the same attempt.
 */
export function useBillAction<T = null>(action: BillAction<T>, opts: { tracker?: Tracker; onOk?: (data: T) => void } = {}) {
  return useActionState<BillActionResult<T> | null, FormData>(async (prev, fd) => {
    if (opts.tracker) fd.set("clientRef", opts.tracker.refFor(canonicalBody(fd)));
    try {
      const result = await action(prev, fd);
      if (result.ok) {
        opts.tracker?.reset();
        opts.onOk?.(result.data);
      }
      return result;
    } catch {
      return { ok: false, code: "NETWORK" } as const;
    }
  }, null);
}
