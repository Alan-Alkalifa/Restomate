import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const guard = vi.fn();
vi.mock("@/app/(superadmin)/_data", () => ({ requirePlatformAdmin: () => guard() }));

import AdminLayout, { metadata } from "@/app/(superadmin)/admin/layout";
import { AdminShell } from "./AdminShell";

const FORBIDDEN = [/platform admin/i, /Tenants/, /Packages/, /Billing/, /Settings/, /aria-label="Admin"/, /\/admin\//];

describe("admin shell is hidden from non-admins", () => {
  it("the layout renders only a neutral boundary: fallback and metadata carry no admin text", () => {
    const tree = AdminLayout({ children: <p>page</p> } as never) as React.ReactElement<{ fallback: React.ReactNode; children: React.ReactElement }>;
    const fallback = renderToStaticMarkup(<>{tree.props.fallback}</>);
    for (const re of FORBIDDEN) expect(fallback).not.toMatch(re);
    expect(String(metadata.title)).toBe("Restomate");
    expect(JSON.stringify(metadata)).not.toMatch(/admin/i);
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("the shell never produces markup when the guard rejects (404 for non-admins)", async () => {
    guard.mockRejectedValueOnce(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(AdminShell({ children: <p>secret page</p> })).rejects.toThrow();
  });

  it("the shell renders the full chrome for a platform admin", async () => {
    guard.mockResolvedValueOnce(undefined);
    const html = renderToStaticMarkup(await AdminShell({ children: <p>tenant list</p> }));
    expect(html).toContain("Restomate platform admin");
    expect(html).toContain('aria-label="Admin"');
    for (const l of ["Tenants", "Packages", "Billing", "Settings"]) expect(html).toContain(l);
    expect(html).toContain("tenant list");
  });

  it("the layout does not render the shell or the page itself outside the guarded child", () => {
    const tree = AdminLayout({ children: <p>secret page</p> } as never) as React.ReactElement<{ fallback: React.ReactNode; children: React.ReactElement }>;
    // Only the Suspense boundary (with the shell as its child element) is returned; no chrome is rendered inline.
    expect(JSON.stringify(Object.keys(tree.props))).toContain("fallback");
    expect(tree.props.children.type).toBe(AdminShell);
  });
});
