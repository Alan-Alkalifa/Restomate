import { expect, test, type Browser, type Page } from "@playwright/test";
import { asUser, rest, userJwt } from "./support/db";
import { open, pageText, signInAs } from "./support/flows";
import { SEED_PASSWORD, seedUsers } from "./support/users";

// MSS-T09 (#100): super admin settings page, the public maintenance banner and the signup-closed UI.
test.setTimeout(600_000); // cold `pnpm dev`; each state change goes through the real admin form
const NOT_FOUND = /^404$|page not found/i;
const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const BANNER_OFF = { enabled: false, message: "", level: "info" as const };

/** The public flags are cached and refreshed only by the admin action's cache tag, so state is changed through the real forms. */
async function asAdmin(browser: Browser, fn: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await signInAs(page, seedUsers.platformAdmin);
    await open(page, "/admin/settings");
    await expect(page.getByText("Allow new sign-ups")).toBeVisible({ timeout: 90_000 });
    await fn(page);
  } finally {
    await ctx.close();
  }
}
async function setSignupUI(browser: Browser, enabled: boolean) {
  await asAdmin(browser, async (page) => {
    const form = page.locator('form[aria-labelledby="set-signup"]');
    await form.getByLabel("Allow new sign-ups").setChecked(enabled);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
  });
}
async function setBannerUI(browser: Browser, b: { enabled: boolean; message: string; level: "info" | "warning" }) {
  await asAdmin(browser, async (page) => {
    const form = page.locator('form[aria-labelledby="set-banner"]');
    await form.getByLabel("Show the banner").setChecked(b.enabled);
    await form.getByLabel("Message").fill(b.message);
    await form.getByLabel("Level").selectOption(b.level);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
  });
}

test.afterAll(async ({ browser }) => {
  await setSignupUI(browser, true);
  await setBannerUI(browser, BANNER_OFF);
});

