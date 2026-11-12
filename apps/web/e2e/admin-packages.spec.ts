import { expect, test } from "@playwright/test";
import { asUser, deleteRest, rest, userJwt } from "./support/db";
import { open, pageText, signInAs } from "./support/flows";
import { SEED_PASSWORD, seedUsers } from "./support/users";

// MSS-T02 (#92): super admin Packages page. Whole-Rupiah money, platform-admin only, RLS below the UI.
const NOT_FOUND = /^404$|page not found/i;
const CODE = `qa${Date.now().toString(36)}`;

test.afterAll(async () => {
  await deleteRest(`packages?code=eq.${CODE}`);
});

test.describe("super admin packages", () => {
  test("platform admin: whole-Rupiah prices only; a valid plan is saved as integer Rupiah", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    await open(page, "/admin/packages/new");
    await page.getByLabel("Code").fill(CODE);
    await page.getByLabel("Name").fill(`QA Plan ${CODE}`);

    const monthly = page.getByLabel(/^Monthly price/);
    for (const bad of ["12.5", "1e3", "abc", "-5"]) {
      await monthly.fill(bad);
      await expect(page.getByText(/Can't read this amount/i).first(), `monthly ${bad}`).toBeVisible();
    }
    await monthly.fill("250.000");
    await expect(page.getByText("Saves as Rp 250.000").first()).toBeVisible();
    await page.getByLabel(/^Yearly price/).fill("2.500.000");

    // A rejected amount must not create a row: 12.5 is not a whole Rupiah.
    await monthly.fill("12.5");
    await page.getByRole("button", { name: "Create plan" }).click();
    await page.waitForTimeout(3000);
    expect((await rest(`packages?code=eq.${CODE}&select=id`)).length).toBe(0);

    await monthly.fill("250.000");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect.poll(async () => (await rest<{ price_monthly: number; price_yearly: number; currency: string }>(`packages?code=eq.${CODE}&select=price_monthly,price_yearly,currency`))[0], { timeout: 60_000 })
      .toEqual({ price_monthly: 250000, price_yearly: 2500000, currency: "IDR" });
  });

  for (const [who, email] of [["owner", seedUsers.owner], ["manager", seedUsers.manager], ["cashier", seedUsers.cashier], ["other restaurant's owner", seedUsers.otherOwner]] as const) {
    test(`${who}: /admin/packages and /admin/packages/new are 404 with no package data`, async ({ page }) => {
      await signInAs(page, email);
      for (const path of ["/admin/packages", "/admin/packages/new"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible({ timeout: 60_000 });
        expect(await pageText(page), path).not.toMatch(/Create plan|Set default|Archive|Monthly price/);
      }
    });
  }

  test("below the UI: only a platform admin can write packages (REST as owner, cashier, other owner)", async () => {
    const list = () => rest<{ id: string; price_monthly: number; name: string }>(`packages?code=neq.${CODE}&select=id,name,price_monthly&order=id`);
    const before = await list();
    expect(before.length).toBeGreaterThan(0);
    for (const email of [seedUsers.owner, seedUsers.cashier, seedUsers.otherOwner]) {
      const jwt = await userJwt(email, SEED_PASSWORD);
      const ins = await asUser(jwt, "packages", { method: "POST", body: { code: `${CODE}x`, name: "x", price_monthly: 1, price_yearly: 1 } });
      expect(ins.status, `${email} insert`).toBeGreaterThanOrEqual(400);
      const upd = await asUser(jwt, `packages?id=eq.${before[0].id}`, { method: "PATCH", body: { price_monthly: 1 } });
      expect(Array.isArray(upd.json) ? (upd.json as unknown[]).length : 0, `${email} update touched rows`).toBe(0);
      const del = await asUser(jwt, `packages?id=eq.${before[0].id}`, { method: "DELETE" });
      expect(Array.isArray(del.json) ? (del.json as unknown[]).length : 0, `${email} delete touched rows`).toBe(0);
    }
    expect(await list()).toEqual(before);
    expect((await rest(`packages?code=eq.${CODE}x&select=id`)).length).toBe(0);
  });
});
