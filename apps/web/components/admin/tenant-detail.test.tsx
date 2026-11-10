import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerResetDialog, RESET_SUCCESS, resetFailureMessage } from "./OwnerResetDialog";
import { AuditSection, LocationsSection, OwnersSection, SubscriptionHistorySection, TenantDetailView, TenantHeader, UsageSection, usageLabel } from "./TenantDetailSections";
import type { TenantDetail } from "@/lib/admin/tenant-detail-types";

const noop = async () => ({ ok: true as const });
const usage: TenantDetail["usage"] = {
  max_locations: { used: 1, limit: 3 }, max_staff: { used: 6, limit: 5 },
  max_tables: { used: 4, limit: null }, max_orders_per_month: { used: 0, limit: 100 },
};
const sub = { id: "s1", packageCode: "pro", packageName: "Pro", status: "active" as const, billingPeriod: "monthly" as const,
  trialEndsAt: null, currentPeriodEnd: "2026-12-01T00:00:00Z", canceledAt: null, createdAt: "2026-11-01T17:30:00Z" };
const detail = (o: Partial<TenantDetail> = {}): TenantDetail => ({
  org: { id: "o1", name: "Demo", slug: "demo", status: "active", createdAt: "2026-11-01T00:00:00Z" },
  locations: [{ id: "l1", name: "Main", timezone: "Asia/Jakarta", currency: "IDR", isActive: true }],
  subscription: sub, subscriptionHistory: [sub], usage,
  owners: [{ userId: "u1", name: "Sari", email: "sari@example.com" }],
  auditTrail: [{ id: 1, action: "org.status_changed", actorName: null, createdAt: "2026-11-02T00:00:00Z", metadata: { reason: "x" } }],
  ...o,
});

describe("usage meters", () => {
  it("shows Unlimited, Not tracked yet and highlights over-limit", () => {
    expect(usageLabel("max_tables", usage.max_tables)).toBe("4 · Unlimited");
    expect(usageLabel("max_orders_per_month", usage.max_orders_per_month)).toBe("Not tracked yet");
    expect(usageLabel("max_staff", usage.max_staff)).toBe("6 of 5");
    const html = renderToStaticMarkup(<UsageSection usage={usage} subscription={sub} />);
    expect(html).toContain("Over limit");
    expect(html.match(/data-over-limit/g)).toHaveLength(1);
    expect(html).not.toContain("0 of 100");
  });
  it("handles no subscription", () => {
    expect(renderToStaticMarkup(<UsageSection usage={usage} subscription={null} />)).toContain("No subscription");
  });
});

describe("no plan", () => {
  it("shows No plan, not '0 allowed' or over limit, when there is no live subscription", () => {
    const zero: TenantDetail["usage"] = {
      max_locations: { used: 1, limit: 0 }, max_staff: { used: 2, limit: 0 },
      max_tables: { used: 0, limit: 0 }, max_orders_per_month: { used: 0, limit: 0 },
    };
    for (const s of [null, { ...sub, status: "canceled" as const }]) {
      const html = renderToStaticMarkup(<UsageSection usage={zero} subscription={s} />);
      expect(html.match(/No plan/g)).toHaveLength(3);
      expect(html).not.toContain("Over limit");
      expect(html).not.toContain("of 0");
      expect(html).toContain("Not tracked yet");
    }
    expect(usageLabel("max_tables", { used: 3, limit: null }, true)).toBe("3 · Unlimited");
  });
  it("a live plan with a real limit of 0 still reads 'of 0'", () => {
    expect(usageLabel("max_tables", { used: 0, limit: 0 }, false)).toBe("0 of 0");
  });
});

describe("sections and empty states", () => {
  it("renders every section", () => {
    const html = renderToStaticMarkup(<TenantDetailView detail={detail()} reset={noop} rootDomain="restomate.app" />);
    for (const t of ["Locations", "Plan &amp; usage", "Subscription history", "Owners", "Audit trail", "Open storefront", "Send password reset"]) expect(html).toContain(t);
    expect(html).toContain("System"); // null actor
  });
  it("shows empty states", () => {
    expect(renderToStaticMarkup(<LocationsSection locations={[]} />)).toContain("No locations yet.");
    expect(renderToStaticMarkup(<SubscriptionHistorySection history={[]} />)).toContain("No subscriptions yet.");
    expect(renderToStaticMarkup(<AuditSection entries={[]} />)).toContain("No audit entries yet.");
    expect(renderToStaticMarkup(<OwnersSection orgId="o1" owners={[]} reset={noop} />)).toContain("No active owners.");
  });
  it("dates use Asia/Jakarta", () => {
    expect(renderToStaticMarkup(<SubscriptionHistorySection history={[sub]} />)).toContain("2 Nov 2026"); // 17:30Z is next day in WIB
  });
  it("flags suspended orgs", () => {
    const html = renderToStaticMarkup(<TenantHeader org={{ ...detail().org, status: "suspended" }} rootDomain="restomate.app" />);
    expect(html).toContain("suspended");
    expect(html).toContain("This restaurant is suspended");
  });
});

describe("XSS", () => {
  const evil = '<img src=x onerror=alert(1)>';
  it("renders names and metadata as text", () => {
    const d = detail({
      org: { ...detail().org, name: evil },
      locations: [{ id: "l", name: evil, timezone: "Asia/Jakarta", currency: "IDR", isActive: true }],
      owners: [{ userId: "u1", name: evil, email: "a@b.c" }],
      auditTrail: [{ id: 2, action: evil, actorName: evil, createdAt: "2026-11-02T00:00:00Z", metadata: { note: evil } }],
    });
    const html = renderToStaticMarkup(<TenantDetailView detail={d} reset={noop} rootDomain="restomate.app" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("owner reset", () => {
  it("posts only orgId and userId", () => {
    const html = renderToStaticMarkup(<OwnerResetDialog action={noop} orgId="o1" userId="u1" ownerName="Sari" />);
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["orgId", "userId"]);
  });
  it("maps the contract's error codes and success text", () => {
    expect(resetFailureMessage({ ok: false, code: "RATE_LIMITED" })).toBe("Too many attempts. Try again later.");
    expect(resetFailureMessage({ ok: false, code: "NOT_FOUND" as never })).toBe("That owner no longer exists.");
    expect(resetFailureMessage({ ok: false, code: "FORBIDDEN" })).toBe("You don't have access to do that.");
    expect(resetFailureMessage({ ok: false })).toBe("Could not send the reset email. Try again.");
    expect(resetFailureMessage({ ok: true })).toBeUndefined();
    expect(RESET_SUCCESS).toBe("If the address exists, a reset email is on its way.");
  });
});