test.describe("settings page access", () => {
  test("platform admin sees the four forms; the tax rate input never guesses", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    await open(page, "/admin/settings");
    await expect(page.getByText("Allow new sign-ups")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Show the banner")).toBeVisible();
    await expect(page.getByText(/Maximum \(1–100\)/)).toBeVisible();
    const rate = page.getByLabel(/rate/i).first();
    for (const bad of ["10.555", "abc", "101", "-1", "1e1"]) {
      await rate.fill(bad);
      await expect(page.getByText(/Can't read this rate/i).first(), `rate ${bad}`).toBeVisible();
    }
    await rate.fill("5,5");
    await expect(page.getByText(/Saves as 5\.5\s*%/).first()).toBeVisible();
    const cap = page.getByLabel(/Maximum \(1–100\)/);
    for (const bad of ["0", "101", "2.5", "abc"]) {
      await cap.fill(bad);
      await expect(page.getByText(/Enter a whole number from 1 to 100/).first(), `cap ${bad}`).toBeVisible();
    }
  });

  for (const [who, email] of [["restaurant owner", seedUsers.owner], ["manager", seedUsers.manager], ["cashier", seedUsers.cashier], ["other restaurant's owner", seedUsers.otherOwner]] as const) {
    test(`${who}: /admin/settings is 404 with no settings in the page`, async ({ page }) => {
      await signInAs(page, email);
      await page.goto("/admin/settings");
      await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible({ timeout: 60_000 });
      expect(await pageText(page)).not.toMatch(/Allow new sign-ups|Show the banner|Tax presets/);
    });
  }

  test("below the UI: only the platform admin can read or write settings", async () => {
    const before = await rest(`platform_settings?select=key,value&order=key`);
    for (const email of [seedUsers.owner, seedUsers.cashier, seedUsers.otherOwner]) {
      const jwt = await userJwt(email, SEED_PASSWORD);
      const w = await asUser(jwt, "rpc/admin_update_platform_setting", { method: "POST", body: { key: "signup", value: { enabled: false } } });
      expect(w.status, `${email} update`).toBeGreaterThanOrEqual(400);
      const r = await asUser(jwt, "rpc/admin_get_platform_settings", { method: "POST", body: {} });
      expect(r.status, `${email} read all`).toBeGreaterThanOrEqual(400);
      const direct = await asUser(jwt, "platform_settings?select=key,value");
      expect(JSON.stringify(direct.json), `${email} direct select`).not.toMatch(/tax_presets|owned_org_cap/);
      const ins = await asUser(jwt, "platform_settings", { method: "POST", body: { key: "signup", value: { enabled: false } } });
      expect(ins.status, `${email} direct insert`).toBeGreaterThanOrEqual(400);
    }
    expect(await rest(`platform_settings?select=key,value&order=key`)).toEqual(before);
    // the public flags RPC returns signupEnabled + banner and nothing else
    const anon = await fetch(`${url()}/rest/v1/rpc/get_public_platform_flags`, { method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "content-type": "application/json" }, body: "{}" });
    expect(Object.keys((await anon.json()) as object).sort()).toEqual(["maintenanceBanner", "signupEnabled"]);
  });

  test("banner message is validated server-side: '<' and '>' and empty-when-enabled are rejected", async () => {
    const admin = await userJwt(seedUsers.platformAdmin, SEED_PASSWORD);
    for (const message of ["<b>x</b>", "a > b", "", "x".repeat(201)]) {
      const w = await asUser(admin, "rpc/admin_update_platform_setting", { method: "POST", body: { key: "maintenance_banner", value: { enabled: true, message, level: "warning" } } });
      expect(w.status, `message ${JSON.stringify(message).slice(0, 20)}`).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("public banner and signup-closed UI", () => {
  test("banner (set in the admin form) shows as plain text with the right role on auth, dashboard, marketing and storefront; nothing when off", async ({ page, browser, baseURL }) => {
    await setBannerUI(browser, { enabled: true, message: "QA maintenance tonight 22:00", level: "warning" });
    for (const path of ["/en/login", "/login", "/en", "/", `${new URL(baseURL!).origin}/s/demo`]) {
      await page.goto(path);
      await expect(page.getByRole("alert").filter({ hasText: "QA maintenance tonight 22:00" }), path).toBeVisible({ timeout: 90_000 });
    }
    await signInAs(page, seedUsers.owner);
    await open(page, "/demo");
    await expect(page.getByRole("alert").filter({ hasText: "QA maintenance tonight 22:00" })).toBeVisible({ timeout: 90_000 });
    await setBannerUI(browser, { enabled: true, message: "QA info notice", level: "info" });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "QA info notice" })).toBeVisible({ timeout: 90_000 });
    await setBannerUI(browser, BANNER_OFF);
    await page.reload();
    await expect(page.getByText("QA info notice")).toHaveCount(0);
  });

  test("signup off (set in the admin form): closed message, no form, no sign-up links, in Bahasa and English", async ({ page, browser }) => {
    await setSignupUI(browser, false);
    await page.goto("/en/signup");
    await expect(page.getByText("Sign-ups are closed right now.")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel("Full name")).toHaveCount(0);
    await page.goto("/signup");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel(/Full name|Nama lengkap/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Create account|Buat akun/ })).toHaveCount(0);
    for (const path of ["/en/login", "/login"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: /Sign in|Masuk/ })).toBeVisible({ timeout: 90_000 });
      await expect(page.locator('a[href$="/signup"]'), `${path} sign-up link`).toHaveCount(0);
    }
    for (const path of ["/", "/en", "/pricing", "/en/pricing", "/features", "/en/features"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 90_000 });
      expect(await page.locator('a[href$="/signup"]').count(), `${path} sign-up links`).toBe(0);
      expect(await page.locator('a[href$="/login"]').count(), `${path} still offers log in`).toBeGreaterThan(0);
    }
    await setSignupUI(browser, true);
    for (const path of ["/", "/en"]) {
      await page.goto(path);
      expect(await page.locator('a[href$="/signup"]').count(), `${path} sign-up links back`).toBeGreaterThan(0);
    }
  });
});
