import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { deleteRest, insertRest, memberOf, orgIdOf, roleIdOf } from "./support/db";
import { open } from "./support/flows";
import { extractLink, waitForEmail } from "./support/mailpit";
import { uniqueEmail } from "./support/users";

// B1-T18 (#131): with platform signup OFF, only a token-bound invitee can create an account.
// Needs the LOCAL service-role key (see support/db.ts). Restores the setting afterwards. Serial: it flips a global flag.
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000); // cold `pnpm dev` compiles /invite and /signup on first hit

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "Sup3r-secret-e2e!";
const CHECK_EMAIL = /check your email|periksa email anda/i;
// The unprefixed /signup (reached from /invite) renders in the default locale (id), /en/signup in English.
const NAME = /Full name|Nama lengkap/;
const PASS = /^(Password|Kata sandi)/;

async function setSignup(enabled: boolean) {
  const res = await fetch(`${url()}/rest/v1/platform_settings?on_conflict=key`, {
    method: "POST",
    headers: { apikey: key(), authorization: `Bearer ${key()}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: "signup", value: { enabled } }),
  });
  if (!res.ok) throw new Error(`set signup -> ${res.status} ${await res.text()}`);
}

async function invite(email: string, opts: { revoked?: boolean } = {}) {
  const token = randomBytes(24).toString("hex");
  await insertRest("staff_invitations", {
    organization_id: await orgIdOf("demo"),
    email,
    role_id: await roleIdOf("demo", "waiter"),
    all_locations: true,
    token_hash: createHash("sha256").update(token).digest("hex"),
    revoked_at: opts.revoked ? new Date().toISOString() : null,
  });
  return token;
}

test.beforeAll(() => setSignup(false));
test.afterAll(async () => {
  await setSignup(true);
  await deleteRest("staff_invitations?email=like.signupoff*");
});

test("signup off: a direct Auth /signup for a stranger is refused (403) and creates no user", async () => {
  const email = uniqueEmail("signupoff-direct");
  const res = await fetch(`${url()}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(403);
  expect(await res.text()).toContain("SIGNUP_DISABLED");
});

test("signup off: the public form refuses a stranger", async ({ page }) => {
  await open(page, "/en/signup");
  await page.getByLabel(NAME).fill("Stranger");
  await page.getByLabel("Email").fill(uniqueEmail("signupoff-x"));
  await page.getByLabel(PASS).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(CHECK_EMAIL)).toHaveCount(0);
});

test("signup off: invitee from /invite/{token} → Create account → Mailpit → accepts", async ({ page }) => {
  const email = uniqueEmail("signupoff-ok");
  const token = await invite(email);
  const since = new Date(Date.now() - 1000);
  await open(page, `/invite/${token}`);
  await page.getByRole("link", { name: "Create account" }).click();
  await page.waitForURL(/\/signup\?next=/, { timeout: 120_000 });
  await page.getByLabel(NAME).fill("Invitee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(PASS).fill(PASSWORD);
  await page.getByRole("button", { name: /Create account|Buat akun/ }).click();
  await expect(page.getByText(CHECK_EMAIL)).toBeVisible({ timeout: 60_000 });
  await page.goto(extractLink(await waitForEmail(email, { since, subject: /confirm/i })));
  await open(page, `/invite/${token}`);
  await page.getByRole("button", { name: /Accept invitation|Terima undangan/ }).click();
  await expect.poll(async () => (await memberOf("demo", email))?.status, { timeout: 30_000 }).toBe("active");
});

test("signup off: the same invite form with a DIFFERENT email is refused", async ({ page }) => {
  const token = await invite(uniqueEmail("signupoff-owner"));
  await open(page, `/signup?next=${encodeURIComponent(`/invite/${token}`)}`);
  await page.getByLabel(NAME).fill("Thief");
  await page.getByLabel("Email").fill(uniqueEmail("signupoff-other"));
  await page.getByLabel(PASS).fill(PASSWORD);
  await page.getByRole("button", { name: /Create account|Buat akun/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(CHECK_EMAIL)).toHaveCount(0);
});

test("signup off: a revoked invitation token is refused", async ({ page }) => {
  const email = uniqueEmail("signupoff-rev");
  const token = await invite(email, { revoked: true });
  await open(page, `/signup?next=${encodeURIComponent(`/invite/${token}`)}`);
  await page.getByLabel(NAME).fill("Revoked");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(PASS).fill(PASSWORD);
  await page.getByRole("button", { name: /Create account|Buat akun/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(CHECK_EMAIL)).toHaveCount(0);
});
