import { expect, test } from "@playwright/test";
import { asUser, locationsOf, memberOf, orgIdOf, rest, userJwt } from "./support/db";
import { open, pageText, signInAs } from "./support/flows";
import { SEED_PASSWORD, seedUsers } from "./support/users";

/*
 * Cross-tenant isolation e2e (MF-T30, M0 exit criterion 3). Demo Restaurant (slug demo) vs Other Bistro (other-bistro).
 * Any cross-tenant read here is an S1. Asserted three ways: the rendered view by URL, the Server Action level, and the
 * Supabase API directly as the signed-in user (RLS). Refused views are HTTP 200 by design under Next 16 streaming,
 * so we assert the heading and that the page (text and HTML) carries no data of the other tenant.
 */

// Non-members get the standard 404 view (heading "404"); restaurant-level notices say "Page not found".
const NOT_FOUND = /^404$|page not found/i;
const DEMO_SECRETS = ["Demo Restaurant", "owner@demo.local", "manager@demo.local", "cashier@demo.local", "waiter@demo.local", "kitchen@demo.local", "Jakarta Selatan"];
const OTHER_SECRETS = ["Other Bistro", "owner@other.local"];

/** An RLS refusal is either an empty result or an explicit permission error (both mean: nothing readable/changeable). */
function expectRefused(r: { status: number; json: unknown }, what: string) {
  const empty = Array.isArray(r.json) && r.json.length === 0;
  const denied = r.status === 401 || r.status === 403 || (typeof r.json === "object" && r.json !== null && (r.json as { code?: string }).code === "42501");
  expect(empty || denied || r.json === null, `${what}: expected refusal, got ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`).toBe(true);
}

function expectNoneOf(text: string, secrets: string[], where: string) {
  for (const s of secrets) expect(text, `${where} leaked "${s}"`).not.toContain(s);
}

