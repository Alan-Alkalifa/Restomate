import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { extractLink, waitForEmail } from "./support/mailpit";
import { auditActions, invitationsFor, locationsOf, memberCount, memberOf, patchRest, rest, roleIdOf } from "./support/db";
import { open, pageText, sidebarLabels, signInAs } from "./support/flows";
import { inviteUrlOf, waitForSentMail } from "./support/resend-mock";
import { SEED_PASSWORD, seedUsers, uniqueEmail } from "./support/users";

/*
 * Staff e2e (MF-T30, M0 exit criterion 2): owner invites a Cashier, the invitee accepts, sees only cashier things;
 * link lifecycle, role restrictions enforced server-side, stale-cache check after a role change, deactivation.
 * Invite mails are captured by support/mock-resend.mjs (the app talks to it through RESEND_BASE_URL).
 * Under Next 16 streaming, refused views are HTTP 200 by design: we assert the rendered view and that no tenant data is in the page.
 */

const INVITE_PASSWORD = SEED_PASSWORD;
const FORBIDDEN = /you don.t have access/i;
// Non-members and deactivated members get the standard 404 view (heading "404"); restaurant-level notices say "Page not found".
const NOT_FOUND = /^404$|page not found/i;
const CASHIER_NAV = ["Customers", "Home", "Kitchen", "Orders", "POS", "Payments", "Tables"].sort();

async function ownerInvites(page: Page, email: string, roleLabel: string, opts: { locationName?: string } = {}) {
  await open(page, "/demo/staff");
  await page.getByRole("button", { name: "Invite staff" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Role").selectOption({ label: roleLabel });
  if (opts.locationName) {
    await dialog.getByLabel("All locations").uncheck();
    await dialog.getByLabel(opts.locationName).check();
  }
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 30_000 });
}

type CapturedAction = { url: string; headers: Record<string, string>; body: Buffer; email: string };

/**
 * Captures the REAL Server Action request that the invite dialog sends (URL, Next-Action id, bound args and body), so a
 * test can replay it from another session with only the invitee address changed. Independent of how the form is wired.
 */
async function captureInviteAction(ownerPage: Page, email: string): Promise<CapturedAction> {
  const reqPromise = ownerPage.waitForRequest((r) => r.method() === "POST" && "next-action" in r.headers() && (r.postData() ?? "").includes(email));
  await ownerInvites(ownerPage, email, "Cashier");
  const req = await reqPromise;
  const headers: Record<string, string> = {};
  for (const k of ["next-action", "next-router-state-tree", "content-type", "accept"]) {
    const v = req.headers()[k];
    if (v) headers[k] = v;
  }
  return { url: req.url(), headers, body: req.postDataBuffer() ?? Buffer.from(""), email };
}

/** Replays a captured invite action with another invitee address, using `page`'s own cookies (its own session). */
async function replayInvite(page: Page, cap: CapturedAction, newEmail: string) {
  const body = Buffer.from(cap.body.toString("utf8").split(cap.email).join(newEmail), "utf8");
  return page.request.post(cap.url, { headers: cap.headers, data: body });
}

/** Owner invites `email`; returns the accept URL read from the captured mail. */
async function inviteAndGetUrl(browser: Browser, email: string, role = "Cashier", opts: { locationName?: string } = {}): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, seedUsers.owner);
  await ownerInvites(page, email, role, opts);
  const [mail] = await waitForSentMail(email);
  await ctx.close();
  return inviteUrlOf(mail);
}

async function invalidPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: /this invitation link isn.t valid/i })).toBeVisible();
}

