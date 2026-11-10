import { describe, expect, it } from "vitest";
import { normalizeHost, parseTenantOverride, resolveHost, tenantPath, vercelPreviewHosts } from "./host";

const ROOT = "restomate.app";

describe("resolveHost (production)", () => {
  it.each([
    ["restomate.app", { kind: "frontend" }],
    ["www.restomate.app", { kind: "frontend" }],
    ["app.restomate.app", { kind: "app" }],
    ["demo.restomate.app", { kind: "tenant", slug: "demo" }],
    ["DEMO.restomate.app:443", { kind: "tenant", slug: "demo" }],
    ["Other-Bistro.Restomate.App", { kind: "tenant", slug: "other-bistro" }],
    ["demo.restomate.app.", { kind: "tenant", slug: "demo" }],
    ["admin.restomate.app", { kind: "reserved", label: "admin" }],
    ["api.restomate.app", { kind: "reserved", label: "api" }],
    ["mail.restomate.app", { kind: "reserved", label: "mail" }],
    ["a.b.restomate.app", { kind: "custom", host: "a.b.restomate.app" }],
    ["-bad-.restomate.app", { kind: "custom", host: "-bad-.restomate.app" }],
    ["under_score.restomate.app", { kind: "custom", host: "under_score.restomate.app" }],
    ["evilrestomate.app", { kind: "custom", host: "evilrestomate.app" }],
    ["restomate.app.evil.com", { kind: "custom", host: "restomate.app.evil.com" }],
    ["bistro.example.com", { kind: "custom", host: "bistro.example.com" }],
    ["[::1]:3000", { kind: "custom", host: "" }],
    ["", { kind: "custom", host: "" }],
  ])("%s", (host, expected) => expect(resolveHost(host, ROOT)).toEqual(expected));

  it("handles null/undefined hosts", () => {
    expect(resolveHost(null, ROOT)).toEqual({ kind: "custom", host: "" });
    expect(resolveHost(undefined, ROOT)).toEqual({ kind: "custom", host: "" });
  });

  it("does not treat localhost as ours in production", () => {
    expect(resolveHost("demo.localhost:3000", ROOT)).toEqual({ kind: "custom", host: "demo.localhost" });
    expect(resolveHost("localhost:3000", ROOT)).toEqual({ kind: "custom", host: "localhost" });
  });
});

describe("resolveHost (local dev)", () => {
  const dev = { allowLocalhost: true };
  it.each([
    ["localhost:3000", { kind: "frontend" }],
    ["app.localhost:3000", { kind: "app" }],
    ["demo.localhost:3000", { kind: "tenant", slug: "demo" }],
    ["admin.localhost:3000", { kind: "reserved", label: "admin" }],
    ["restomate.app", { kind: "frontend" }],
  ])("%s", (host, expected) => expect(resolveHost(host, ROOT, dev)).toEqual(expected));
});

describe("helpers", () => {
  it("normalizeHost", () => {
    expect(normalizeHost("  DEMO.Restomate.App:8080 ")).toBe("demo.restomate.app");
    expect(normalizeHost(null)).toBe("");
  });
  it("parseTenantOverride", () => {
    expect(parseTenantOverride("Demo")).toBe("demo");
    expect(parseTenantOverride("admin")).toBeNull();
    expect(parseTenantOverride("a b")).toBeNull();
    expect(parseTenantOverride("")).toBeNull();
    expect(parseTenantOverride(null)).toBeNull();
  });
  it("tenantPath", () => {
    expect(tenantPath("demo", "/")).toBe("/s/demo");
    expect(tenantPath("demo", "/t/abc")).toBe("/s/demo/t/abc");
  });
});

