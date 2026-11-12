import { expect, test } from "@playwright/test";
import { asUser, rest, userJwt } from "./support/db";
import { open, pageText, signInAs } from "./support/flows";
import { deleteMessagesTo, waitForEmail } from "./support/mailpit";
import { SEED_PASSWORD, seedUsers } from "./support/users";

// MSS-T06 (#95): super admin tenant detail. Platform-admin only; the owner reset goes to the right owner and is audited.
const NOT_FOUND = /^404$|page not found/i;
const DEMO = "de000000-0000-4000-8000-000000000001";
const OTHER = "de000000-0000-4000-8000-000000000002";
const OTHER_OWNER_ID = "a0000000-0000-4000-8000-000000000021";
const DEMO_OWNER_ID = "a0000000-0000-4000-8000-000000000011";

test.describe("super admin tenant detail", () => {
  test("platform admin sees every section for Demo Restaurant and Other Bistro", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    for (const [id, name, owner] of [[DEMO, "Demo Restaurant", seedUsers.owner], [OTHER, "Other Bistro", seedUsers.otherOwner]] as const) {
      await open(page, `/admin/tenants/${id}`);
      await expect(page.getByRole("heading", { name: new RegExp(name) }).first()).toBeVisible({ timeout: 60_000 });
      for (const h of ["Locations", "Plan & usage", "Subscription history", "Owners", "Audit trail"]) {
        await expect(page.getByRole("heading", { name: h, exact: true }), `${name} ${h}`).toBeVisible();
      }
      expect(await pageText(page)).toContain(owner);
      expect(await pageText(page)).toMatch(/Not tracked yet/); // orders per month is not metered yet
    }
  });

  test("unknown and malformed ids are 404", async ({ page }) => {
    await signInAs(page, seedUsers.platformAdmin);
    for (const id of ["de000000-0000-4000-8000-0000000009ff", "not-a-uuid", "1' or '1'='1", "%00"]) {
      await page.goto(`/admin/tenants/${encodeURIComponent(id)}`);
      await expect(page.getByRole("heading", { name: NOT_FOUND }), id).toBeVisible({ timeout: 60_000 });
    }
  });

  for (const [who, email] of [["restaurant owner", seedUsers.owner], ["manager", seedUsers.manager], ["other restaurant's owner", seedUsers.otherOwner]] as const) {
    test(`${who}: tenant detail pages are 404 with no tenant data`, async ({ page }) => {
      await signInAs(page, email);
      for (const id of [DEMO, OTHER]) {
        await page.goto(`/admin/tenants/${id}`);
        await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible({ timeout: 60_000 });
        const text = await pageText(page);
        for (const secret of ["Subscription history", "Audit trail", "Send password reset", "owner@other.local", "owner@demo.local"]) {
          expect(text, `${id} leaked ${secret}`).not.toContain(secret);
        }
      }
    });
  }

  test("owner reset: email goes to that owner only, success text is generic, and the action is audited", async ({ page }) => {
    await deleteMessagesTo(seedUsers.otherOwner);
    const since = new Date(Date.now() - 1000);
    await signInAs(page, seedUsers.platformAdmin);
    await open(page, `/admin/tenants/${OTHER}`);
    await page.getByRole("button", { name: "Send password reset" }).first().click();
    await page.getByRole("button", { name: "Send reset email" }).click();
    await expect(page.getByText(/If .*(email|address)|sent|will receive/i).first()).toBeVisible({ timeout: 60_000 });
    const mail = await waitForEmail(seedUsers.otherOwner, { since, subject: /reset|password|sandi/i, timeoutMs: 60_000 });
    expect(mail.subject).toBeTruthy();
    const audit = await rest<{ action: string; actor_id: string }>(`audit_logs?organization_id=eq.${OTHER}&action=eq.tenant.owner_password_reset&select=action,actor_id`);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].actor_id).toBeTruthy();
  });

  test("below the UI: the tenant RPCs refuse non-admins, and a user who is not an owner of the org", async () => {
    for (const email of [seedUsers.owner, seedUsers.manager, seedUsers.cashier, seedUsers.otherOwner]) {
      const jwt = await userJwt(email, SEED_PASSWORD);
      const detail = await asUser(jwt, "rpc/admin_get_tenant_detail", { method: "POST", body: { org_id: DEMO } });
      expect(detail.status, `${email} admin_get_tenant_detail`).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(detail.json)).not.toMatch(/owner@|Demo Restaurant/);
      const reset = await asUser(jwt, "rpc/admin_prepare_owner_password_reset", { method: "POST", body: { org_id: DEMO, user_id: DEMO_OWNER_ID } });
      expect(reset.status, `${email} admin_prepare_owner_password_reset`).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(reset.json)).not.toContain("owner@demo.local");
    }
    // Platform admin: the owner of org A cannot be reset through org B's id.
    const admin = await userJwt(seedUsers.platformAdmin, SEED_PASSWORD);
    const crossed = await asUser(admin, "rpc/admin_prepare_owner_password_reset", { method: "POST", body: { org_id: DEMO, user_id: OTHER_OWNER_ID } });
    expect(crossed.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(crossed.json)).not.toContain("owner@other.local");
  });
});
