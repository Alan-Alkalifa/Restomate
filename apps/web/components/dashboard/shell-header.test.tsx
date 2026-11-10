import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardSignOut } from "./DashboardSignOut";

describe("dashboard header", () => {
  it("wraps at every width instead of overflowing", () => {
    const html = renderToStaticMarkup(<DashboardHeader orgName="A very long restaurant name that keeps going"><span>switcher</span><span>email</span></DashboardHeader>);
    expect(html.match(/flex-wrap/g)?.length).toBeGreaterThanOrEqual(2); // the header and the right-hand group
    expect(html).toContain("min-w-0");
    expect(html).toContain("break-words");
    expect(html).toContain("A very long restaurant name");
  });
});

describe("sign out button", () => {
  const html = renderToStaticMarkup(<DashboardSignOut action={async () => {}} />);
  it("has an explicit visible text colour in both themes (never white on transparent)", () => {
    expect(html).toContain("Sign out");
    expect(html).toContain("text-neutral-900");
    expect(html).toContain("dark:text-neutral-50");
    expect(html).not.toMatch(/(?<!dark:)text-white/);
    expect(html).not.toContain("text-inherit");
    expect(html).not.toContain("bg-teal");
  });
  it("is a touch-sized submit button", () => {
    expect(html).toContain('type="submit"');
    expect(html).toContain("min-h-12");
  });
});
