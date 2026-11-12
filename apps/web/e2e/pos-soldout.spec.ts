import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { asUser, patchRest, rest, userJwt } from "./support/db";
import { signInAs } from "./support/flows";
import { SEED_PASSWORD, seedUsers } from "./support/users";

// MSC-T06 (#141): "sold out today" from the POS grid, live across screens (Realtime #84), role gates.
test.setTimeout(1_200_000);
test.describe.configure({ mode: "serial" });
const JKT = "de000000-0000-4000-8000-0000000000a1";
const BDG = "de000000-0000-4000-8000-0000000000a2";
const ITEM = "Es Teh Manis"; // has variants (opens the options sheet) and is published at both locations
let itemId = "";

const tile = (page: Page, name = ITEM) => page.locator(`li[data-item-id]`).filter({ hasText: name }).first();

async function openPos(browser: Browser, email: string, query = ""): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, email);
  await page.goto(`/demo/${JKT}/pos${query}`);
  const search = page.getByLabel(/Search items|Cari/);
  await expect(search).toBeVisible({ timeout: 240_000 });
  await search.fill(ITEM); // the item sits on the Minuman tab, not the first one
  await expect(tile(page)).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

async function markSoldOut(page: Page) {
  await page.getByRole("button", { name: `More actions for ${ITEM}` }).click();
  const sheet = page.getByRole("dialog", { name: ITEM });
  await sheet.getByRole("button", { name: "Sold out today" }).click();
  await expect(sheet.getByText(`Mark ${ITEM} as sold out?`)).toBeVisible();
  await sheet.getByRole("button", { name: "Mark sold out" }).click();
}
async function markAvailable(page: Page) {
  await page.getByRole("button", { name: `More actions for ${ITEM}` }).click();
  await page.getByRole("dialog", { name: ITEM }).getByRole("button", { name: "Available again" }).click();
}
async function resetItem() {
  await patchRest(`location_menu_overrides?item_id=eq.${itemId}&location_id=eq.${JKT}`, { sold_out_until: null });
}

test.beforeAll(async () => {
  const [row] = await rest<{ id: string }>(`menu_items?name=eq.${encodeURIComponent(ITEM)}&select=id`);
  itemId = row.id;
  await resetItem();
});
test.afterAll(resetItem);

test("a second POS screen updates by itself (Realtime, no reload) when another screen marks an item sold out and back", async ({ browser }) => {
  const a = await openPos(browser, seedUsers.cashier);
  const b = await openPos(browser, seedUsers.waiter);
  try {
    await expect(tile(b).getByRole("button").first()).toBeEnabled();
    await markSoldOut(a.page);
    // well under the 15 s fallback poll, so this proves the live channel, not polling
    await expect(tile(b).getByRole("button").first()).toBeDisabled({ timeout: 10_000 });
    await expect(tile(b)).toContainText(/Sold out/i);
    await expect(tile(a.page)).toContainText(/Sold out/i);
    await markAvailable(a.page);
    await expect(tile(b).getByRole("button").first()).toBeEnabled({ timeout: 10_000 });
    await expect(tile(b)).not.toContainText(/Sold out/i);
  } finally {
    await resetItem();
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("a sold-out item can't be added: an options sheet open on another screen closes when the item goes sold out", async ({ browser }) => {
  const a = await openPos(browser, seedUsers.cashier);
  const b = await openPos(browser, seedUsers.waiter);
  try {
    await tile(b).getByRole("button").first().click();
    await expect(b.page.getByRole("dialog")).toBeVisible();
    await markSoldOut(a.page);
    await expect(b.page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
    await expect(tile(b).getByRole("button").first()).toBeDisabled();
    // the cart on screen B has nothing from the stale sheet
    await expect(b.page.locator("section[aria-labelledby=cart-h]")).not.toContainText(ITEM);
  } finally {
    await resetItem();
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("a screen that was offline refetches when it comes back online", async ({ browser }) => {
  const a = await openPos(browser, seedUsers.cashier);
  const b = await openPos(browser, seedUsers.waiter);
  try {
    await b.ctx.setOffline(true);
    await expect(b.page.locator("[data-offline]")).toBeVisible({ timeout: 30_000 });
    await markSoldOut(a.page);
    await b.ctx.setOffline(false);
    await expect(tile(b).getByRole("button").first()).toBeDisabled({ timeout: 40_000 });
  } finally {
    await b.ctx.setOffline(false).catch(() => {});
    await resetItem();
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("Bahasa strings, only itemId and soldOut are sent, and the ⋯ button is a 48px target", async ({ browser }) => {
  const a = await openPos(browser, seedUsers.cashier, "?lang=id");
  try {
    const more = a.page.getByRole("button", { name: /Tindakan lain untuk Es Teh Manis/ });
    const box = await more.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(47.5);
    expect(box!.height).toBeGreaterThanOrEqual(47.5);
    await more.click();
    const sheet = a.page.getByRole("dialog", { name: ITEM });
    await sheet.getByRole("button", { name: "Habis hari ini" }).click();
    await expect(sheet.getByText("Tandai Es Teh Manis habis?")).toBeVisible();
    const names = await sheet.locator("input[name]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name).filter((n) => !n.startsWith("$ACTION")));
    expect(names.sort(), "fields posted by the sheet").toEqual(["itemId", "soldOut"]);
    await sheet.getByRole("button", { name: "Tandai habis" }).click();
    await expect(tile(a.page)).toContainText("Habis", { timeout: 30_000 });
  } finally {
    await resetItem();
    await a.ctx.close();
  }
});

test("below the UI: the sold-out RPC refuses kitchen, other tenant and a cashier outside their location; client cannot pick another org's item", async () => {
  const tryRpc = async (email: string, loc: string) => {
    const jwt = await userJwt(email, SEED_PASSWORD);
    return asUser(jwt, "rpc/set_item_sold_out", { method: "POST", body: { location_id: loc, item_id: itemId, sold_out: true } });
  };
  for (const [who, email, loc] of [["kitchen", seedUsers.kitchen, JKT], ["other tenant owner", seedUsers.otherOwner, JKT], ["Jakarta cashier at Bandung", seedUsers.cashier, BDG]] as const) {
    const r = await tryRpc(email, loc);
    expect(r.status, `${who}`).toBeGreaterThanOrEqual(400);
  }
  const ok = await tryRpc(seedUsers.cashier, JKT);
  expect(ok.status, "cashier at own location (control)").toBeLessThan(300);
  await resetItem();
});
