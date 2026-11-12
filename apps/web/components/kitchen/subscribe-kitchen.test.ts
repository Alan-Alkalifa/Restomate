import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "./refresh-scheduler";
import { subscribeKitchen, type KitchenConnection } from "./subscribe-kitchen";

const LOC = "11111111-1111-4111-8111-111111111111";

function fakeClient() {
  const listeners: Record<string, () => void> = {};
  let statusCb: (s: string) => void = () => {};
  const channel = {
    on: vi.fn((_type: string, filter: { event: string }, cb: () => void) => { listeners[filter.event] = cb; return channel; }),
    subscribe: vi.fn((cb: (s: string) => void) => { statusCb = cb; return channel; }),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(), realtime: { setAuth: vi.fn(async () => {}) } };
  return { client, channel, listeners, status: (s: string) => statusCb(s) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("subscribeKitchen", () => {
  it("joins the PRIVATE location channel after setting auth, and listens to the three events", async () => {
    const f = fakeClient();
    subscribeKitchen(f.client as never, LOC, { onSignal: vi.fn(), onResync: vi.fn() });
    await flush();
    expect(f.client.realtime.setAuth).toHaveBeenCalled();
    expect(f.client.channel).toHaveBeenCalledWith(`location:${LOC}`, { config: { private: true } });
    expect(Object.keys(f.listeners).sort()).toEqual(["order.changed", "ticket.changed", "ticket_item.changed"]);
  });
  it("treats every event as a signal, never as data", async () => {
    const f = fakeClient();
    const onSignal = vi.fn();
    subscribeKitchen(f.client as never, LOC, { onSignal, onResync: vi.fn() });
    await flush();
    f.listeners["ticket.changed"]();
    f.listeners["order.changed"]();
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(["ticket.changed", "order.changed"]);
  });
  it("resyncs on a re-join after a drop, not on the first connect", async () => {
    const f = fakeClient();
    const onResync = vi.fn();
    const seen: KitchenConnection[] = [];
    subscribeKitchen(f.client as never, LOC, { onSignal: vi.fn(), onResync, onStatus: (s) => seen.push(s) });
    await flush();
    f.status("SUBSCRIBED");
    expect(onResync).not.toHaveBeenCalled();
    f.status("CHANNEL_ERROR");
    f.status("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(1);
    f.status("CLOSED");
    f.status("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["connecting", "connected", "reconnecting", "connected", "reconnecting", "connected"]);
  });
  it("unsubscribes cleanly and ignores late status callbacks", async () => {
    const f = fakeClient();
    const onStatus = vi.fn();
    const stop = subscribeKitchen(f.client as never, LOC, { onSignal: vi.fn(), onResync: vi.fn(), onStatus });
    await flush();
    stop();
    expect(f.client.removeChannel).toHaveBeenCalledWith(f.channel);
    onStatus.mockClear();
    f.status("SUBSCRIBED");
    expect(onStatus).not.toHaveBeenCalled();
  });
  it("rejects a location id that is not a uuid", () => {
    expect(() => subscribeKitchen(fakeClient().client as never, "not-a-uuid", { onSignal: vi.fn(), onResync: vi.fn() })).toThrow();
  });
});

describe("createRefreshScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("coalesces a burst into one call after the quiet period", () => {
    const fn = vi.fn();
    const s = createRefreshScheduler(fn, 250, 1000);
    s.schedule(); s.schedule(); s.schedule();
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a steady stream cannot starve the refetch: it fires by maxWait", () => {
    const fn = vi.fn();
    const s = createRefreshScheduler(fn, 250, 1000);
    for (let i = 0; i < 10; i++) { s.schedule(); vi.advanceTimersByTime(200); }
    expect(fn).toHaveBeenCalled();
  });
  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const s = createRefreshScheduler(fn);
    s.schedule(); s.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
