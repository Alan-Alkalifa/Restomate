import { describe, expect, it, vi } from "vitest";
import { subscribeLocation } from "./subscribe-location";

const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function fakeClient() {
  const listeners: { cfg: { table: string; filter: string; event: string }; cb: (p: unknown) => void }[] = [];
  let statusCb: (s: string) => void = () => {};
  const channel = {
    on: vi.fn((_type: string, cfg: { table: string; filter: string; event: string }, cb: (p: unknown) => void) => { listeners.push({ cfg, cb }); return channel; }),
    subscribe: vi.fn((cb: (s: string) => void) => { statusCb = cb; return channel; }),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => "ok") };
  return { client: client as never, channel, listeners, status: (s: string) => statusCb(s), raw: client };
}

describe("subscribeLocation", () => {
  it("joins channel location:{id} and filters both tables to that location", () => {
    const f = fakeClient();
    subscribeLocation(f.client, LOC, {});
    expect(f.raw.channel).toHaveBeenCalledWith(`location:${LOC}`);
    expect(f.listeners.map((l) => [l.cfg.table, l.cfg.filter])).toEqual([
      ["location_menu_overrides", `location_id=eq.${LOC}`],
      ["tables", `location_id=eq.${LOC}`],
    ]);
  });
  it("rejects a malformed location id (no filter injection)", () => {
    const f = fakeClient();
    expect(() => subscribeLocation(f.client, "x,table=eq.1", {})).toThrow();
    expect(f.raw.channel).not.toHaveBeenCalled();
  });
  it("routes payloads to the right handler", () => {
    const f = fakeClient();
    const onOverride = vi.fn();
    const onTable = vi.fn();
    subscribeLocation(f.client, LOC, { onOverride, onTable });
    f.listeners[0]!.cb({ eventType: "UPDATE" });
    f.listeners[1]!.cb({ eventType: "INSERT" });
    expect(onOverride).toHaveBeenCalledWith({ eventType: "UPDATE" });
    expect(onTable).toHaveBeenCalledWith({ eventType: "INSERT" });
  });
  it("reports status and asks for a resync only after a drop and re-join, not on the first connect", () => {
    const f = fakeClient();
    const onStatus = vi.fn();
    const onResync = vi.fn();
    subscribeLocation(f.client, LOC, { onStatus, onResync });
    expect(onStatus).toHaveBeenLastCalledWith("connecting");
    f.status("SUBSCRIBED");
    expect(onStatus).toHaveBeenLastCalledWith("connected");
    expect(onResync).not.toHaveBeenCalled();
    f.status("SUBSCRIBED"); // a duplicate join without a drop is not a resync
    expect(onResync).not.toHaveBeenCalled();
    f.status("CHANNEL_ERROR");
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting");
    f.status("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(1);
    f.status("TIMED_OUT");
    f.status("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(2);
  });
  it("a CLOSED channel that never connected stays closed", () => {
    const f = fakeClient();
    const onStatus = vi.fn();
    subscribeLocation(f.client, LOC, { onStatus });
    f.status("CLOSED");
    expect(onStatus).toHaveBeenLastCalledWith("closed");
  });
  it("unsubscribe removes the channel and silences later statuses", () => {
    const f = fakeClient();
    const onStatus = vi.fn();
    const onResync = vi.fn();
    const off = subscribeLocation(f.client, LOC, { onStatus, onResync });
    f.status("SUBSCRIBED");
    off();
    expect(f.raw.removeChannel).toHaveBeenCalledWith(f.channel);
    onStatus.mockClear();
    f.status("CHANNEL_ERROR");
    f.status("SUBSCRIBED");
    expect(onStatus).not.toHaveBeenCalled();
    expect(onResync).not.toHaveBeenCalled();
  });
});
