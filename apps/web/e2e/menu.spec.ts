import { expect, test } from "@playwright/test";
import { open, pageText, signInAs } from "./support/flows";
import { seedUsers } from "./support/users";

const FORBIDDEN = /you don.t have access/i;
test.setTimeout(300_000); // cold `pnpm dev`
const NOT_FOUND = /^404$|page not found/i;
// Until #79 merges, a member without menu.manage gets a read-only org menu and the per-location menu page does not exist.
// Run with E2E_AFTER_79=1 once it is on main (then drop the guard).
const AFTER_79 = process.env.E2E_AFTER_79 === "1";
const PRICE_ERROR = /whole amount|without decimals|0 or more|Negative|too large|valid amount|Enter/i;
const JAKARTA = "de000000-0000-4000-8000-0000000000a1";

test.describe("org menu editor (MVM-T09, #77)", () => {
  test("owner: whole-rupiah prices only, no floats; created item shows in Rupiah", async ({ page }) => {
    await signInAs(page, seedUsers.owner);
    await open(page, "/demo/menu");
    const cat = `QA Cat ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "Add category" }).first().click();
    await page.getByLabel("Name").fill(cat);
    await page.getByRole("button", { name: "Add category" }).last().click();
    await expect(page.getByText(cat).first()).toBeVisible({ timeout: 120_000 });
    await page.getByText(cat).first().click();

    const item = `QA Item ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "Add item" }).first().click();
    await page.getByLabel("Name").fill(item);
    for (const bad of ["12.5", "1e3", "-5", "abc", "99999999999999999999"]) {
      await page.getByLabel("Price").fill(bad);
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(PRICE_ERROR).first(), `price ${bad}`).toBeVisible();
    }
    await page.getByLabel("Price").fill("35.000");
    await page.getByRole("button", { name: "Add item" }).last().click();
    await expect(page.getByText(item)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Rp\s*35\.000/).first()).toBeVisible();
  });

  // #79 (de74d0e) changed this: without menu.manage the menu pages are refused (sold-out toggling lives on the POS).
  for (const [role, email] of [["cashier", seedUsers.cashier], ["waiter", seedUsers.waiter], ["kitchen", seedUsers.kitchen]] as const) {
    test(`${role}: org and location menu pages are refused, nothing of the menu in the page`, async ({ page }) => {
      test.skip(!AFTER_79, "needs #79");
      await signInAs(page, email);
      for (const path of ["/demo/menu", `/demo/${JAKARTA}/menu`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: FORBIDDEN })).toBeVisible({ timeout: 60_000 });
        expect(await pageText(page), path).not.toMatch(/Add category|Add item|Rendang|Sold out today/);
      }
    });
  }

  test("owner of another restaurant cannot reach /demo/menu", async ({ page }) => {
    await signInAs(page, seedUsers.otherOwner);
    await page.goto("/demo/menu");
    await expect(page.getByRole("heading", { name: FORBIDDEN }).or(page.getByRole("heading", { name: NOT_FOUND }))).toBeVisible();
    expect(await pageText(page)).not.toMatch(/Add category|Add item/);
  });

  test("owner: location menu — override price whole rupiah only, sold out today / back on, unknown location is 404", async ({ page }) => {
    test.skip(!AFTER_79, "needs #79");
    await signInAs(page, seedUsers.owner);
    await open(page, `/demo/${JAKARTA}/menu`);
    const row = page.getByRole("button", { name: /^Edit .* at this location$/ }).first();
    await row.click();
    const dialog = page.getByRole("dialog");
    for (const bad of ["12.5", "1e3", "-5"]) {
      await dialog.getByLabel("Price override (optional)").fill(bad);
      await expect(dialog.getByText(PRICE_ERROR).first(), `override ${bad}`).toBeVisible();
    }
    await dialog.getByLabel("Price override (optional)").fill("");
    await page.keyboard.press("Escape");

    const out = page.getByRole("button", { name: /Mark sold out today/ }).first();
    await out.click();
    await expect(page.getByText(/Sold out until/).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Mark back on the menu/ }).first().click(); // restore

    await page.goto(`/demo/de000000-0000-4000-8000-0000000000ff/menu`);
    await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
  });

  test("owner of another restaurant cannot open the Demo location menu", async ({ page }) => {
    test.skip(!AFTER_79, "needs #79");
    await signInAs(page, seedUsers.otherOwner);
    await page.goto(`/demo/${JAKARTA}/menu`);
    await expect(page.getByRole("heading", { name: FORBIDDEN }).or(page.getByRole("heading", { name: NOT_FOUND }))).toBeVisible();
    expect(await pageText(page)).not.toMatch(/Rendang|Sold out today/);
  });
});