describe("proxy matcher", () => {
  // Matcher is "/" + inner regex; compile the inner part like Next does (anchored).
  const inner = "((?!api/webhooks/doku|_next/static|_next/image|favicon\\.ico).*)";
  const re = new RegExp(`^/${inner}$`);
  it("skips webhook, next internals and favicon", () => {
    for (const p of ["/api/webhooks/doku", "/_next/static/x.js", "/_next/image", "/favicon.ico"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
  it("matches app routes", () => {
    for (const p of ["/", "/login", "/demo/pos", "/api/other"]) expect(re.test(p), p).toBe(true);
  });
});

describe("Vercel preview hosts (B1-T23)", () => {
  const DEPLOY = "restomate-staging-abc123-alan-alkalifas-projects.vercel.app";
  const BRANCH = "restomate-staging-git-feat-x-alan-alkalifas-projects.vercel.app";
  const preview = { VERCEL_ENV: "preview", VERCEL_URL: DEPLOY, VERCEL_BRANCH_URL: BRANCH };

  describe("vercelPreviewHosts", () => {
    it("returns this deployment's hosts only when VERCEL_ENV is exactly preview", () => {
      expect(vercelPreviewHosts(preview)).toEqual([DEPLOY, BRANCH]);
      for (const env of ["production", "development", "", "Preview", " preview", undefined]) {
        expect(vercelPreviewHosts({ ...preview, VERCEL_ENV: env })).toEqual([]);
      }
      expect(vercelPreviewHosts({})).toEqual([]);
    });
    it("accepts only plain *.vercel.app hostnames (no scheme, path, port, or other domains)", () => {
      for (const bad of ["https://x-abc.vercel.app", "x-abc.vercel.app/path", "x-abc.vercel.app:3000", "evil.example.com", "vercel.app",
        "x.vercel.app.evil.com", "-x.vercel.app", "x_y.vercel.app", "", " ", "localhost", "restomate.app"]) {
        expect(vercelPreviewHosts({ VERCEL_ENV: "preview", VERCEL_URL: bad, VERCEL_BRANCH_URL: bad })).toEqual([]);
      }
    });
    it("works with only one of the two variables set", () => {
      expect(vercelPreviewHosts({ VERCEL_ENV: "preview", VERCEL_URL: DEPLOY })).toEqual([DEPLOY]);
      expect(vercelPreviewHosts({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH })).toEqual([BRANCH]);
    });
  });

  describe("resolveHost with extraAppHosts", () => {
    const hosts = vercelPreviewHosts(preview);
    it("serves the deployment and branch hosts as the app (case and port insensitive)", () => {
      expect(resolveHost(DEPLOY, ROOT, { extraAppHosts: hosts })).toEqual({ kind: "app" });
      expect(resolveHost(BRANCH.toUpperCase(), ROOT, { extraAppHosts: hosts })).toEqual({ kind: "app" });
      expect(resolveHost(`${DEPLOY}:443`, ROOT, { extraAppHosts: hosts })).toEqual({ kind: "app" });
    });
    it("is an exact match only: other vercel.app hosts, sub/super-domains and lookalikes stay custom (404 in production)", () => {
      for (const h of ["other-project-abc-alan-alkalifas-projects.vercel.app", `x.${DEPLOY}`, `${DEPLOY}.evil.com`, `evil${DEPLOY}`, "vercel.app"]) {
        expect(resolveHost(h, ROOT, { extraAppHosts: hosts })).toEqual({ kind: "custom", host: h });
      }
    });
    it("without the option (production, or not a preview) the same host is custom", () => {
      expect(resolveHost(DEPLOY, ROOT)).toEqual({ kind: "custom", host: DEPLOY });
      expect(resolveHost(DEPLOY, ROOT, { extraAppHosts: [] })).toEqual({ kind: "custom", host: DEPLOY });
    });
    it("tenant subdomains, the root and app hosts are unchanged", () => {
      expect(resolveHost("demo.restomate.app", ROOT, { extraAppHosts: hosts })).toEqual({ kind: "tenant", slug: "demo" });
      expect(resolveHost("restomate.app", ROOT, { extraAppHosts: hosts })).toEqual({ kind: "frontend" });
      expect(resolveHost("app.restomate.app", ROOT, { extraAppHosts: hosts })).toEqual({ kind: "app" });
    });
  });
});
