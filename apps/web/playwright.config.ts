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
    : {
        command: "pnpm dev",
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        // Arcjet must be off for e2e: its email validation rejects @restomate.local (no MX) and bot detection
        // blocks headless browsers. The Arcjet rules are checked separately against a production build.
        env: { ARCJET_KEY: "" },
      },
});
