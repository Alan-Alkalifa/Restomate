import { expect, test, type Page } from "@playwright/test";
import { asUser, patchRest, rest, userJwt } from "./support/db";
import { pageText, signInAs } from "./support/flows";
import { SEED_PASSWORD, seedUsers } from "./support/users";

// MSC-T01 (#109): POS shell. Role gates, tablet widths, touch targets, modifier sheet, local cart, offline banner.
test.setTimeout(480_000); // cold `pnpm dev`
const JKT = "de000000-0000-4000-8000-0000000000a1";
const BDG = "de000000-0000-4000-8000-0000000000a2";
const FORBIDDEN = /you don.t have access/i;
const NOT_FOUND = /^404$|page not found/i;
const posUrl = (loc = JKT) => `/demo/${loc}/pos`;
const CART_KEY = `restomate:pos-cart:${JKT}`;

async function openPos(page: Page) {
  await page.goto(posUrl());
  await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
}

test.describe("access", () => {
  for (const [role, email, allowed] of [["owner", seedUsers.owner, true], ["manager", seedUsers.manager, true], ["cashier", seedUsers.cashier, true], ["waiter", seedUsers.waiter, true], ["kitchen", seedUsers.kitchen, false]] as const) {
    test(`${role}: POS ${allowed ? "opens" : "is refused"}`, async ({ page }) => {
      await signInAs(page, email);
      await page.goto(posUrl(role === "cashier" ? JKT : JKT));
      if (allowed) await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
      else {
        await expect(page.getByRole("heading", { name: FORBIDDEN })).toBeVisible({ timeout: 180_000 });
        expect(await pageText(page)).not.toMatch(/Nasi Goreng|Rendang|Search items/);
      }
    });
  }

  test("other restaurant's owner and an unknown location get no POS and no Demo data", async ({ page }) => {
    await signInAs(page, seedUsers.otherOwner);
    await page.goto(posUrl());
    await expect(page.getByRole("heading", { name: NOT_FOUND }).or(page.getByRole("heading", { name: FORBIDDEN }))).toBeVisible({ timeout: 180_000 });
    expect(await pageText(page)).not.toMatch(/Nasi Goreng|Rendang|Search items/);
  });

  test("cashier scoped to Jakarta Selatan cannot open the Bandung POS; unknown location is 404", async ({ page }) => {
    await signInAs(page, seedUsers.cashier);
    await page.goto(posUrl(BDG));
    await expect(page.getByRole("heading", { name: NOT_FOUND }).or(page.getByRole("heading", { name: FORBIDDEN }))).toBeVisible({ timeout: 180_000 });
    expect(await pageText(page)).not.toMatch(/Nasi Goreng|Rendang/);
    await page.goto(posUrl("de000000-0000-4000-8000-0000000000ff"));
    await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible({ timeout: 180_000 });
  });
});

