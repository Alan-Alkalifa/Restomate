import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class NotFound extends Error {}
type RpcReply = { data?: unknown; error?: { code?: string; message: string } | null };
const state = {
  admin: true,
  allowed: true,
  calls: [] as string[],
  rpcCalls: [] as [string, Record<string, unknown>][],
  rpc: {} as Record<string, RpcReply>,
  mail: { error: null as { message: string } | null, throws: false },
  mailArgs: [] as unknown[][],
  arcjetArgs: [] as unknown[],
};

vi.mock("@/lib/auth/dal", () => ({
  requirePlatformAdmin: async () => {
    if (!state.admin) throw new NotFound();
    return { id: "admin-1", email: "admin@x.test" };
  },
}));
vi.mock("@/lib/arcjet", () => ({
  ajAuth: { name: "auth" },
  protect: async (...args: unknown[]) => {
    state.calls.push("arcjet");
    state.arcjetArgs = args;
    return state.allowed ? { allowed: true } : { allowed: false, reason: "RATE_LIMITED" };
  },
}));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.example.test/" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push(`rpc:${fn}`);
      state.rpcCalls.push([fn, args]);
      return state.rpc[fn] ?? { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: () => ({
    auth: {
      resetPasswordForEmail: async (...args: unknown[]) => {
        state.calls.push("mail");
        state.mailArgs.push(args);
        if (state.mail.throws) throw new Error("network");
        return { error: state.mail.error };
      },
    },
  }),
}));
const capture = vi.fn();
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));

import { sendOwnerPasswordReset } from "./tenant-actions";
import { getTenantDetail } from "./tenant-detail";

const ORG = "0b0f3e0e-8f6b-4b43-9a53-3a3f3f3f3f3f";
const USER = "1c1f3e0e-8f6b-4b43-9a53-3a3f3f3f3f3f";
const EMAIL = "owner@secret.test";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  state.admin = true;
  state.allowed = true;
  state.calls = [];
  state.rpcCalls = [];
  state.rpc = { admin_prepare_owner_password_reset: { data: EMAIL, error: null } };
  state.mail = { error: null, throws: false };
  state.mailArgs = [];
  capture.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const usage = (u: number, l: number | null) => ({ used: u, limit: l });
const payload = {
  org: { id: ORG, name: "Demo", slug: "demo", status: "active", createdAt: "2026-01-01T00:00:00Z" },
  locations: [{ id: "l1", name: "Main", timezone: "Asia/Jakarta", currency: "IDR", isActive: true }],
  subscription: null,
  subscriptionHistory: [],
  usage: {
    max_locations: usage(1, 3),
    max_staff: usage(2, "4" as unknown as number),
    max_tables: usage(0, null),
    max_orders_per_month: usage(0, null),
  },
  owners: [{ userId: USER, name: null, email: EMAIL }],
  auditTrail: [],
};

describe("getTenantDetail", () => {
  it("is notFound for non-admins and never touches the database", async () => {
    state.admin = false;
    await expect(getTenantDetail(ORG)).rejects.toBeInstanceOf(NotFound);
    expect(state.rpcCalls).toEqual([]);
  });

  it("returns null for a non-uuid id without calling the RPC", async () => {
    await expect(getTenantDetail("not-a-uuid")).resolves.toBeNull();
    expect(state.rpcCalls).toEqual([]);
  });

  it("returns null for an unknown organization", async () => {
    state.rpc = { admin_get_tenant_detail: { data: null, error: null } };
    await expect(getTenantDetail(ORG)).resolves.toBeNull();
    expect(state.rpcCalls[0]).toEqual(["admin_get_tenant_detail", { org_id: ORG }]);
  });

  it("parses the payload (numeric strings become numbers)", async () => {
    state.rpc = { admin_get_tenant_detail: { data: payload, error: null } };
    const d = await getTenantDetail(ORG);
    expect(d?.usage.max_staff).toEqual({ used: 2, limit: 4 });
    expect(d?.owners[0].email).toBe(EMAIL);
  });

  it("throws on an RPC error", async () => {
    state.rpc = { admin_get_tenant_detail: { data: null, error: { message: "boom" } } };
    await expect(getTenantDetail(ORG)).rejects.toThrow(/getTenantDetail failed/);
  });
});

describe("sendOwnerPasswordReset", () => {
  it("is notFound for non-admins before anything else", async () => {
    state.admin = false;
    await expect(sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }))).rejects.toBeInstanceOf(NotFound);
    expect(state.calls).toEqual([]);
  });

  it("rejects malformed ids and unknown fields before Arcjet or the RPC", async () => {
    const bad = await sendOwnerPasswordReset(null, fd({ orgId: "x", userId: USER }));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.fieldErrors?.orgId).toBeTruthy();
    const extra = await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER, email: "a@b.test" }));
    expect(extra.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("returns RATE_LIMITED when Arcjet denies, without calling the RPC or sending mail", async () => {
    state.allowed = false;
    const r = await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }));
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(state.calls).toEqual(["arcjet"]);
  });

  it("calls Arcjet with no email, then the RPC, then the mail, and succeeds", async () => {
    const r = await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }));
    expect(r).toEqual({ ok: true });
    expect(state.calls).toEqual(["arcjet", "rpc:admin_prepare_owner_password_reset", "mail"]);
    expect(state.arcjetArgs).toHaveLength(1); // preset only, no opts.email
    expect(state.rpcCalls[0][1]).toEqual({ org_id: ORG, user_id: USER });
    expect(state.mailArgs[0][0]).toBe(EMAIL);
    expect(state.mailArgs[0][1]).toEqual({
      redirectTo: `https://app.example.test/auth/confirm?next=${encodeURIComponent("/reset-password")}`,
    });
  });

  it.each([
    [{ code: "42501", message: "FORBIDDEN" }, "FORBIDDEN"],
    [{ code: "P0001", message: "RATE_LIMITED" }, "RATE_LIMITED"],
    [{ code: "P0001", message: "NOT_AN_OWNER" }, "NOT_FOUND"],
  ])("maps RPC error %j to %s and sends no mail or event", async (error, code) => {
    state.rpc = { admin_prepare_owner_password_reset: { data: null, error } };
    const r = await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }));
    expect(r).toMatchObject({ ok: false, code });
    expect(state.mailArgs).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("gives a generic error for any other RPC failure", async () => {
    state.rpc = { admin_prepare_owner_password_reset: { data: null, error: { code: "XX000", message: "db down" } } };
    const r = await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }));
    expect(r).toEqual({ ok: false, formError: "Could not send the reset email. Try again." });
  });

  it("still reports ok when the provider rejects or throws (delivery is never revealed)", async () => {
    state.mail = { error: { message: `rate limit for ${EMAIL}` }, throws: false };
    expect(await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }))).toEqual({ ok: true });
    state.mail = { error: null, throws: true };
    expect(await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }))).toEqual({ ok: true });
  });

  it("sends only { orgId } to PostHog, and never logs the address", async () => {
    state.mail = { error: { message: "cooldown" }, throws: false };
    await sendOwnerPasswordReset(null, fd({ orgId: ORG, userId: USER }));
    expect(capture).toHaveBeenCalledWith("tenant_password_reset_sent", { distinctId: "admin-1", properties: { orgId: ORG } });
    expect(JSON.stringify(capture.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(EMAIL);
  });
});
