import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "./support/mailpit";
import { NEW_PASSWORD, SEED_PASSWORD, seedUsers, uniqueEmail } from "./support/users";

/*
 * Auth e2e (MF-T28). Every test uses its own throwaway address (uniqueEmail) or a read-only seed user, so tests
 * are independent and order-free. Mail is awaited with polling (support/mailpit.ts), never with sleeps.
 * Requires: `supabase start` (Auth + Mailpit), seed data, and ARCJET_KEY unset (the config handles that).
 */

const CHECK_EMAIL = /check your email/i;
const BAD_CREDENTIALS = "Invalid email or password.";
const PASSWORD = SEED_PASSWORD; // 19 chars: within the 10..72-byte rule

/** Navigate and wait until the page is hydrated: a form submitted before hydration is lost. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function login(page: Page, email: string, password: string, next?: string) {
  await open(page, next ? `/en/login?next=${encodeURIComponent(next)}` : "/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the session is established (navigating earlier would interrupt the login action). */
async function loginOk(page: Page, email: string, password: string) {
  await login(page, email, password);
  await expect(page).not.toHaveURL(/\/login/);
}

async function signup(page: Page, email: string, password = PASSWORD, next?: string) {
  await open(page, next ? `/en/signup?next=${encodeURIComponent(next)}` : "/en/signup");
  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Signs up with a fresh address, follows the confirmation mail, and returns the confirmed address. */
async function confirmedUser(page: Page, tag = "e2e"): Promise<{ email: string; link: string }> {
  const email = uniqueEmail(tag);
  const since = new Date(Date.now() - 1000);
  await signup(page, email);
  await expect(page.getByText(CHECK_EMAIL)).toBeVisible();
  const link = extractLink(await waitForEmail(email, { since, subject: /confirm/i }));
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding/);
  return { email, link };
}

test.describe("signup and email confirmation", () => {
  test("signup -> Mailpit -> confirm link -> signed in on /onboarding", async ({ page }) => {
    await confirmedUser(page);
    // Signed in: the protected page stays reachable.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("a spent confirmation link shows link_expired on /login", async ({ page, browser }) => {
    const { link } = await confirmedUser(page);
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    // `lang=en` asks for the English page (the mail link itself carries no hint, see BUG-113-1).
    await other.goto(`${link}&lang=en`);
    await expect(other).toHaveURL(/\/en\/login\?error=link_expired/);
    await expect(other.getByText(/expired or was already used/i)).toBeVisible();
    await fresh.close();
  });

  test("signing up with an existing email gives the same 'check your email' response", async ({ page }) => {
    await signup(page, seedUsers.owner);
    await expect(page.getByText(CHECK_EMAIL)).toBeVisible();
  });

  test("password rules: hint says 10, 9 chars is rejected", async ({ page }) => {
    await open(page, "/en/signup");
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
    await signup(page, uniqueEmail(), "abcdefghi");
    await expect(page.getByText(/at least 10 characters/i).last()).toBeVisible();
    await expect(page.getByText(CHECK_EMAIL)).toHaveCount(0);
  });

  test("password over 72 bytes is rejected, exactly 72 is accepted", async ({ page }) => {
    await signup(page, uniqueEmail(), "a".repeat(73));
    await expect(page.getByText(/too long/i)).toBeVisible();
    await signup(page, uniqueEmail(), "a".repeat(72));
    await expect(page.getByText(CHECK_EMAIL)).toBeVisible();
  });
});

