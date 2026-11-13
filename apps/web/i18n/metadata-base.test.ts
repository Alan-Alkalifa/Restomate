import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alternatesFor, metadataBase } from "./config";

describe("metadataBase (BUG-130-1: canonical and hreflang must be absolute)", () => {
  it("uses NEXT_PUBLIC_APP_URL, with no host hard-coded", () => {
    expect(metadataBase({ NEXT_PUBLIC_APP_URL: "https://app.example.test" })?.href).toBe("https://app.example.test/");
    expect(metadataBase({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })?.origin).toBe("http://localhost:3000");
  });
  it("never throws: unset or malformed gives undefined", () => {
    expect(metadataBase({})).toBeUndefined();
    expect(metadataBase({ NEXT_PUBLIC_APP_URL: "" })).toBeUndefined();
    expect(metadataBase({ NEXT_PUBLIC_APP_URL: "not a url" })).toBeUndefined();
  });
  it("a Vercel preview deployment uses its OWN host, not production", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://app.example.test", VERCEL_ENV: "preview", VERCEL_URL: "restomate-git-feat-x-team.vercel.app" };
    expect(metadataBase(env)?.href).toBe("https://restomate-git-feat-x-team.vercel.app/");
  });
  it("production and development ignore VERCEL_URL, and a malformed one is never trusted", () => {
    const prod = { NEXT_PUBLIC_APP_URL: "https://app.example.test", VERCEL_URL: "restomate-abc.vercel.app" };
    expect(metadataBase({ ...prod, VERCEL_ENV: "production" })?.href).toBe("https://app.example.test/");
    expect(metadataBase({ ...prod, VERCEL_ENV: "development" })?.href).toBe("https://app.example.test/");
    expect(metadataBase({ ...prod, VERCEL_ENV: "preview", VERCEL_URL: "evil.com/phish" })?.href).toBe("https://app.example.test/");
    expect(metadataBase({ ...prod, VERCEL_ENV: "preview", VERCEL_URL: "https://x.vercel.app" })?.href).toBe("https://app.example.test/");
  });
  it("resolves every marketing alternate to a full URL on that host (id, en and x-default)", () => {
    const base = metadataBase({ NEXT_PUBLIC_APP_URL: "https://app.example.test" })!;
    for (const path of ["/", "/features", "/pricing"]) {
      for (const locale of ["id", "en"] as const) {
        const a = alternatesFor(locale, path);
        const abs = [a.canonical, ...Object.values(a.languages)].map((u) => new URL(u, base).href);
        for (const u of abs) expect(u).toMatch(/^https:\/\/app\.example\.test\//);
        expect(new URL(a.languages["x-default"], base).href).toBe(new URL(path, base).href); // x-default = id
        expect(new URL(a.languages.en, base).pathname).toBe(path === "/" ? "/en" : `/en${path}`);
      }
    }
  });
});

describe("every root layout gets the base", () => {
  const app = join(__dirname, "..", "app");
  const groups = readdirSync(app, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "api");
  it("RootDocument's defaultMetadata sets metadataBase once", () => {
    const src = readFileSync(join(__dirname, "..", "components", "ui", "RootDocument.tsx"), "utf8");
    expect(src).toMatch(/defaultMetadata: Metadata = \{[\s\S]*metadataBase: metadataBase\(\)/);
  });
  it.each(groups.map((d) => d.name))("app/%s/layout.tsx uses defaultMetadata or sets metadataBase itself", (name) => {
    const src = readFileSync(join(app, name, "layout.tsx"), "utf8");
    expect(src, `app/${name}/layout.tsx would emit relative canonical/hreflang`).toMatch(/defaultMetadata|metadataBase/);
  });
});
