import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Optional: use a system Chromium (sandboxes without the Playwright CDN). CI downloads its own.
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath, args: ["--no-sandbox"] } : {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 2,
  // `pnpm dev` compiles routes on first hit, so be generous; tests wait on conditions, never on fixed sleeps.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        // Resend stand-in: captures staff invitation mails so tests can read the accept link (see support/mock-resend.mjs).
        { command: "node e2e/support/mock-resend.mjs", url: "http://127.0.0.1:4010/health", reuseExistingServer: !process.env.CI, timeout: 30_000 },
        {
          command: "pnpm dev",
          url: `${baseURL}/login`,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
          env: {
            // Arcjet must be off for e2e: its email validation rejects @restomate.local (no MX) and bot detection
            // blocks headless browsers. The Arcjet rules are checked separately against a production build.
            ARCJET_KEY: "",
            // App emails go to the local mock instead of Resend.
            EMAIL_DELIVERY: "resend",
            RESEND_API_KEY: "re_e2e_mock",
            RESEND_BASE_URL: "http://127.0.0.1:4010",
            EMAIL_FROM: "Restomate <no-reply@mail.restomate.app>",
            // PostHog stand-in (same mock server): lets a test inspect what analytics would receive.
            NEXT_PUBLIC_POSTHOG_KEY: "phc_e2e_mock",
            NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:4010",
          },
        },
      ],
});
