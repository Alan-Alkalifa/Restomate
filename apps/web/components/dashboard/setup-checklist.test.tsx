import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupChecklist } from "./SetupChecklist";
import type { SetupProgress, SetupStepKey } from "@/lib/onboarding/progress";

const KEYS: SetupStepKey[] = ["location", "tables", "menu", "staff", "branding"];
const HREF: Record<SetupStepKey, string> = { location: "settings", tables: "loc-1/tables", menu: "menu", staff: "staff", branding: "settings" };
const make = (done: SetupStepKey[], linked = true): SetupProgress => ({
  steps: KEYS.map((key) => ({ key, done: done.includes(key), href: linked ? HREF[key] : null })),
  completed: done.length, total: 5,
});

describe("SetupChecklist", () => {
  it("partial: progress line, five rows, text state, links prefixed with the org slug", () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={make(["location", "menu"])} orgSlug="demo" />);
    expect(html).toContain("2 of 5 done");
    expect(html).toContain('aria-valuenow="2"');
    expect(html.match(/<li /g)).toHaveLength(5);
    expect(html.match(/>Done</g)).toHaveLength(2);
    expect(html.match(/>To do</g)).toHaveLength(3);
    for (const l of ["Add location details", "Add your tables", "Build your menu", "Invite your staff", "Set your branding"]) expect(html).toContain(l);
    expect(html).toContain('href="/demo/loc-1/tables"');
    expect(html).toContain('href="/demo/staff"');
    expect(html).not.toContain("all set");
  });
  it("complete: all-set state", () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={make(KEYS)} orgSlug="demo" />);
    expect(html).toContain("5 of 5 done");
    expect(html).toContain("all set");
    expect(html).toContain("<details");
  });
  it("no permission: states shown, no links", () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={make(["location"], false)} orgSlug="demo" />);
    expect(html).not.toContain("<a ");
    expect(html).toContain("1 of 5 done");
    expect(html).toContain(">Done<");
    expect(html).toContain("Add your tables");
  });
  it("nothing done yet", () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={make([])} orgSlug="demo" />);
    expect(html).toContain("0 of 5 done");
    expect(html.match(/>To do</g)).toHaveLength(5);
  });
});