test.describe("login and sign out", () => {
  test("seed user signs in", async ({ page }) => {
    await login(page, seedUsers.owner, SEED_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("wrong password: generic error, stays on /login", async ({ page }) => {
    await login(page, seedUsers.owner, "definitely-wrong-password");
    await expect(page.getByText(BAD_CREDENTIALS)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown email gets exactly the same error (no enumeration)", async ({ page }) => {
    await login(page, uniqueEmail("nobody"), "definitely-wrong-password");
    await expect(page.getByText(BAD_CREDENTIALS)).toBeVisible();
  });

  test("sign out, then protected pages redirect to /login", async ({ page }) => {
    await loginOk(page, seedUsers.owner, SEED_PASSWORD);
    await page.goto("/demo");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    for (const path of ["/onboarding", "/demo/staff"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("signed-out visit to /onboarding goes to /login?next=/onboarding", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login\?next=%2Fonboarding/);
  });

  test("a signed-in user is sent away from /login and /signup", async ({ page }) => {
    await login(page, seedUsers.owner, SEED_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
    for (const path of ["/login", "/signup", "/en/login", "/en/signup"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path));
    }
  });
});

test.describe("open redirect via ?next=", () => {
  const evil = ["//evil.com", "https://evil.com", "/\\evil.com", "/\\/evil.com", "javascript:alert(1)"];

  for (const next of evil) {
    test(`login next=${next} never leaves the site`, async ({ page, baseURL }) => {
      await login(page, seedUsers.owner, SEED_PASSWORD, next);
      await page.waitForURL((u) => !/^\/(en\/)?login/.test(u.pathname));
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    });
  }

  for (const next of ["//evil.com", "https://evil.com"]) {
    test(`signup next=${next}: the confirm link carries /onboarding, not the payload`, async ({ page }) => {
      const email = uniqueEmail("redir");
      const since = new Date(Date.now() - 1000);
      await signup(page, email, PASSWORD, next);
      await expect(page.getByText(CHECK_EMAIL)).toBeVisible();
      const link = extractLink(await waitForEmail(email, { since, subject: /confirm/i }));
      expect(decodeURIComponent(link)).not.toMatch(/evil\.com/);
    });
  }

  test("a tampered ?next= on the confirm link itself stays on-site", async ({ page, baseURL, browser }) => {
    const email = uniqueEmail("tamper");
    const since = new Date(Date.now() - 1000);
    await signup(page, email);
    const link = new URL(extractLink(await waitForEmail(email, { since, subject: /confirm/i })));
    const target = link.searchParams.get("redirect_to") ? new URL(link.searchParams.get("redirect_to")!) : link;
    target.searchParams.set("next", "//evil.com");
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(link.searchParams.get("redirect_to") ? link.toString().replace(/redirect_to=[^&]*/, `redirect_to=${encodeURIComponent(target.toString())}`) : target.toString());
    await p.waitForLoadState("domcontentloaded");
    expect(new URL(p.url()).origin).toBe(new URL(baseURL!).origin);
    await ctx.close();
  });
});

test.describe("password reset", () => {
  test("forgot -> Mailpit -> reset -> success state -> old password fails, new one works", async ({ page, browser }) => {
    const { email } = await confirmedUser(page, "reset");
    await page.context().clearCookies();

    const since = new Date(Date.now() - 1000);
    await open(page, "/en/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();

    const link = extractLink(await waitForEmail(email, { since, subject: /reset|password/i }));
    // BUG-113-1: the mail link has no language hint and /auth/confirm ignores `lang` for the reset landing, so it lands
    // on the Bahasa page. The flow is then continued on the English page (the session cookie is already set).
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password/);
    await page.goto("/en/reset-password");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill("a-different-password-1");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/do not match/i)).toBeVisible();

    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/your password has been updated/i)).toBeVisible();

    // The reset link is single use.
    const ctx = await browser.newContext();
    const reuse = await ctx.newPage();
    await reuse.goto(link);
    await expect(reuse).toHaveURL(/\/login\?error=link_expired/);
    await ctx.close();

    await page.context().clearCookies();
    await login(page, email, PASSWORD);
    await expect(page.getByText(BAD_CREDENTIALS)).toBeVisible(); // old password no longer works
    await loginOk(page, email, NEW_PASSWORD);
  });

  // Expected to FAIL until BUG-113-1 is fixed (test.fail turns red when it starts passing: then delete the annotation).
  test("an English user's reset link lands on /en/reset-password", async ({ page }) => {
    test.fail(true, "BUG-113-1: /auth/confirm uses next=/reset-password from the mail and ignores lang=en; the /en forms post no locale");
    const { email } = await confirmedUser(page, "resetlang");
    await page.context().clearCookies();
    const since = new Date(Date.now() - 1000);
    await open(page, "/en/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
    await page.goto(extractLink(await waitForEmail(email, { since, subject: /reset|password/i })));
    await expect(page).toHaveURL(/\/en\/reset-password/);
  });

  test("forgot password answers identically for an unknown email", async ({ page }) => {
    await open(page, "/en/forgot-password");
    await page.getByLabel("Email").fill(uniqueEmail("nobody"));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });

  test("an ordinary (password) session cannot change the password", async ({ page }) => {
    await loginOk(page, seedUsers.manager, SEED_PASSWORD);
    await open(page, "/en/reset-password");
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/reset link has expired/i)).toBeVisible();
  });
});