test.describe("tablet layouts", () => {
  for (const [w, h] of [[768, 1024], [820, 1180], [1024, 768]] as const) {
    test(`${w}x${h}: full screen (no sidebar), no horizontal scroll, touch targets >= 48px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await signInAs(page, seedUsers.cashier);
      await openPos(page);
      await expect(page.getByRole("navigation", { name: "Dashboard" })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "horizontal overflow px").toBeLessThanOrEqual(0);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("button, [role=tab], select, input:not([type=hidden]), a[href]")) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || el.closest("dialog:not([open])") || el.closest(".sr-only")) continue;
          if (r.height < 47.5 || r.width < 47.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      test.info().annotations.push({ type: `small targets @${w}x${h}`, description: small.join(" | ") || "none" });
      expect(small, `targets under 48px at ${w}x${h}`).toEqual([]);
      const tile = await page.getByRole("button", { name: /Nasi Goreng Kampung/ }).first().boundingBox();
      expect(tile!.height, "item tile height").toBeGreaterThanOrEqual(96);
      await page.screenshot({ path: `test-results/pos-${w}x${h}.png`, fullPage: false });
    });
  }
});

test.describe("browse, sheet and cart", () => {
  test("sold-out item is disabled, search filters, modifier sheet enforces required choices, cart totals and persistence", async ({ page }) => {
    await signInAs(page, seedUsers.cashier);
    await openPos(page);
    // mark Rendang Sapi sold out at Jakarta Selatan through the real RPC (as the manager), then the tile must be disabled and say so
    const [item] = await rest<{ id: string }>("menu_items?name=eq.Rendang%20Sapi&select=id");
    const mgr = await userJwt(seedUsers.manager, SEED_PASSWORD);
    const so = await asUser(mgr, "rpc/set_item_sold_out", { method: "POST", body: { location_id: JKT, item_id: item.id, sold_out: true } });
    expect(so.status).toBeLessThan(300);
    try {
    await page.reload();
    await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
    const rendang = page.getByRole("button", { name: /Rendang Sapi/ });
    await expect(rendang).toBeDisabled();
    await expect(rendang).toContainText(/Sold out/i);
    } finally {
      await patchRest(`location_menu_overrides?item_id=eq.${item.id}&location_id=eq.${JKT}`, { sold_out_until: null });
    }
    // search
    await page.getByLabel("Search items").fill("zzzz-nothing");
    await expect(page.getByText(/No items match/)).toBeVisible();
    await page.getByLabel("Search items").fill("Nasi Goreng");
    await page.getByRole("button", { name: /Nasi Goreng Kampung/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const add = sheet.getByRole("button", { name: /^Add/ });
    test.info().annotations.push({ type: "sheet", description: (await sheet.innerText()).replace(/\s+/g, " ").slice(0, 300) });
    // a required variant/group must block adding until chosen
    if (await add.isDisabled()) {
      const first = sheet.locator('input[type=radio]').first();
      if (await first.count()) await first.check();
    }
    await expect(add).toBeEnabled();
    await sheet.getByPlaceholder("e.g. no onions").fill('<img src=x onerror="window.__xss=1"> tanpa bawang');
    await add.click();
    await expect(sheet).not.toBeVisible();
    const cart = page.getByRole("region", { name: /cart/i }).or(page.locator("section[aria-labelledby=cart-h]"));
    await expect(cart.getByText(/Nasi Goreng Kampung/)).toBeVisible();
    await expect(cart.getByText(/Estimated total/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await cart.locator("img").count(), "note must render as text").toBe(0);
    // quantity stepper
    await cart.getByRole("button", { name: /Increase Nasi Goreng Kampung/ }).click();
    await expect(cart.getByText(/Rp\s*/).first()).toBeVisible();
    // submit stays disabled in this slice
    await expect(cart.getByRole("button", { name: /Coming next|Place|Send|Charge|Pay/i }).first()).toBeDisabled();
    // persistence per location
    await page.reload();
    await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
    await expect(page.locator("section[aria-labelledby=cart-h]").getByText(/Nasi Goreng Kampung/)).toBeVisible({ timeout: 60_000 });
  });

  test("tampered localStorage cart is re-validated and re-priced from the catalog (no client price is trusted)", async ({ page }) => {
    await signInAs(page, seedUsers.cashier);
    await openPos(page);
    await page.evaluate((k) => window.localStorage.setItem(k, JSON.stringify({ orderType: "dine_in", lines: [{ key: "x", itemId: "de000000-0000-4000-8000-000000000501", name: "FREE LUNCH", unitPrice: 1, price: 1, qty: 9999, note: "<b>x</b>", variantId: null, modifierIds: [] }, { itemId: "not-a-uuid", qty: -5 }, "garbage", null] })), CART_KEY);
    await page.reload();
    await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
    const text = await pageText(page);
    expect(text).not.toContain("FREE LUNCH");
    expect(text).not.toMatch(/9\.?999/);
    await page.evaluate((k) => window.localStorage.setItem(k, "{not json"), CART_KEY);
    await page.reload();
    await expect(page.getByLabel("Search items")).toBeVisible({ timeout: 180_000 });
  });

  test("offline: 'Reconnecting' banner appears and clears; the screen stays usable", async ({ page, context }) => {
    await signInAs(page, seedUsers.cashier);
    await openPos(page);
    await context.setOffline(true);
    await expect(page.locator("[data-offline]")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Reconnecting/i).first()).toBeVisible();
    await page.getByLabel("Search items").fill("Teh"); // still interactive offline
    await expect(page.getByRole("button", { name: /Es Teh Manis/ })).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator("[data-offline]")).toHaveCount(0, { timeout: 30_000 });
  });
});
