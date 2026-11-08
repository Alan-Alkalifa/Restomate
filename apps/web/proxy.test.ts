import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// These tests exercise host routing, not Arcjet: no key, so the shield is a no-op (the full production env is not set here).
vi.mock("@/lib/env.server", () => ({ serverEnv: { ARCJET_KEY: undefined } }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn(async () => new Response(null, { status: 200 })) }));

const env = {
  NEXT_PUBLIC_APP_URL: "https://app.restomate.app",
  NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

function req(host: string, path = "/") {
  return new NextRequest(`http://internal${path}`, { headers: { host } });
}

async function run(nodeEnv: string, host: string, path = "/") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { proxy } = await import("./proxy");
  return proxy(req(host, path));
}

vi.setConfig({ testTimeout: 30_000 }); // dynamic imports are slow when the whole suite runs in parallel

describe("proxy", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("production: unknown (custom) host gets 404 until custom_domains exist", async () => {
    expect((await run("production", "bistro.example.com")).status).toBe(404);
    expect((await run("production", "restomate.app.evil.com")).status).toBe(404);
    expect((await run("production", "localhost:3000")).status).toBe(404);
  });

  it("development: unknown host stays permissive (session refresh path)", async () => {
    expect((await run("development", "bistro.example.com")).status).toBe(200);
  });

  it("production: known hosts are served", async () => {
    expect((await run("production", "restomate.app")).status).toBe(200);
    expect((await run("production", "app.restomate.app", "/demo/pos")).status).toBe(200);
  });

  it("reserved subdomains are 404 in every environment", async () => {
    expect((await run("production", "admin.restomate.app")).status).toBe(404);
    expect((await run("development", "api.restomate.app")).status).toBe(404);
  });

  it("tenant hosts are rewritten to /s/{slug}", async () => {
    const res = await run("production", "DEMO.restomate.app:443", "/menu");
    expect(res.headers.get("x-middleware-rewrite")).toContain("/s/demo/menu");
  });

  it("dev ?__tenant fallback rewrites; production ignores it", async () => {
    const dev = await run("development", "localhost:3000", "/?__tenant=demo");
    expect(dev.headers.get("x-middleware-rewrite")).toContain("/s/demo");
    const prod = await run("production", "restomate.app", "/?__tenant=demo");
    expect(prod.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("static assets pass straight through", async () => {
    const res = await run("production", "bistro.example.com", "/logo.png");
    expect(res.status).toBe(200);
  });

  it("arcjet shield: denied public/tenant requests get 403; app areas and the webhook are never shielded", async () => {
    vi.resetModules();
    const shieldRequest = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    vi.doMock("@/lib/arcjet", async () => ({ ...(await vi.importActual<object>("@/lib/arcjet")), shieldRequest }));
    vi.stubEnv("NODE_ENV", "production");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { proxy, config } = await import("./proxy");
    expect((await proxy(req("restomate.app", "/login"))).status).toBe(403);
    expect((await proxy(req("demo.restomate.app", "/"))).status).toBe(403);
    expect(shieldRequest).toHaveBeenCalledTimes(2);
    shieldRequest.mockClear();
    expect((await proxy(req("app.restomate.app", "/demo/pos"))).status).toBe(200);
    expect(shieldRequest).not.toHaveBeenCalled();
    // The DOKU webhook is excluded by the matcher, so the proxy never runs for it.
    expect(new RegExp(`^${config.matcher[0]}$`).test("/api/webhooks/doku")).toBe(false);
    vi.doUnmock("@/lib/arcjet");
  });
});