test.describe("Cashier lifecycle (exit criterion 2)", () => {
  test.describe.configure({ mode: "serial" });

  const cashierEmail = uniqueEmail("cashier");
  let inviteUrl = "";
  let bandungId = "";
  let jakartaId = "";

  test("owner invites a Cashier for ONE location (dialog); the mail goes to the invitee", async ({ browser }) => {
    const locs = await locationsOf("demo");
    expect(locs.length).toBeGreaterThanOrEqual(2);
    [bandungId, jakartaId] = [locs[0].id, locs[1].id];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInAs(page, seedUsers.owner);
    await ownerInvites(page, cashierEmail, "Cashier", { locationName: locs[0].name });
    await expect.poll(async () => (await invitationsFor("demo", cashierEmail)).length, { timeout: 30_000 }).toBe(1);

    const mails = await waitForSentMail(cashierEmail);
    expect(mails).toHaveLength(1);
    expect(String(mails[0].to)).toContain(cashierEmail);
    expect(`${mails[0].html} ${mails[0].subject}`).toMatch(/demo restaurant/i);
    expect(mails[0].html).toMatch(/cashier/i);
    expect(mails[0].idempotencyKey).toBeTruthy();
    inviteUrl = inviteUrlOf(mails[0]);
    await ctx.close();
  });

  // Was an S2 (B1-T09 + B1-T10): an unchecked "All locations" box sent no field and the dialog hid the error.
  test("owner invites a Cashier for ONE location through the invite dialog", async ({ page }) => {
    await signInAs(page, seedUsers.owner);
    const email = uniqueEmail("ui-one-loc");
    const [first] = await locationsOf("demo");
    await ownerInvites(page, email, "Cashier", { locationName: first.name });
    await expect.poll(async () => (await invitationsFor("demo", email)).length, { timeout: 30_000 }).toBe(1);
    const [inv] = await rest<{ all_locations: boolean; location_ids: string[] }>(
      `staff_invitations?email=eq.${encodeURIComponent(email)}&select=all_locations,location_ids`,
    );
    expect(inv.all_locations).toBe(false);
    expect(inv.location_ids).toEqual([first.id]);
  });

  test("uncheck All locations without choosing one: a visible message, the typed email and role are kept, nothing is created", async ({ page }) => {
    await signInAs(page, seedUsers.owner);
    await open(page, "/demo/staff");
    const email = uniqueEmail("ui-no-loc");
    await page.getByRole("button", { name: "Invite staff" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Role").selectOption({ label: "Kitchen" });
    await dialog.getByLabel("All locations").uncheck();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByText(/choose at least one location/i).first()).toBeVisible();
    await expect(dialog.getByLabel("Email")).toHaveValue(email);
    await expect(dialog.getByLabel("Role")).toHaveValue(await roleIdOf("demo", "kitchen"));
    await new Promise((r) => setTimeout(r, 2000));
    expect(await invitationsFor("demo", email)).toHaveLength(0);
  });

  test("signed-out preview masks the email; invitee signs up from the link, confirms, accepts, lands in /demo as Cashier", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await open(page, inviteUrl);
    await expect(page.getByRole("heading", { name: /join demo restaurant/i })).toBeVisible();
    await expect(page.getByText(/invited as\s*cashier/i)).toBeVisible();
    const preview = await pageText(page);
    expect(preview).not.toContain(cashierEmail); // masked hint only (c***@…)
    expect(preview).toMatch(/c\*\*\*@/);

    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/signup\?next=/);
    await page.waitForLoadState("networkidle");
    const since = new Date(Date.now() - 1000);
    await page.getByLabel("Full name").fill("Cashier Live");
    await page.getByLabel("Email").fill(cashierEmail);
    await page.getByLabel("Password").fill(INVITE_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 60_000 });
    await page.goto(extractLink(await waitForEmail(cashierEmail, { since, subject: /confirm/i })));
    await expect(page).toHaveURL(/\/invite\//); // back on the invite page, signed in
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(/\/demo$/);

    // Exactly the cashier sidebar, only the invited location.
    expect(await sidebarLabels(page, "demo")).toEqual(CASHIER_NAV);
    const options = await page.locator("select option").allTextContents();
    const locs = await locationsOf("demo");
    expect(options.join("|")).toContain(locs[0].name);
    expect(options.join("|")).not.toContain(locs[1].name);

    const member = await memberOf("demo", cashierEmail);
    expect(member).toMatchObject({ status: "active", roleKey: "cashier", allLocations: false, locationCount: 1 });
    const actions = await auditActions("demo");
    expect(actions).toEqual(expect.arrayContaining(["invitation.created", "invitation.accepted"]));
    await ctx.close();
  });

  test("as the Cashier, staff/settings/reports/menu are refused server-side with no tenant data", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInAs(page, cashierEmail, INVITE_PASSWORD);
    for (const path of ["/demo/staff", "/demo/settings", `/demo/${bandungId}/reports`, `/demo/${bandungId}/menu`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: FORBIDDEN })).toBeVisible();
      const text = await pageText(page);
      for (const secret of [seedUsers.owner, seedUsers.manager, seedUsers.waiter, "Jakarta Selatan"]) {
        expect(text, `${path} leaked ${secret}`).not.toContain(secret);
      }
    }
    // The invited location's own pages stay reachable; the other location is not.
    await page.goto(`/demo/${bandungId}/orders`);
    await expect(page.getByRole("heading", { name: FORBIDDEN })).toHaveCount(0);
    await page.goto(`/demo/${jakartaId}/orders`);
    await expect(page.getByRole("heading", { name: FORBIDDEN }).or(page.getByRole("heading", { name: NOT_FOUND }))).toBeVisible();
    await ctx.close();
  });

  test("a crafted inviteStaff request from the Cashier is rejected (control: the identical request works for the owner)", async ({ browser }) => {
    const oCtx = await browser.newContext();
    const owner = await oCtx.newPage();
    await signInAs(owner, seedUsers.owner);
    const cap = await captureInviteAction(owner, uniqueEmail("crafted-src")); // the real request, as the dialog sends it

    const control = uniqueEmail("crafted-ok");
    expect((await replayInvite(owner, cap, control)).status()).toBeLessThan(500);
    await expect.poll(async () => (await invitationsFor("demo", control)).length, { timeout: 30_000 }).toBe(1);

    const cCtx = await browser.newContext();
    const cashier = await cCtx.newPage();
    await signInAs(cashier, cashierEmail, INVITE_PASSWORD);
    const evil = uniqueEmail("crafted-bad");
    expect((await replayInvite(cashier, cap, evil)).status()).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 3000)); // absence needs a bounded wait: a created row would appear within it
    expect(await invitationsFor("demo", evil)).toHaveLength(0);
    await oCtx.close();
    await cCtx.close();
  });

  test("owner re-scopes the Cashier through the Locations dialog: other location, then all locations", async ({ browser }) => {
    const [bandung, jakarta] = await locationsOf("demo");
    const ctx = await browser.newContext();
    const owner = await ctx.newPage();
    await signInAs(owner, seedUsers.owner);
    await open(owner, "/demo/staff");
    const row = () => owner.locator("tr", { hasText: cashierEmail }).first();

    await row().getByRole("button", { name: "Locations" }).click();
    let dialog = owner.locator("dialog[open]");
    await dialog.getByLabel(bandung.name).uncheck();
    await dialog.getByLabel(jakarta.name).check();
    await dialog.getByRole("button", { name: "Save locations" }).click();
    await expect.poll(async () => {
      const [m] = await rest<{ id: string }>(`profiles?email=eq.${encodeURIComponent(cashierEmail)}&select=id`);
      const ls = await rest<{ location_id: string }>(`location_staff?select=location_id,organization_members!inner(user_id)&organization_members.user_id=eq.${m.id}`);
      return ls.map((l) => l.location_id);
    }, { timeout: 30_000 }).toEqual([jakarta.id]);

    await open(owner, "/demo/staff");
    await row().getByRole("button", { name: "Locations" }).click();
    dialog = owner.locator("dialog[open]");
    await dialog.getByLabel("All locations").check();
    await dialog.getByRole("button", { name: "Save locations" }).click();
    await expect.poll(async () => (await memberOf("demo", cashierEmail))?.allLocations, { timeout: 30_000 }).toBe(true);
    await ctx.close();
  });

  test("owner changes the Cashier to Waiter: an already-open Cashier session sees the new sidebar on next navigation", async ({ browser }) => {
    const cCtx = await browser.newContext();
    const cashier = await cCtx.newPage();
    await signInAs(cashier, cashierEmail, INVITE_PASSWORD);
    await open(cashier, "/demo");
    expect(await sidebarLabels(cashier, "demo")).toEqual(CASHIER_NAV);

    const oCtx = await browser.newContext();
    const owner = await oCtx.newPage();
    await signInAs(owner, seedUsers.owner);
    await open(owner, "/demo/staff");
    const row = owner.locator("tr", { hasText: cashierEmail }).first();
    await row.getByRole("button", { name: "Role" }).click();
    await owner.locator("dialog[open]").getByLabel("Role").selectOption({ label: "Waiter" });
    await owner.locator("dialog[open]").getByRole("button", { name: "Save role" }).click();
    await expect(owner.locator("dialog[open]")).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await memberOf("demo", cashierEmail))?.roleKey).toBe("waiter");

    // The waiter seed user's sidebar is the reference for "what a waiter sees".
    const wCtx = await browser.newContext();
    const waiter = await wCtx.newPage();
    await signInAs(waiter, seedUsers.waiter);
    await open(waiter, "/demo");
    const waiterNav = await sidebarLabels(waiter, "demo");
    expect(waiterNav).not.toEqual(CASHIER_NAV);

    await cashier.goto("/demo"); // same session, next navigation
    await cashier.waitForLoadState("networkidle");
    expect(await sidebarLabels(cashier, "demo")).toEqual(waiterNav);
    await oCtx.close(); await wCtx.close(); await cCtx.close();
  });

  test("owner deactivates the member: the open session loses access to /demo", async ({ browser }) => {
    const cCtx = await browser.newContext();
    const member = await cCtx.newPage();
    await signInAs(member, cashierEmail, INVITE_PASSWORD);
    await open(member, "/demo");
    await expect(member).toHaveURL(/\/demo$/);

    const oCtx = await browser.newContext();
    const owner = await oCtx.newPage();
    await signInAs(owner, seedUsers.owner);
    await open(owner, "/demo/staff");
    await owner.locator("tr", { hasText: cashierEmail }).first().getByRole("button", { name: "Deactivate" }).click();
    await owner.locator("dialog[open]").getByRole("button", { name: "Deactivate" }).click();
    await expect.poll(async () => (await memberOf("demo", cashierEmail))?.status).toBe("deactivated");

    for (const path of ["/demo", "/demo/staff", `/demo/${bandungId}/orders`]) {
      await member.goto(path);
      await expect(member.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
      const text = await pageText(member);
      expect(text).not.toContain("Demo Restaurant");
    }
    await oCtx.close(); await cCtx.close();
  });
});

