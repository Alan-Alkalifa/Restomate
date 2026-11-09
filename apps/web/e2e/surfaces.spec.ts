import { expect, test, type Page } from "@playwright/test";
import { activePublicPackages, auditActions, createOrg, deleteOrgs, deleteRest, insertRest, orgIdOf, rest } from "./support/db";
import { open, signInAs } from "./support/flows";
import { seedUsers, uniqueEmail } from "./support/users";

/*
 * Surfaces e2e (MF-T31): public pricing, the tenant storefront, super admin access and tenant management, XSS.
 * Throwaway orgs/packages are created with the local service role and always removed (tests stay independent).
 * Suspension is exercised on a dedicated throwaway org, never on the seed orgs other specs depend on.
 */

const NOT_FOUND = /^404$|page not found/i;
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A storefront URL on the tenant host (demo.localhost:3000), derived from the configured base URL. */
function tenantHost(baseURL: string, slug: string): string {
  const u = new URL(baseURL);
  return `${u.protocol}//${slug}.${u.hostname}${u.port ? `:${u.port}` : ""}`;
}

async function adminTenants(page: Page, query = "") {
  await open(page, `/admin/tenants${query}`);
  await expect(page.getByRole("table", { name: "Tenants" })).toBeVisible();
}

test.describe("pricing (signed out)", () => {
  test("lists exactly the active + public packages with Rp prices; hidden and inactive ones never appear", async ({ page }) => {
    const tag = uniq();
    const hidden = { code: `hid${tag}`, name: `Hidden ${tag}`, is_public: false, is_active: true, price_monthly: 123456 };
    const inactive = { code: `ina${tag}`, name: `Inactive ${tag}`, is_public: true, is_active: false, price_monthly: 654321 };
    await insertRest("packages", [hidden, inactive]);
    try {
      await open(page, "/pricing");
      const expected = await activePublicPackages();
      expect(expected.length).toBeGreaterThanOrEqual(3);
      const text = (await page.locator("main").innerText()).replace(/ /g, " ");
      for (const p of expected) {
        await expect(page.getByRole("heading", { name: p.name, exact: true })).toBeVisible();
        const money = p.price_monthly.toLocaleString("id-ID"); // 250000 -> "250.000"
        expect(text, `${p.name} monthly price`).toMatch(new RegExp(`Rp\\s?${money.replace(/\./g, "\\.")}`));
      }
      // exactly those packages: one card per package
      await expect(page.locator("main h2")).toHaveCount(expected.length);
      expect(text).not.toContain(hidden.name);
      expect(text).not.toContain(inactive.name);
      expect(text).not.toMatch(/123\.456|654\.321/);
    } finally {
      await deleteRest(`packages?code=in.(${hidden.code},${inactive.code})`);
    }
  });
});

test.describe("storefront", () => {
  test("demo.localhost shows Demo branding and both locations, with no admin chrome or Restomate login links", async ({ page, baseURL }) => {
    for (const url of [`${tenantHost(baseURL!, "demo")}/`, `${new URL(baseURL!).origin}/s/demo`]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: /demo restaurant/i }).first()).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const loc of ["Jakarta Selatan", "Bandung"]) expect(text, `${url} location ${loc}`).toContain(loc);
      await expect(page.getByRole("link", { name: /sign in|log in|login/i })).toHaveCount(0);
      await expect(page.locator('a[href^="/login"], a[href*="/admin"], a[href*="/signup"]')).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Dashboard" })).toHaveCount(0);
      expect(text).not.toMatch(/owner@demo\.local|staff|settings/i);
    }
  });

  test("an unknown slug is a 404, on the tenant host and on /s/", async ({ page, baseURL }) => {
    const slug = `nope-${uniq()}`;
    for (const url of [`${tenantHost(baseURL!, slug)}/`, `${new URL(baseURL!).origin}/s/${slug}`]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
    }
  });
});

test.describe("super admin access", () => {
  for (const [label, email] of [["owner@demo.local", seedUsers.owner], ["manager@demo.local", seedUsers.manager], ["owner@other.local", seedUsers.otherOwner]] as const) {
    test(`${label} gets a 404 view and no tenant data on every /admin page`, async ({ page }) => {
      await signInAs(page, email);
      for (const path of ["/admin", "/admin/tenants", "/admin/packages", "/admin/billing", "/admin/settings"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
        // The refused view must carry no tenant data (names, slugs, staff emails, plans) in the DOM or the streamed payload.
        const res = await page.request.get(path);
        const html = `${await res.text()}\n${await page.content()}`;
        for (const secret of ["Other Bistro", "other-bistro", "Demo Restaurant", "admin@restomate.local", "owner@demo.local", "trialing"]) {
          expect(html, `${path} leaked "${secret}"`).not.toContain(secret);
        }
      }
    });
  }

  test("a non-admin's 404 response contains no admin shell markup", async ({ page }) => {
    await signInAs(page, seedUsers.owner);
    const res = await page.request.get("/admin/tenants");
    const html = await res.text();
    expect(html).not.toMatch(/platform admin/i);
    expect(html).not.toContain("Billing");
  });

  test("a signed-out visitor is sent to /login for /admin, with no admin content", async ({ page }) => {
    for (const path of ["/admin", "/admin/tenants"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      expect(await page.content()).not.toMatch(/platform admin/i);
    }
  });

  test("admin pages are noindex", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    for (const path of ["/admin", "/admin/tenants"]) {
      await open(page, path);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots, path).toMatch(/noindex/i);
    }
  });
});

