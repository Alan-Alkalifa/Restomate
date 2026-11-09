import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { env, sendMock } = vi.hoisted(() => ({
  env: {
    EMAIL_DELIVERY: "log" as "log" | "resend",
    EMAIL_FROM: "Restomate <no-reply@mail.restomate.app>",
    RESEND_API_KEY: "re_secret_key" as string | undefined,
    NEXT_PUBLIC_APP_URL: "https://app.restomate.app",
  },
  sendMock: vi.fn(),
}));
vi.mock("../env.server", () => ({ serverEnv: env }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { resetResendForTests } from "./client";
import { send, maskEmail } from "./send";
import { buildSender, sanitizeDisplayName, sendStaffInvite } from "./staff-invite";

const react = <p>Hello</p>;
const baseProps = {
  restaurantName: "Demo Restaurant",
  inviterName: "Sari",
  roleName: "Cashier",
  locationNames: ["Main"],
  acceptUrl: "https://app.restomate.app/invite/abc",
  expiresAt: "2026-12-01T00:00:00Z",
  logoUrl: "https://cdn.example.com/logo.png",
  timeZone: "Asia/Makassar",
};

beforeEach(() => {
  env.EMAIL_DELIVERY = "log";
  env.RESEND_API_KEY = "re_secret_key";
  sendMock.mockReset();
  resetResendForTests();
  vi.restoreAllMocks();
});

describe("send (log mode)", () => {
  it("prints a masked recipient and never calls Resend", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await send({ to: "owner@demo.local", subject: "Hi", react, idempotencyKey: "k1" });
    expect(r.ok).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("o***@demo.local");
    expect(out).not.toContain("owner@demo.local");
    expect(out).toContain("Hello");
    expect(out).not.toContain("re_secret_key");
  });

  it("maskEmail handles odd input", () => {
    expect(maskEmail("a@b.c")).toBe("a***@b.c");
    expect(maskEmail("nonsense")).toBe("***");
  });
});

describe("send (resend mode)", () => {
  beforeEach(() => {
    env.EMAIL_DELIVERY = "resend";
  });

  it("passes the idempotency key and strips CR/LF from headers", async () => {
    sendMock.mockResolvedValue({ data: { id: "em_1" }, error: null });
    const r = await send({
      to: "a@b.co",
      subject: "Hi\r\nBcc: evil@x.com",
      react,
      replyTo: "r@b.co\nBcc: evil@x.com",
      idempotencyKey: "staff-invite/i1/1",
    });
    expect(r).toEqual({ ok: true, id: "em_1" });
    const [payload, opts] = sendMock.mock.calls[0];
    expect(opts).toEqual({ idempotencyKey: "staff-invite/i1/1" });
    expect(payload.subject).not.toMatch(/[\r\n]/);
    expect(payload.replyTo).not.toMatch(/[\r\n]/);
  });

  it("returns ok:false on API error without leaking the key", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockResolvedValue({ data: null, error: { name: "rate_limit", message: "slow down" } });
    const r = await send({ to: "a@b.co", subject: "s", react, idempotencyKey: "k" });
    expect(r).toEqual({ ok: false, error: "slow down" });
    expect(err.mock.calls.join(" ")).not.toContain("re_secret_key");
  });

  it("never throws when the SDK rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendMock.mockRejectedValue(new Error("network down"));
    await expect(send({ to: "a@b.co", subject: "s", react, idempotencyKey: "k" })).resolves.toEqual({
      ok: false,
      error: "network down",
    });
  });

  it("never throws when the API key is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.RESEND_API_KEY = undefined;
    const r = await send({ to: "a@b.co", subject: "s", react, idempotencyKey: "k" });
    expect(r.ok).toBe(false);
  });
});

describe("recipient validation", () => {
  const bad = ["a@b.co, c@d.eu", "a@b.co;c@d.eu", '"x" <a@b.co>', "X <a@b.co>", "", "   ", "not-an-email", "a@b", "a@b.co c@d.eu", "a@b.co\r\nBcc: c@d.eu"];
  it.each(["log", "resend"] as const)("rejects non-single addresses in %s mode without sending or throwing", async (mode) => {
    env.EMAIL_DELIVERY = mode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const to of bad) {
      await expect(send({ to, subject: "s", react, idempotencyKey: "k" })).resolves.toEqual({ ok: false, error: "invalid recipient" });
    }
    expect(sendMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const logged = err.mock.calls.join(" ");
    expect(logged).not.toContain("c@d.eu");
    expect(logged).not.toContain("a@b.co");
  });
  it("still sends a normal single address", async () => {
    env.EMAIL_DELIVERY = "resend";
    sendMock.mockResolvedValue({ data: { id: "em_9" }, error: null });
    await expect(send({ to: "guest+tag@example.com", subject: "s", react, idempotencyKey: "k" })).resolves.toEqual({ ok: true, id: "em_9" });
  });
});

describe("sender sanitising", () => {
  it("removes quotes, angle brackets, newlines", () => {
    expect(sanitizeDisplayName('Evil" <x@y.z>\r\nBcc: a@b.c')).toBe("Evil x@y.zBcc: a@b.c");
    expect(buildSender('A"B<C>\nD')).toBe('"ABCD via Restomate" <orders@mail.restomate.app>');
  });
  it("falls back when nothing is left", () => {
    expect(sanitizeDisplayName('"<>')).toBe("Restomate");
  });
});

describe("sendStaffInvite", () => {
  beforeEach(() => {
    env.EMAIL_DELIVERY = "resend";
    sendMock.mockResolvedValue({ data: { id: "em_2" }, error: null });
  });
  const call = (props = baseProps) =>
    sendStaffInvite({ organizationId: "org1", invitationId: "inv1", sendCount: 2, to: "s@demo.local", props });

  it("uses the guest sender, idempotency key format and org time zone", async () => {
    const r = await call();
    expect(r.ok).toBe(true);
    const [payload, opts] = sendMock.mock.calls[0];
    expect(payload.from).toBe('"Demo Restaurant via Restomate" <orders@mail.restomate.app>');
    expect(opts.idempotencyKey).toBe("staff-invite/inv1/2");
    expect(payload.react.props.timeZone).toBe("Asia/Makassar");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "https://evil.com/invite/x", "https://app.restomate.app.evil.com/invite/x"])(
    "rejects acceptUrl %s",
    async (acceptUrl) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await call({ ...baseProps, acceptUrl });
      expect(r.ok).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    },
  );

  it.each(["javascript:alert(1)", "data:image/png;base64,AAAA", "http://cdn.example.com/l.png", "not a url"])(
    "nulls logoUrl %s",
    async (logoUrl) => {
      await call({ ...baseProps, logoUrl });
      expect(sendMock.mock.calls[0][0].react.props.logoUrl).toBeNull();
    },
  );

  it("keeps an https logoUrl", async () => {
    await call();
    expect(sendMock.mock.calls[0][0].react.props.logoUrl).toBe("https://cdn.example.com/logo.png");
  });
});