test.describe("invitation links", () => {
  test("opened by a different signed-in user: explanation, no membership created", async ({ browser }) => {
    const invitee = uniqueEmail("wrong");
    const url = await inviteAndGetUrl(browser, invitee, "Waiter");
    const before = await memberCount("demo");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInAs(page, seedUsers.waiter);
    await page.goto(url);
    await expect(page.getByText(/signed in as a different account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    expect(await memberCount("demo")).toBe(before);
    await ctx.close();
  });

  test("resend kills the old link; revoke, expiry and garbage tokens all show the same generic page", async ({ browser }) => {
    const invitee = uniqueEmail("life");
    const oldUrl = await inviteAndGetUrl(browser, invitee, "Waiter");

    const oCtx = await browser.newContext();
    const owner = await oCtx.newPage();
    await signInAs(owner, seedUsers.owner);
    await open(owner, "/demo/staff");
    await owner.locator("tr", { hasText: invitee }).first().getByRole("button", { name: "Resend" }).click();
    await owner.locator("dialog[open]").getByRole("button", { name: "Resend" }).click();
    const mails = await waitForSentMail(invitee, { count: 2 });
    const newUrl = inviteUrlOf(mails[mails.length - 1]);
    expect(newUrl).not.toBe(oldUrl);

    const anon = await browser.newContext();
    const p = await anon.newPage();
    await invalidPage(p, oldUrl); // old link is dead
    await p.goto(newUrl);
    await expect(p.getByRole("heading", { name: /join demo restaurant/i })).toBeVisible(); // new link works

    // revoke
    await open(owner, "/demo/staff");
    await owner.locator("tr", { hasText: invitee }).first().getByRole("button", { name: "Revoke" }).click();
    await owner.locator("dialog[open]").getByRole("button", { name: "Revoke" }).click();
    await expect.poll(async () => (await invitationsFor("demo", invitee))[0]?.revoked_at).toBeTruthy();
    await invalidPage(p, newUrl);

    // expiry (a second, fresh invitation)
    const other = uniqueEmail("expire");
    const expUrl = await inviteAndGetUrl(browser, other, "Waiter");
    await patchRest(`staff_invitations?email=eq.${encodeURIComponent(other)}`, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    await invalidPage(p, expUrl);

    await invalidPage(p, `${new URL(newUrl).origin}/invite/${"x".repeat(40)}`);
    await oCtx.close(); await anon.close();
  });
});

test.describe("role restrictions on /demo/staff", () => {
  for (const [label, email] of [["waiter", seedUsers.waiter], ["kitchen", seedUsers.kitchen], ["cashier", seedUsers.cashier]] as const) {
    test(`${label} is refused (view + no staff data)`, async ({ page }) => {
      await signInAs(page, email);
      await page.goto("/demo/staff");
      await expect(page.getByRole("heading", { name: FORBIDDEN })).toBeVisible();
      const text = await pageText(page);
      expect(text).not.toContain(seedUsers.owner);
      expect(text).not.toContain(seedUsers.manager);
      await page.goto("/demo/settings");
      await expect(page.getByRole("heading", { name: FORBIDDEN })).toBeVisible();
    });
  }

  test("manager: no Owner role in the invite dialog, and a tampered Owner invite creates nothing", async ({ page }) => {
    await signInAs(page, seedUsers.manager);
    await open(page, "/demo/staff");
    await page.getByRole("button", { name: "Invite staff" }).click();
    const dialog = page.locator("dialog[open]");
    const roleOptions = await dialog.getByLabel("Role").locator("option").allTextContents();
    expect(roleOptions).not.toContain("Owner");

    const email = uniqueEmail("mgr-owner");
    const ownerRoleId = await roleIdOf("demo", "owner");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Role").evaluate((sel, id) => {
      const s = sel as HTMLSelectElement;
      const o = document.createElement("option");
      o.value = id; o.text = "TAMPERED"; s.add(o); s.value = id;
    }, ownerRoleId);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await new Promise((r) => setTimeout(r, 4000));
    expect(await invitationsFor("demo", email)).toHaveLength(0);
  });
});

test.describe("analytics", () => {
  test("the invite token never reaches PostHog (captured pageviews are scrubbed)", async ({ browser }) => {
    const invitee = uniqueEmail("ph");
    const url = await inviteAndGetUrl(browser, invitee, "Waiter");
    const token = new URL(url).pathname.split("/").pop()!;

    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (!req.url().startsWith("http://127.0.0.1:4010") || req.method() !== "POST") return;
      const buf = req.postDataBuffer();
      let text = "";
      if (buf) {
        try { text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8"); } catch { text = buf.toString("utf8"); }
      }
      bodies.push(`${req.url()}\n${text}`);
    });
    await open(page, url);
    await expect(page.getByRole("heading", { name: /join demo restaurant/i })).toBeVisible();
    // Give the SDK time to flush its pageview, then look at what reached the (mock) analytics host.
    await expect.poll(() => bodies.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const all = bodies.join("\n");
    expect(all, "invite token leaked to PostHog").not.toContain(token);
    expect(all).not.toContain(invitee);
    await ctx.close();
  });
});
