import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { parseTenantParams, tenantsHref } from "./params";
import { Pagination, TenantsTable } from "./TenantsTable";
import type { TenantRow } from "./types";

const row = (o: Partial<TenantRow> = {}): TenantRow => ({
  id: "1", slug: "demo", name: "Demo", status: "active", packageCode: "pro", packageName: "Pro",
  subscriptionStatus: "trialing", trialEndsAt: "2026-12-01T00:00:00Z", locationsCount: 2, membersCount: 5,
  ownerEmail: "o@demo.local", createdAt: "2026-11-01T00:00:00Z", ...o,
});
const noop = async () => ({ ok: true as const });

describe("admin tenants", () => {
  it("parses and sanitises URL params", () => {
    expect(parseTenantParams({ q: " pizza ", status: "suspended", plan: "pro", page: "3" })).toEqual({ q: "pizza", status: "suspended", packageCode: "pro", page: 3, pageSize: 20 });
    expect(parseTenantParams({ status: "bogus", page: "-4" })).toMatchObject({ status: undefined, page: 1 });
    expect(parseTenantParams({ page: "1e9x" }).page).toBe(1);
  });
  it("builds shareable hrefs", () => {
    expect(tenantsHref({ q: "a b", status: "active" }, 2)).toBe("/admin/tenants?q=a+b&status=active&page=2");
    expect(tenantsHref({}, 1)).toBe("/admin/tenants");
  });
  it("escapes tenant names (no XSS) and shows the right action", () => {
    const html = renderToStaticMarkup(<TenantsTable setStatus={noop} rows={[row({ name: "<img src=x onerror=alert(1)>" }), row({ id: "2", status: "suspended", name: "S" })]} />);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Suspend");
    expect(html).toContain("Reactivate");
  });
  it("renders an empty state and pagination links", () => {
    expect(renderToStaticMarkup(<TenantsTable setStatus={noop} rows={[]} />)).toContain("No tenants match");
    const p = renderToStaticMarkup(<Pagination page={2} pageSize={20} total={45} filters={{ q: "x" }} />);
    expect(p).toContain("page 2 of 3");
    expect(p).toContain("/admin/tenants?q=x");
  });
});