test.describe("super admin tenants", () => {
  test("lists both seed orgs; search and the status filter narrow the list", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    await adminTenants(page);
    const body = page.getByRole("table", { name: "Tenants" });
    await expect(body.getByText("demo", { exact: true }).first()).toBeVisible();
    await expect(body.getByText("other-bistro", { exact: true }).first()).toBeVisible();

    await adminTenants(page, "?q=other");
    await expect(page.getByRole("table", { name: "Tenants" }).getByText("other-bistro", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Tenants" }).getByText("demo", { exact: true })).toHaveCount(0);

    await adminTenants(page, "?status=active&plan=starter");
    const rows = await page.getByRole("table", { name: "Tenants" }).locator("tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(1);
    await open(page, "/admin/tenants?q=zzz-no-such-tenant");
    await expect(page.getByText(/no tenants match/i)).toBeVisible();
  });

  test("pagination: 20 per page, Next and Previous keep the filters", async ({ page }) => {
    const tag = uniq();
    for (let i = 0; i < 22; i++) await createOrg(`pg${tag}-${String(i).padStart(2, "0")}`, `Paging ${tag} ${i}`);
    try {
      await signInAs(page, seedUsers.platformAdmin);
      await adminTenants(page, `?q=pg${tag}`);
      await expect(page.getByRole("table", { name: "Tenants" }).locator("tbody tr")).toHaveCount(20);
      await page.getByRole("link", { name: "Next" }).click();
      await expect(page).toHaveURL(new RegExp(`page=2`));
      await expect(page).toHaveURL(new RegExp(`q=pg${tag}`));
      await expect(page.getByRole("table", { name: "Tenants" }).locator("tbody tr")).toHaveCount(2);
      await page.getByRole("link", { name: "Previous" }).click();
      await expect(page.getByRole("table", { name: "Tenants" }).locator("tbody tr")).toHaveCount(20);
    } finally {
      await deleteOrgs(`pg${tag}-%`);
    }
  });

  test("suspend with a reason: badge, audit row, storefront unavailable at once (noindex); reactivate reverses it", async ({ page, browser, baseURL }) => {
    const slug = `susp-${uniq()}`;
    await createOrg(slug, `Suspend Me ${slug}`, { location: "Only Branch" });
    try {
      const store = await browser.newContext();
      const shop = await store.newPage();
      const storeUrl = `${new URL(baseURL!).origin}/s/${slug}`;
      await shop.goto(storeUrl);
      await expect(shop.getByRole("heading", { name: `Suspend Me ${slug}` })).toBeVisible(); // warm the cache on purpose

      await signInAs(page, seedUsers.platformAdmin);
      await adminTenants(page, `?q=${slug}`);
      const row = () => page.getByRole("table", { name: "Tenants" }).locator("tr", { hasText: slug }).first();
      await row().getByRole("button", { name: "Suspend" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel(/reason/i).fill("e2e suspension test");
      await dialog.getByRole("button", { name: "Suspend" }).click();
      await expect(row().getByText(/suspended/i).first()).toBeVisible();

      // Scoped to this run's throwaway org: desktop and mobile projects run in parallel and use the same reason text.
      const orgId = await orgIdOf(slug);
      const audit = await rest<{ metadata: { to?: string; reason?: string } }>(
        `audit_logs?organization_id=eq.${orgId}&action=eq.organization.status_changed&metadata->>reason=eq.e2e%20suspension%20test&select=metadata`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata.to).toBe("suspended");
      expect(await auditActions(slug).catch(() => [])).toContain("organization.status_changed");

      // The previously cached storefront must flip immediately (no redeploy, no waiting for cache expiry).
      await shop.goto(storeUrl);
      await expect(shop.getByRole("heading", { name: /temporarily unavailable/i })).toBeVisible();
      await expect(shop.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
      expect(await shop.content()).not.toContain("Only Branch");

      await row().getByRole("button", { name: "Reactivate" }).click();
      await page.locator("dialog[open]").getByLabel(/reason/i).fill("e2e reactivation");
      await page.locator("dialog[open]").getByRole("button", { name: "Reactivate" }).click();
      await expect(row().getByText(/active/i).first()).toBeVisible();
      await shop.goto(storeUrl);
      await expect(shop.getByRole("heading", { name: `Suspend Me ${slug}` })).toBeVisible();
      await store.close();
    } finally {
      await deleteOrgs(slug);
    }
  });

  test("XSS smoke: an org named <img src=x onerror=alert(1)> is plain text in the tenants table and on the storefront", async ({ page, browser, baseURL }) => {
    const slug = `xss-${uniq()}`;
    const evilName = "<img src=x onerror=alert(1)>";
    await createOrg(slug, evilName, { location: "<script>alert(2)</script>" });
    const dialogs: string[] = [];
    try {
      await signInAs(page, seedUsers.platformAdmin);
      page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
      await adminTenants(page, `?q=${slug}`);
      await expect(page.getByRole("table", { name: "Tenants" }).getByText(evilName, { exact: true })).toBeVisible();
      await expect(page.locator('img[src="x"]')).toHaveCount(0);

      const ctx = await browser.newContext();
      const shop = await ctx.newPage();
      shop.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
      await shop.goto(`${new URL(baseURL!).origin}/s/${slug}`);
      await expect(shop.getByRole("heading", { name: evilName })).toBeVisible();
      await expect(shop.getByText("<script>alert(2)</script>")).toBeVisible();
      await expect(shop.locator('img[src="x"]')).toHaveCount(0);
      await shop.waitForTimeout(1000);
      expect(dialogs, "no script ran").toEqual([]);
      await ctx.close();
    } finally {
      await deleteOrgs(slug);
    }
  });
});

// Keeps `uniqueEmail` imported for parity with the other specs if a future case needs a throwaway user.
void uniqueEmail;
