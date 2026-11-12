/**
 * Coalesces a burst of Realtime signals into one refetch: runs `fn` `wait` ms after the LAST call, but never later than
 * `maxWait` ms after the FIRST one (so a steady stream of events cannot starve the screen). Pure timers, unit tested.
 */
export function createRefreshScheduler(fn: () => void, wait = 250, maxWait = 1000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let first = 0;
  const fire = () => {
    timer = null;
    first = 0;
    fn();
  };
  return {
    schedule() {
      const now = Date.now();
      if (timer) clearTimeout(timer);
      else first = now;
      timer = setTimeout(fire, Math.max(0, Math.min(wait, first + maxWait - now)));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      first = 0;
    },
  };
}
