import { expect, test, type Page } from "@playwright/test";
import { newConfirmedUser, open, uniqueSlug } from "./support/flows";
import { orgCountForEmail, slugExists, snapshotBySlug } from "./support/db";

/*
 * Onboarding e2e (MF-T29, M0 exit criterion 1): signup -> confirm -> restaurant with one location, end to end,
 * plus atomicity, double submit, draft persistence and tampered request bodies.
 * Needs DB assertions: SUPABASE_SERVICE_ROLE_KEY (local) must be in the environment (CI exports it).
 */

const NEXT = { name: "Next", exact: true } as const;

async function fillStep1(page: Page, name: string, slug: string) {
  await page.getByLabel("Restaurant name").fill(name);
  await page.getByLabel("Web address").fill(slug);
  await expect(page.getByRole("status").filter({ hasText: /available/i })).toBeVisible();
  await page.getByRole("button", NEXT).click();
}

async function fillStep2(page: Page, { tax = "10", service = "5" } = {}) {
  await page.getByLabel("Location name").fill("Main Branch");
  await page.getByLabel("Tax (PB1/PBJT) %").fill(tax);
  await page.getByLabel("Service charge %").fill(service);
  await page.getByRole("button", NEXT).click();
}

test.describe("onboarding wizard", () => {
  test("signup -> confirm -> 3 steps -> restaurant with one location, owner, trial (exit criterion 1)", async ({ page }) => {
    const { email } = await newConfirmedUser(page, "onb");
    const slug = uniqueSlug("onb");

    // Step 1: live slug states.
    const slugBox = page.getByLabel("Web address");
    await page.getByLabel("Restaurant name").fill("E2E Bistro");
    const status = page.getByRole("status");
    await slugBox.fill("demo");
    await expect(status).toContainText(/reserved/i);
    await slugBox.fill("admin");
    await expect(status).toContainText(/reserved/i);
    await slugBox.fill("other-bistro");
    await expect(status).toContainText(/already taken/i);
    await expect(page.getByRole("button", NEXT)).toBeDisabled();
    await slugBox.fill("A_b");
    await expect(status).toContainText(/3-40 lowercase letters/i);
    await slugBox.fill(slug);
    await expect(status).toContainText(/available/i);
    await page.getByRole("button", NEXT).click();

    // Step 2: location, 10% PB1 + 5% service.
    await fillStep2(page, { tax: "10", service: "5" });

    // Step 3: skip branding.
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));

    // Lands as owner with the full sidebar (attached, not necessarily visible: mobile collapses it).
    for (const item of ["Home", "POS", "Orders", "Kitchen", "Tables", "Menu", "Customers", "Staff", "Payments", "Settings"]) {
      await expect(page.getByRole("link", { name: item, exact: true }).first()).toBeAttached();
    }

    // Database truth: exactly one org / location / owner / trial, bps conversion, audit entry.
    const snap = await snapshotBySlug(slug);
    expect(snap.orgs).toHaveLength(1);
    expect(snap.orgs[0]).toMatchObject({ name: "E2E Bistro", status: "active" });
    expect(snap.locations).toHaveLength(1);
    expect(snap.locations[0]).toMatchObject({ name: "Main Branch", tax_rate_bps: 1000, service_charge_bps: 500, currency: "IDR" });
    expect(snap.members).toHaveLength(1);
    expect(snap.members[0].roles?.key).toBe("owner");
    expect(snap.members[0].status).toBe("active");
    expect(snap.subscriptions).toHaveLength(1);
    expect(snap.subscriptions[0].status).toBe("trialing");
    expect(snap.subscriptions[0].packages?.code).toBeTruthy();
    expect(snap.branding).toHaveLength(1);
    expect(snap.audit).toHaveLength(1);
    expect(await orgCountForEmail(email)).toBe(1);
  });

  test("percent -> basis points: 11% tax and 5.5% service are stored as 1100 and 550", async ({ page }) => {
    await newConfirmedUser(page, "bps");
    const slug = uniqueSlug("bps");
    await fillStep1(page, "BPS Cafe", slug);
    await fillStep2(page, { tax: "11", service: "5.5" });
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    const snap = await snapshotBySlug(slug);
    expect(snap.locations[0]).toMatchObject({ tax_rate_bps: 1100, service_charge_bps: 550 });
  });

  test("tax above 25% is blocked in the UI", async ({ page }) => {
    await newConfirmedUser(page, "cap");
    await fillStep1(page, "Cap Cafe", uniqueSlug("cap"));
    await page.getByLabel("Location name").fill("Main");
    await page.getByLabel("Tax (PB1/PBJT) %").fill("26");
    await expect(page.getByText(/between 0 and 25/i)).toBeVisible();
    await expect(page.getByRole("button", NEXT)).toBeDisabled();
  });

  test("a refresh mid-wizard keeps what was typed", async ({ page }) => {
    await newConfirmedUser(page, "draft");
    const slug = uniqueSlug("draft");
    await fillStep1(page, "Draft Diner", slug);
    await page.getByLabel("Location name").fill("Draft Branch");
    await page.reload();
    await page.waitForLoadState("networkidle");
    // Step and fields survive (draft lives in sessionStorage for this tab).
    await expect(page.getByLabel("Location name").or(page.getByLabel("Restaurant name"))).toBeVisible();
    if (await page.getByLabel("Restaurant name").isVisible()) {
      await expect(page.getByLabel("Restaurant name")).toHaveValue("Draft Diner");
      await expect(page.getByLabel("Web address")).toHaveValue(slug);
    } else {
      await expect(page.getByLabel("Location name")).toHaveValue("Draft Branch");
    }
  });

  test("double-clicking Finish creates exactly one organization", async ({ page }) => {
    const { email } = await newConfirmedUser(page, "dbl");
    const slug = uniqueSlug("dbl");
    await fillStep1(page, "Double Click Diner", slug);
    await fillStep2(page);
    // Three synchronous clicks in one task: a real double/triple tap, without Playwright retrying a detached button.
    await page.getByRole("button", { name: "Finish" }).evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    expect((await snapshotBySlug(slug)).orgs).toHaveLength(1);
    expect(await orgCountForEmail(email)).toBe(1);
  });

  test("a slug taken in another tab between check and submit: jumps back to step 1 with the error, no half tenant", async ({ page, context }) => {
    const { email } = await newConfirmedUser(page, "race");
    const slug = uniqueSlug("race");
    await fillStep1(page, "Race One", slug);
    await fillStep2(page);

    // Same user, second tab, takes the slug first.
    const other = await context.newPage();
    await open(other, "/onboarding");
    await other.evaluate(() => sessionStorage.clear());
    await other.reload();
    await other.waitForLoadState("networkidle");
    await fillStep1(other, "Race Two", slug);
    await fillStep2(other);
    await other.getByRole("button", { name: "Skip" }).click();
    await expect(other).toHaveURL(new RegExp(`/${slug}$`));

    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /taken/i })).toBeVisible();
    await expect(page.getByLabel("Web address")).toBeFocused();
    await expect(page).toHaveURL(/\/onboarding/);
    expect((await snapshotBySlug(slug)).orgs).toHaveLength(1);
    expect(await orgCountForEmail(email)).toBe(1);
  });
});