test.describe("by URL: another restaurant's users get a 404 view and no data", () => {
  test("owner@other.local opening /demo/... sees nothing of Demo Restaurant", async ({ page }) => {
    const demoLocs = await locationsOf("demo");
    await signInAs(page, seedUsers.otherOwner);
    for (const path of ["/demo", "/demo/staff", "/demo/settings", `/demo/${demoLocs[0].id}/orders`, `/demo/${demoLocs[0].id}/pos`, "/demo/customers"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
      expectNoneOf(await pageText(page), DEMO_SECRETS, path);
    }
  });

  for (const [label, email] of [["waiter", seedUsers.waiter], ["kitchen", seedUsers.kitchen], ["cashier", seedUsers.cashier], ["manager", seedUsers.manager], ["owner", seedUsers.owner]] as const) {
    test(`demo ${label} opening /other-bistro/... sees nothing of Other Bistro`, async ({ page }) => {
      const otherLocs = await locationsOf("other-bistro");
      await signInAs(page, email);
      for (const path of ["/other-bistro", "/other-bistro/staff", "/other-bistro/settings", `/other-bistro/${otherLocs[0].id}/orders`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
        expectNoneOf(await pageText(page), OTHER_SECRETS, path);
      }
    });
  }

  test("signed-out visitors never see tenant data either", async ({ page }) => {
    await page.goto("/demo/staff");
    await expect(page).toHaveURL(/\/login/);
    expectNoneOf(await pageText(page), DEMO_SECRETS, "signed-out /demo/staff");
  });
});

test.describe("at the Server Action level", () => {
  test("a Demo manager forging another restaurant's member id into Deactivate changes nothing", async ({ page }) => {
    const target = await memberOf("other-bistro", seedUsers.otherOwner);
    expect(target?.status).toBe("active");
    await signInAs(page, seedUsers.manager);
    await open(page, "/demo/staff");
    // Open Deactivate for a real demo member, then swap the hidden member id for the foreign one.
    const row = page.locator("tr", { hasText: seedUsers.waiter }).first();
    await row.getByRole("button", { name: "Deactivate" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("input[name=memberId]").evaluate((el, id) => { (el as HTMLInputElement).value = id; }, target!.id);
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect(dialog.getByRole("alert")).not.toHaveText("", { timeout: 20_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await memberOf("other-bistro", seedUsers.otherOwner))?.status).toBe("active"); // untouched
    expect((await memberOf("demo", seedUsers.waiter))?.status).toBe("active"); // and the real target was not hit either
  });

  test("a Demo owner forging another restaurant's member id into Role change changes nothing", async ({ page }) => {
    const target = await memberOf("other-bistro", seedUsers.otherOwner);
    await signInAs(page, seedUsers.owner);
    await open(page, "/demo/staff");
    const row = page.locator("tr", { hasText: seedUsers.waiter }).first();
    await row.getByRole("button", { name: "Role" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("input[name=memberId]").evaluate((el, id) => { (el as HTMLInputElement).value = id; }, target!.id);
    await dialog.getByLabel("Role").selectOption({ label: "Cashier" });
    await dialog.getByRole("button", { name: "Save role" }).click();
    await new Promise((r) => setTimeout(r, 3000));
    expect((await memberOf("other-bistro", seedUsers.otherOwner))?.roleKey).toBe("owner");
    expect((await memberOf("demo", seedUsers.waiter))?.roleKey).toBe("waiter");
  });
});

test.describe("directly against the Supabase API as the signed-in user (RLS)", () => {
  test("a Demo manager reads nothing of Other Bistro and can change nothing", async () => {
    const jwt = await userJwt(seedUsers.manager, SEED_PASSWORD);
    const other = await orgIdOf("other-bistro");
    const demo = await orgIdOf("demo");
    const tables = ["organization_members", "staff_invitations", "locations", "roles", "subscriptions", "audit_logs", "org_branding", "location_staff", "organizations"];
    for (const t of tables) {
      const col = t === "organizations" ? "id" : "organization_id";
      const r = await asUser(jwt, `${t}?${col}=eq.${other}&select=*`);
      expect(r.status, t).toBeLessThan(500);
      expectRefused(r, `${t} of Other Bistro`);
    }
    // Control: the same user does see their own tenant's members (the query itself works).
    const own = await asUser(jwt, `organization_members?organization_id=eq.${demo}&select=id`);
    expect((own.json as unknown[]).length).toBeGreaterThan(0);

    // Writes against Other Bistro: nothing changes.
    const upd = await asUser(jwt, `organizations?id=eq.${other}`, { method: "PATCH", body: { name: "Hacked" } });
    expectRefused(upd, "PATCH organizations");
    const ins = await asUser(jwt, "locations", { method: "POST", body: { organization_id: other, name: "Injected", timezone: "UTC", currency: "IDR" } });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    const del = await asUser(jwt, `organization_members?organization_id=eq.${other}`, { method: "DELETE" });
    expectRefused(del, "DELETE organization_members");

    const [orgRow] = await rest<{ name: string }>(`organizations?id=eq.${other}&select=name`);
    expect(orgRow.name).toBe("Other Bistro");
    expect(await rest(`locations?organization_id=eq.${other}&name=eq.Injected&select=id`)).toHaveLength(0);
    expect((await memberOf("other-bistro", seedUsers.otherOwner))?.status).toBe("active");
  });

  test("a Demo cashier cannot read staff data or change roles, even in their own restaurant", async () => {
    const jwt = await userJwt(seedUsers.cashier, SEED_PASSWORD);
    const demo = await orgIdOf("demo");
    const invites = await asUser(jwt, `staff_invitations?organization_id=eq.${demo}&select=id`);
    expectRefused(invites, "cashier reads staff_invitations");
    const audit = await asUser(jwt, `audit_logs?organization_id=eq.${demo}&select=id`);
    expectRefused(audit, "cashier reads audit_logs");
    const self = await memberOf("demo", seedUsers.cashier);
    const ownerRole = await rest<{ id: string }>(`roles?organization_id=eq.${demo}&key=eq.owner&select=id`);
    const escalate = await asUser(jwt, `organization_members?id=eq.${self!.id}`, { method: "PATCH", body: { role_id: ownerRole[0].id } });
    expectRefused(escalate, "cashier PATCHes own role");
    expect((await memberOf("demo", seedUsers.cashier))?.roleKey).toBe("cashier");
  });
});
