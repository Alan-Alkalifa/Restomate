import { expect, type Page } from "@playwright/test";
import { extractLink, waitForEmail } from "./mailpit";
import { SEED_PASSWORD, uniqueEmail } from "./users";

/** Navigate and wait for hydration: a form submitted before hydration is lost. */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** Sign up with a fresh address, follow the Mailpit confirmation link, end on /onboarding signed in. */
export async function newConfirmedUser(page: Page, tag = "e2e"): Promise<{ email: string }> {
  const email = uniqueEmail(tag);
  const since = new Date(Date.now() - 1000);
  await open(page, "/signup");
  await page.getByLabel("Full name").fill("E2E Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // First signup after a cold `pnpm dev` start compiles the action route: allow for it.
  await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 60_000 });
  await page.goto(extractLink(await waitForEmail(email, { since, subject: /confirm/i })));
  await expect(page).toHaveURL(/\/onboarding/);
  await page.waitForLoadState("networkidle");
  return { email };
}

export function uniqueSlug(tag = "e2e"): string {
  return `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