test.describe("tampered onboarding requests", () => {
  /** Rewrites the createOrganization request body in flight. Returns whether the rewrite was applied. */
  async function tamper(page: Page, rewrite: (body: string) => string): Promise<{ applied: () => boolean }> {
    let applied = false;
    await page.route("**/onboarding", async (route) => {
      const req = route.request();
      const body = req.postData();
      if (req.method() === "POST" && body && body.includes('"taxRateBps"')) {
        const next = rewrite(body);
        applied = next !== body;
        await route.continue({ postData: next });
      } else {
        await route.continue();
      }
    });
    return { applied: () => applied };
  }

  test("injected organization_id / role / package_code are ignored: default trial package, own org, owner role", async ({ page }) => {
    const { email } = await newConfirmedUser(page, "tamper");
    const slug = uniqueSlug("tamper");
    const t = await tamper(page, (b) =>
      b.replace(
        '{"name":',
        '{"organization_id":"00000000-0000-0000-0000-000000000001","role":"owner","package_code":"pro","price":1,"name":',
      ),
    );
    await fillStep1(page, "Tamper Grill", slug);
    await fillStep2(page);
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    expect(t.applied()).toBe(true);

    const snap = await snapshotBySlug(slug);
    expect(snap.orgs).toHaveLength(1);
    expect(snap.orgs[0].id).not.toBe("00000000-0000-0000-0000-000000000001");
    expect(snap.members).toHaveLength(1);
    expect(snap.subscriptions[0].packages?.code).not.toBe("pro"); // default trial package, not the injected one
    expect(await orgCountForEmail(email)).toBe(1);
  });

  test("a tampered tax rate (99999 bps) is rejected server-side and nothing is created", async ({ page }) => {
    await newConfirmedUser(page, "tamper2");
    const slug = uniqueSlug("tamper2");
    const t = await tamper(page, (b) => b.replace(/"taxRateBps":\s*1000/, '"taxRateBps":99999'));
    await fillStep1(page, "Bad Tax Bar", slug);
    await fillStep2(page, { tax: "10", service: "5" });
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(t.applied()).toBe(true);
    expect(await slugExists(slug)).toBe(false);
  });
});
