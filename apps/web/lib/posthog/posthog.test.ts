import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const afterCbs: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterCbs.push(cb) }));
const capture = vi.fn();
const flush = vi.fn(async () => {});
vi.mock("posthog-node", () => ({ PostHog: class { capture = capture; flush = flush; } }));

import { EVENTS, EVENT_NAMES } from "./events";
import { sanitizeEvent, sanitizeUrl } from "./sanitize";

describe("events", () => {
  it("are snake_case object_action names", () => {
    for (const n of EVENT_NAMES) expect(n).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(EVENT_NAMES).toContain(EVENTS.signupStarted);
  });
});

describe("sanitizeUrl", () => {
  it.each([
    ["https://app.restomate.app/invite/abcDEF123_token?x=1", "https://app.restomate.app/invite/[token]?x=1"],
    ["/invite/secret-token", "/invite/[token]"],
    ["/invite/secret/extra", "/invite/[token]/extra"],
    ["/auth/confirm?token_hash=abc&type=signup&next=/demo", "/auth/confirm?type=signup"],
    ["/login?code=123&next=%2Finvite%2Fx&error=link_expired", "/login?error=link_expired"],
    ["https://x.test/reset-password?token=t#access_token=zzz&refresh_token=yyy", "https://x.test/reset-password"],
    ["/pricing", "/pricing"],
  ])("%s -> %s", (input, out) => expect(sanitizeUrl(input)).toBe(out));

  it("never leaks a token in any form", () => {
    for (const u of ["/invite/TOKEN123?token=TOKEN123", "https://a.b/invite/TOKEN123#TOKEN123", "/x?code=TOKEN123&token_hash=TOKEN123&next=TOKEN123"]) {
      expect(sanitizeUrl(u)).not.toContain("TOKEN123");
    }
  });
  it("sanitizeEvent scrubs URL properties and leaves others", () => {
    const e = sanitizeEvent({ properties: { $current_url: "https://a.b/invite/SECRET", $pathname: "/invite/SECRET", $referrer: "https://a.b/login?next=/invite/SECRET", other: "keep" } });
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(e?.properties?.other).toBe("keep");
    expect(sanitizeEvent(null)).toBeNull();
  });
});

describe("captureServer", () => {
  beforeEach(() => {
    capture.mockClear();
    flush.mockClear();
    afterCbs.length = 0;
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("is a no-op without a key and never throws", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const { captureServer } = await import("./server");
    expect(() => captureServer("signup_started", { distinctId: "u1" })).not.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });
  it("captures with the organization group, drops PII-like properties and flushes via after()", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const { captureServer } = await import("./server");
    captureServer("staff_invited", {
      distinctId: "user-1",
      organizationId: "org-1",
      properties: { roleKey: "cashier", count: 2, email: "a@b.c", inviteeName: "Ann", phoneNumber: "1", token: "t", ok: true },
    });
    expect(capture).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "staff_invited",
      properties: { roleKey: "cashier", count: 2, ok: true },
      groups: { organization: "org-1" },
    });
    await afterCbs[0]();
    expect(flush).toHaveBeenCalled();
  });
  it("ignores event names outside EVENTS", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const { captureServer } = await import("./server");
    // @ts-expect-error not an allowed event
    captureServer("random_event", { distinctId: "u" });
    expect(capture).not.toHaveBeenCalled();
  });
});
