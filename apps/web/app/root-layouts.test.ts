import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is no app/layout.tsx: every top-level route group is its own root layout (so <html lang> can differ per
 * tree). A new group WITHOUT a root layout breaks `next build`, so this fails first with a clear message.
 */
const app = __dirname;
const topLevel = readdirSync(app, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "api");

describe("root layouts", () => {
  it("has no app/layout.tsx", () => {
    expect(existsSync(join(app, "layout.tsx"))).toBe(false);
  });
  it.each(topLevel.map((d) => d.name))("%s has a root layout that renders RootDocument", (name) => {
    const file = join(app, name, "layout.tsx");
    expect(existsSync(file), `app/${name}/layout.tsx is missing: add a root layout using <RootDocument lang=...>`).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("<RootDocument");
  });
  it("English tree is lang=en and the unprefixed auth tree is lang=id", () => {
    expect(readFileSync(join(app, "en", "layout.tsx"), "utf8")).toContain('lang="en"');
    expect(readFileSync(join(app, "(auth)", "layout.tsx"), "utf8")).toContain('lang="id"');
  });
});
