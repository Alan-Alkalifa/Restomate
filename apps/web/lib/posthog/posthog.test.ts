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
    ["https://app.restomate.app/invite/abcDEF123_token?x=1", "https://app.restomate.app/invite/[token]"],
    ["/invite/secret-token", "/invite/[token]"],
    ["/invite/secret/extra", "/invite/[token]/extra"],
    ["/t/abc", "/t/[token]"],
    ["/%74/abc", "/t/[token]"],
    ["/invit%65/abc%20d", "/invite/[token]"],
    ["/s/demo/%74/abc", "/s/demo/t/[token]"],
    ["/bad%ZZ/x", "/bad%ZZ/x"],
    ["/s/demo/t/abc", "/s/demo/t/[token]"],
    ["https://demo.restomate.app/t/abc?table=5", "https://demo.restomate.app/t/[token]"],
    ["/auth/confirm?token_hash=abc&type=signup&next=/demo", "/auth/confirm"],
    ["/login?code=123&next=%2Finvite%2Fx&error=link_expired", "/login"],
    ["/signup?email=a%40b.co&phone=0812&utm_source=ig&utm_campaign=x&ref=friend&newparam=1", "/signup?utm_source=ig&utm_campaign=x&ref=friend"],
    ["https://x.test/reset-password?token=t#access_token=zzz&refresh_token=yyy", "https://x.test/reset-password"],
    ["https://user:pw@x.test/pricing", "https://x.test/pricing"],
    ["/pricing", "/pricing"],
    ["$direct", "$direct"],
    ["not a url", "[invalid-url]"],
    ["?email=a@b.co", "[invalid-url]"],
  ])("%s -> %s", (input, out) => expect(sanitizeUrl(input)).toBe(out));

  it("never leaks a token in any form", () => {
    for (const u of ["/invite/TOKEN123?token=TOKEN123", "https://a.b/invite/TOKEN123#TOKEN123", "/x?code=TOKEN123&token_hash=TOKEN123&next=TOKEN123", "/s/d/t/TOKEN123?email=TOKEN123"]) {
      expect(sanitizeUrl(u)).not.toContain("TOKEN123");
    }
  });
});

describe("sanitizeEvent", () => {
  it("scrubs every URL-like property including $prev_pageview_* and leaves others", () => {
    const e = sanitizeEvent({
      properties: {
        $current_url: "https://a.b/invite/SECRET?email=SECRET",
        $pathname: "/s/demo/t/SECRET",
        $referrer: "https://a.b/login?next=/invite/SECRET",
        $prev_pageview_pathname: "/invite/SECRET",
        $prev_pageview_url: "https://a.b/t/SECRET?phone=SECRET",
        $initial_referrer: "$direct",
        $last_external_referrer_href: "https://a.b/invite/SECRET",
        some_custom_url: "/t/SECRET",
        other: "keep",
        nested: { landing_href: "/invite/SECRET" },
      },
      $set: { $current_url: "/invite/SECRET" },
      $set_once: { $initial_current_url: "https://a.b/t/SECRET" },
    } as { properties: Record<string, unknown> });
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(e?.properties?.other).toBe("keep");
    expect(e?.properties?.$initial_referrer).toBe("$direct");
    expect(sanitizeEvent(null)).toBeNull();
  });
});

describe("posthog-js init options", () => {
  it("turns off autocapture and recording and masks text/attributes", async () => {
    vi.doMock("posthog-js", () => ({ default: { init: vi.fn() } }));
    const { POSTHOG_OPTIONS } = await import("./client");
    expect(POSTHOG_OPTIONS.autocapture).toBe(false);
    expect(POSTHOG_OPTIONS.disable_session_recording).toBe(true);
    expect(POSTHOG_OPTIONS.mask_all_text).toBe(true);
    expect(POSTHOG_OPTIONS.mask_all_element_attributes).toBe(true);
    expect(POSTHOG_OPTIONS.capture_heatmaps).toBe(false);
    const out = POSTHOG_OPTIONS.before_send({ properties: { $prev_pageview_pathname: "/invite/SECRET" } } as never) as { properties: Record<string, string> };
    expect(out.properties.$prev_pageview_pathname).toBe("/invite/[token]");
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
  it("sanitises URL-like properties too", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const { captureServer } = await import("./server");
    captureServer("staff_invited", { distinctId: "u", properties: { page_url: "https://a.b/invite/SECRET?email=x", ok: true } });
    expect(capture.mock.calls[0][0].properties).toEqual({ page_url: "https://a.b/invite/[token]", ok: true });
  });
  it("ignores event names outside EVENTS", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const { captureServer } = await import("./server");
    // @ts-expect-error not an allowed event
    captureServer("random_event", { distinctId: "u" });
    expect(capture).not.toHaveBeenCalled();
  });
});
