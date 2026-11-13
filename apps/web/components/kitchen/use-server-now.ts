"use client";

import { useEffect, useState } from "react";
import { clockOffset } from "./kitchen-model";

const TICK_MS = 5_000;

/**
 * "Now" for the timers, anchored to the SERVER clock in the payload, so a wrong tablet clock cannot make a ticket look
 * late. The first value is the payload's own `now` (identical on the server and in the browser: no hydration mismatch
 * and no Date.now() while rendering); it then advances with the device clock plus the offset measured at arrival.
 */
export function useServerNow(payloadNow: string): number {
  const [state, setState] = useState(() => ({ source: payloadNow, now: Date.parse(payloadNow) }));
  // A fresh payload resets the anchor (derived state: set during render, not in an effect).
  if (state.source !== payloadNow) setState({ source: payloadNow, now: Date.parse(payloadNow) });

  useEffect(() => {
    const offset = clockOffset(payloadNow, Date.now());
    const id = setInterval(() => setState((s) => ({ ...s, now: Date.now() + offset })), TICK_MS);
    return () => clearInterval(id);
  }, [payloadNow]);

  return state.now;
}
