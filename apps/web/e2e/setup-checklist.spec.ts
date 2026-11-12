import { expect, test, type Page } from "@playwright/test";
import { open, signInAs } from "./support/flows";
import { seedUsers } from "./support/users";

// MSS-T10 (#105): the org home checklist. Every link it offers must be one the role can really open;
// roles without the permission see states but no links.
test.setTimeout(240_000); // cold `pnpm dev` compiles every linked page on first hit
const FORBIDDEN = /you don.t have access/i;
const NOT_FOUND = /^404$|page not found/i;

async function checklist(page: Page, slug = "demo") {
  await open(page, `/${slug}`);
  const main = page.getByRole("main");
  await expect(main.getByText(/\d+ of 5/).first()).toBeVisible({ timeout: 60_000 });
  // A finished checklist is collapsed behind "You're all set"; open it to read the rows.
  const done = main.getByText(/You.re all set/);
  if (await done.count()) await done.first().click();
  const hrefs = await main.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  return { text: (await main.innerText()).replace(/\s+/g, " "), hrefs };
}

const ROLES = [
  ["owner", seedUsers.owner],
  ["manager", seedUsers.manager],
  ["cashier", seedUsers.cashier],
  ["waiter", seedUsers.waiter],
  ["kitchen", seedUsers.kitchen],
] as const;

for (const [role, email] of ROLES) {
  test(`${role}: checklist shows five steps and every offered link is openable by this role`, async ({ page }) => {
    await signInAs(page, email);
    const { text, hrefs } = await checklist(page);
    for (const step of [/location/i, /table/i, /menu/i, /staff/i, /brand/i]) expect(text).toMatch(step);
    expect(text).toMatch(/of 5/);
    // only same-org links
    for (const h of hrefs) expect(h, `${role} href`).not.toMatch(/other-bistro/);
    const setupLinks = hrefs.filter((h) => /^\/demo\/(settings|staff|menu|[0-9a-f-]{36}\/tables)$/.test(h));
    for (const h of setupLinks) {
      await page.goto(h);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: FORBIDDEN }), `${role} -> ${h} forbidden`).toHaveCount(0);
      await expect(page.getByRole("heading", { name: NOT_FOUND }), `${role} -> ${h} 404`).toHaveCount(0);
    }
    if (role === "cashier" || role === "waiter" || role === "kitchen") {
      expect(setupLinks, `${role} must get no setup links`).toEqual([]);
    }
    test.info().annotations.push({ type: "links", description: `${role}: ${setupLinks.join(", ") || "none"} | ${text.slice(0, 200)}` });
  });
}

test("a partly set-up restaurant (Other Bistro) shows its own progress, links only to its own slug", async ({ page }) => {
  await signInAs(page, seedUsers.otherOwner);
  const { text, hrefs } = await checklist(page, "other-bistro");
  expect(text).toMatch(/\d of 5/);
  for (const h of hrefs.filter((x) => /settings|staff|menu|tables/.test(x))) expect(h).toMatch(/^\/other-bistro\//);
  test.info().annotations.push({ type: "other-bistro", description: text.slice(0, 300) });
});

test("other restaurant's owner sees only their own checklist at /demo (404, no Demo data)", async ({ page }) => {
  await signInAs(page, seedUsers.otherOwner);
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("body").innerText()).not.toMatch(/Demo Restaurant|of 5/);
});
