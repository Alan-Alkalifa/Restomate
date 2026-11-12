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

async function run(nodeEnv: string, host: string, path = "/", extra: Record<string, string> = {}, envOverride: Partial<typeof env> = {}) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  for (const k of ["VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL"]) vi.stubEnv(k, ""); // never leak the host machine's values
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
  for (const [k, v] of Object.entries({ ...env, ...envOverride })) vi.stubEnv(k, v);
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
    expect((await proxy(req("restomate.app", "/pricing"))).status).toBe(403);
    expect((await proxy(req("demo.restomate.app", "/"))).status).toBe(403);
    expect(shieldRequest).toHaveBeenCalledTimes(2);
    shieldRequest.mockClear();
    expect((await proxy(req("app.restomate.app", "/demo/pos"))).status).toBe(200);
    expect(shieldRequest).not.toHaveBeenCalled();
    // The DOKU webhook is excluded by the matcher, so the proxy never runs for it.
    expect(new RegExp(`^${config.matcher[0]}$`).test("/api/webhooks/doku")).toBe(false);
    vi.doUnmock("@/lib/arcjet");
  });

  describe("Vercel preview deployments (B1-T23)", () => {
    const DEPLOY = "restomate-staging-abc123-alan-alkalifas-projects.vercel.app";
    const BRANCH = "restomate-staging-git-feat-x-alan-alkalifas-projects.vercel.app";
    const preview = { VERCEL_ENV: "preview", VERCEL_URL: DEPLOY, VERCEL_BRANCH_URL: BRANCH };

    it("preview env: the deployment and branch hosts serve the app (/login, /, dashboard paths)", async () => {
      for (const host of [DEPLOY, BRANCH]) {
        expect((await run("production", host, "/login", preview)).status).toBe(200);
        expect((await run("production", host, "/", preview)).status).toBe(200);
        expect((await run("production", host, "/demo/pos", preview)).status).toBe(200);
      }
    });

    it("production env with the very same host stays 404 (unknown hosts are not served)", async () => {
      expect((await run("production", DEPLOY, "/login", { ...preview, VERCEL_ENV: "production" })).status).toBe(404);
      expect((await run("production", DEPLOY, "/login")).status).toBe(404); // no Vercel env at all
    });

    it("preview env does not open other hosts", async () => {
      expect((await run("production", "other-abc-alan-alkalifas-projects.vercel.app", "/login", preview)).status).toBe(404);
      expect((await run("production", "bistro.example.com", "/login", preview)).status).toBe(404);
    });

    it("a client-supplied X-Forwarded-Host cannot make an unknown host the app", async () => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      for (const [k, v] of Object.entries({ ...env, ...preview })) vi.stubEnv(k, v);
      const { proxy } = await import("./proxy");
      const spoof = new NextRequest("http://internal/login", { headers: { host: "bistro.example.com", "x-forwarded-host": DEPLOY } });
      expect((await proxy(spoof)).status).toBe(404);
    });

    it("tenant subdomains and /s/ paths are unchanged in a preview", async () => {
      const res = await run("production", "demo.restomate.app", "/menu", preview);
      expect(res.headers.get("x-middleware-rewrite")).toContain("/s/demo/menu");
      expect((await run("production", "admin.restomate.app", "/", preview)).status).toBe(404);
    });
  });

  describe("separate hosts (MCS-T04): the app host and the root domain each serve their own surface", () => {
    const loc = (res: Response) => res.headers.get("location");

    it("root domain serves the marketing pages (and /en), incl. signup and www", async () => {
      for (const path of ["/", "/features", "/pricing", "/signup", "/en", "/en/features", "/en/pricing", "/en/signup", "/pricing/"]) {
        expect((await run("production", "restomate.app", path)).status, path).toBe(200);
      }
      expect((await run("production", "www.restomate.app", "/pricing")).status).toBe(200);
    });

    it("root domain redirects everything else to the app host, keeping path and query", async () => {
      const cases: [string, string][] = [
        ["/login", "https://app.restomate.app/login"],
        ["/login?next=%2Fdemo%2Fpos", "https://app.restomate.app/login?next=%2Fdemo%2Fpos"],
        ["/en/login", "https://app.restomate.app/en/login"],
        ["/forgot-password", "https://app.restomate.app/forgot-password"],
        ["/invite/abc123", "https://app.restomate.app/invite/abc123"],
        ["/auth/confirm?token_hash=x&type=signup", "https://app.restomate.app/auth/confirm?token_hash=x&type=signup"],
        ["/onboarding", "https://app.restomate.app/onboarding"],
        ["/demo/pos", "https://app.restomate.app/demo/pos"],
        ["/demo/main/tables", "https://app.restomate.app/demo/main/tables"],
        ["/admin/tenants", "https://app.restomate.app/admin/tenants"],
      ];
      for (const [path, to] of cases) {
        const res = await run("production", "restomate.app", path);
        expect(res.status, path).toBe(307);
        expect(loc(res), path).toBe(to);
      }
    });

    it("app host serves auth, onboarding, dashboard, POS and admin", async () => {
      for (const path of ["/login", "/en/login", "/forgot-password", "/reset-password", "/invite/abc", "/auth/confirm", "/onboarding", "/demo", "/demo/pos", "/demo/main/menu", "/admin", "/admin/packages"]) {
        expect((await run("production", "app.restomate.app", path)).status, path).toBe(200);
      }
    });

    it("app host redirects marketing pages to the root domain", async () => {
      const cases: [string, string][] = [
        ["/pricing", "https://restomate.app/pricing"],
        ["/features", "https://restomate.app/features"],
        ["/signup", "https://restomate.app/signup"],
        ["/signup?plan=pro", "https://restomate.app/signup?plan=pro"],
        ["/en/pricing", "https://restomate.app/en/pricing"],
        ["/en/signup", "https://restomate.app/en/signup"],
      ];
      for (const [path, to] of cases) {
        const res = await run("production", "app.restomate.app", path);
        expect(res.status, path).toBe(307);
        expect(loc(res), path).toBe(to);
      }
    });

    it("the app host has no home page: / goes to the login (which sends a signed-in user to the dashboard)", async () => {
      const res = await run("production", "app.restomate.app", "/");
      expect(res.status).toBe(307);
      expect(new URL(loc(res)!).host).toBe("app.restomate.app");
      expect(new URL(loc(res)!).pathname).toBe("/login");
      expect(new URL(loc(await run("production", "app.restomate.app", "/en"))!).pathname).toBe("/en/login");
    });

    it("the storefront is reachable only through a tenant host: /s/* is a 404 on the root domain and the app host", async () => {
      expect((await run("production", "restomate.app", "/s/demo")).status).toBe(404);
      expect((await run("production", "app.restomate.app", "/s/demo/menu")).status).toBe(404);
      expect((await run("production", "app.restomate.app", "/s")).status).toBe(404);
    });

    it("tenant hosts are unchanged, including /en for the English storefront", async () => {
      const rw = async (path: string) => (await run("production", "demo.restomate.app", path)).headers.get("x-middleware-rewrite");
      expect(await rw("/")).toContain("/s/demo");
      expect(await rw("/menu")).toContain("/s/demo/menu");
      expect(await rw("/en")).toContain("/s/demo/en");
      expect(await rw("/en/t/abc123")).toContain("/s/demo/en/t/abc123");
      expect(await rw("/t/abc123")).toContain("/s/demo/t/abc123");
    });

    it("reserved and unknown hosts are still 404", async () => {
      expect((await run("production", "admin.restomate.app", "/")).status).toBe(404);
      expect((await run("production", "bistro.example.com", "/pricing")).status).toBe(404);
    });

    it("a redirect can only ever point at the configured hosts (no open redirect via the path)", async () => {
      for (const path of ["//evil.com/x", "///evil.com", "/\\evil.com"]) {
        const res = await run("production", "restomate.app", path);
        const target = loc(res);
        if (target) expect(new URL(target).host, path).toBe("app.restomate.app");
      }
    });

    it("an X-Forwarded-Host cannot move a request onto another surface", async () => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const { proxy } = await import("./proxy");
      const spoof = new NextRequest("http://internal/pricing", { headers: { host: "restomate.app", "x-forwarded-host": "app.restomate.app" } });
      expect((await proxy(spoof)).status).toBe(200);
    });

    it("no authorization in the proxy: the redirect decision ignores cookies and headers", async () => {
      vi.resetModules();
      vi.stubEnv("NODE_ENV", "production");
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const { proxy } = await import("./proxy");
      const withCookie = new NextRequest("http://internal/demo/pos", { headers: { host: "restomate.app", cookie: "sb-access-token=anything", authorization: "Bearer x" } });
      expect((await proxy(withCookie)).status).toBe(307);
    });

    it("static assets and the excluded routes are untouched", async () => {
      expect((await run("production", "restomate.app", "/logo.png")).status).toBe(200);
      expect((await run("production", "app.restomate.app", "/robots.txt")).status).toBe(200);
      vi.resetModules();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const { config } = await import("./proxy");
      const matcher = new RegExp(`^${config.matcher[0]}$`);
      expect(matcher.test("/api/webhooks/doku")).toBe(false);
      expect(matcher.test("/api/cron/guest-retention")).toBe(false);
      expect(matcher.test("/login")).toBe(true);
    });
  });

  describe("single-host fallback: today's behaviour when hosts cannot be separated", () => {
    const STAGING = "restomate-staging.vercel.app";
    const staging = { NEXT_PUBLIC_APP_URL: `https://${STAGING}`, NEXT_PUBLIC_ROOT_DOMAIN: STAGING };

    it("staging on a *.vercel.app root domain: marketing, auth, dashboard and /s/* all serve on the one host, no redirects", async () => {
      for (const path of ["/", "/pricing", "/signup", "/login", "/demo/pos", "/admin", "/s/demo"]) {
        const res = await run("production", STAGING, path, {}, staging);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("location"), path).toBeNull();
      }
    });

    it("local development (root domain localhost, same host for everything): no redirects", async () => {
      const dev = { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_ROOT_DOMAIN: "localhost" };
      for (const path of ["/", "/pricing", "/login", "/demo/pos", "/s/demo"]) {
        const res = await run("development", "localhost:3000", path, {}, dev);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("location"), path).toBeNull();
      }
    });

    it("app URL on the same host as the root domain: not separated", async () => {
      const same = { NEXT_PUBLIC_APP_URL: "https://restomate.app", NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" };
      for (const path of ["/", "/login", "/pricing", "/demo/pos"]) {
        const res = await run("production", "restomate.app", path, {}, same);
        expect(res.status, path).toBe(200);
      }
    });

    it("a Vercel preview deployment keeps single-host behaviour even with real-domain env vars", async () => {
      const DEPLOY = "restomate-staging-abc123-team.vercel.app";
      const preview = { VERCEL_ENV: "preview", VERCEL_URL: DEPLOY };
      for (const path of ["/pricing", "/login", "/demo/pos"]) {
        const res = await run("production", DEPLOY, path, preview);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("location"), path).toBeNull();
      }
    });
  });

  describe("hostSeparation / marketing canonicals", () => {
    const real = { NEXT_PUBLIC_APP_URL: "https://app.restomate.app", NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" };

    it("separated only for a real root domain with the app on a subdomain of it", async () => {
      const { hostSeparation } = await import("@/i18n/config");
      expect(hostSeparation(real)).toEqual({ appOrigin: "https://app.restomate.app", rootOrigin: "https://restomate.app" });
      expect(hostSeparation({ ...real, NEXT_PUBLIC_APP_URL: "https://app.restomate.app:8443" })?.rootOrigin).toBe("https://restomate.app:8443");
      for (const bad of [
        {}, { NEXT_PUBLIC_APP_URL: real.NEXT_PUBLIC_APP_URL }, { NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" },
        { ...real, NEXT_PUBLIC_ROOT_DOMAIN: "localhost" }, { ...real, NEXT_PUBLIC_ROOT_DOMAIN: "x.vercel.app" },
        { ...real, NEXT_PUBLIC_APP_URL: "https://restomate.app" }, { ...real, NEXT_PUBLIC_APP_URL: "not a url" },
        { ...real, NEXT_PUBLIC_APP_URL: "https://elsewhere.example.com" },
      ]) expect(hostSeparation(bad), JSON.stringify(bad)).toBeNull();
    });

    it("marketing canonical and hreflang are absolute on the root domain when separated; app and auth pages stay relative", async () => {
      for (const [k, v] of Object.entries(real)) vi.stubEnv(k, v);
      const { alternatesFor } = await import("@/i18n/config");
      expect(alternatesFor("id", "/pricing")).toEqual({
        canonical: "https://restomate.app/pricing",
        languages: { id: "https://restomate.app/pricing", en: "https://restomate.app/en/pricing", "x-default": "https://restomate.app/pricing" },
      });
      expect(alternatesFor("en", "/").canonical).toBe("https://restomate.app/en");
      expect(alternatesFor("id", "/signup").canonical).toBe("https://restomate.app/signup");
      expect(alternatesFor("id", "/login")).toEqual({ canonical: "/login", languages: { id: "/login", en: "/en/login", "x-default": "/login" } });
      expect(alternatesFor("en", "/forgot-password").canonical).toBe("/en/forgot-password");
    });

    it("unseparated (staging, local, unset): canonicals stay relative everywhere", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://restomate-staging.vercel.app");
      vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate-staging.vercel.app");
      const { alternatesFor } = await import("@/i18n/config");
      expect(alternatesFor("id", "/pricing").canonical).toBe("/pricing");
      expect(alternatesFor("en", "/pricing").languages.id).toBe("/pricing");
    });

    it("storefront canonical and hreflang: the tenant host when separated, /s/{slug} on a single host", async () => {
      for (const [k, v] of Object.entries(real)) vi.stubEnv(k, v);
      const { storefrontAlternates, tenantOrigin } = await import("@/i18n/config");
      expect(tenantOrigin("Demo")).toBe("https://demo.restomate.app");
      expect(storefrontAlternates("id", "demo")).toEqual({
        canonical: "https://demo.restomate.app/",
        languages: { id: "https://demo.restomate.app/", en: "https://demo.restomate.app/en", "x-default": "https://demo.restomate.app/" },
      });
      expect(storefrontAlternates("en", "demo", "/menu").canonical).toBe("https://demo.restomate.app/en/menu");
      expect(tenantOrigin("bad slug!")).toBeNull();
      expect(tenantOrigin("-x")).toBeNull();
      expect(() => storefrontAlternates("id", "bad slug!")).toThrow(RangeError); // never a URL built from an invalid host label
    });

    it("storefront canonicals on staging / local stay on the single host as /s/{slug}", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://restomate-staging.vercel.app");
      vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate-staging.vercel.app");
      const { storefrontAlternates, tenantOrigin } = await import("@/i18n/config");
      expect(tenantOrigin("demo")).toBeNull();
      expect(storefrontAlternates("id", "demo")).toEqual({
        canonical: "/s/demo", languages: { id: "/s/demo", en: "/s/demo/en", "x-default": "/s/demo" },
      });
      expect(storefrontAlternates("en", "demo", "/menu").canonical).toBe("/s/demo/en/menu");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost");
      expect(storefrontAlternates("id", "demo", "/t/abc").canonical).toBe("/s/demo/t/abc");
    });

    it("marketing path matching ignores a trailing slash and the /en prefix, and nothing else", async () => {
      const { isMarketingPath, isStorefrontPath } = await import("@/i18n/config");
      for (const p of ["/", "/pricing", "/pricing/", "/en", "/en/", "/en/pricing", "/signup", "/en/signup"]) expect(isMarketingPath(p), p).toBe(true);
      for (const p of ["/login", "/en/login", "/demo", "/demo/pos", "/admin", "/onboarding", "/pricing/extra", "/Pricing", "/auth/confirm"]) expect(isMarketingPath(p), p).toBe(false);
      expect(isStorefrontPath("/s")).toBe(true);
      expect(isStorefrontPath("/s/demo")).toBe(true);
      expect(isStorefrontPath("/signup")).toBe(false);
      expect(isStorefrontPath("/sales")).toBe(false);
    });
  });
});
