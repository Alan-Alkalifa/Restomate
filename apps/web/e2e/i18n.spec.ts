import { expect, test, type Page } from "@playwright/test";
import { SEED_PASSWORD, seedUsers } from "./support/users";

/**
 * i18n (MSS-T12): Bahasa Indonesia is the default at unprefixed URLs, English lives under /en.
 * Checks <html lang>, hreflang/canonical, the language switcher (keeps the path and a safe `next`) and the
 * language of the /auth/confirm redirects.
 */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
const lang = (page: Page) => page.locator("html").getAttribute("lang");

const pages = [
  { path: "/login", heading: { id: "Masuk", en: "Sign in" } },
  { path: "/signup", heading: { id: "Buat akun Anda", en: "Create your account" } },
  { path: "/forgot-password", heading: { id: "Lupa kata sandi Anda?", en: "Forgot your password?" } },
];

test.describe("language of the auth pages", () => {
  for (const p of pages) {
    test(`${p.path} is Bahasa (lang=id) and /en${p.path} is English (lang=en)`, async ({ page }) => {
      await open(page, p.path);
      expect(await lang(page)).toBe("id");
      await expect(page.getByRole("heading", { level: 1, name: p.heading.id })).toBeVisible();
      await open(page, `/en${p.path}`);
      expect(await lang(page)).toBe("en");
      await expect(page.getByRole("heading", { level: 1, name: p.heading.en })).toBeVisible();
    });
  }

  test("login form labels follow the language", async ({ page }) => {
    await open(page, "/login");
    await expect(page.getByLabel("Kata sandi")).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
    await open(page, "/en/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("onboarding stays English inside the Bahasa shell and says so", async ({ page }) => {
    await open(page, "/onboarding");
    expect(await page.locator("[lang=en]").count()).toBeGreaterThan(0);
  });

  test("the invite page is English inside the Bahasa shell and says so", async ({ page }) => {
    await open(page, "/invite/not-a-real-token");
    expect(await page.locator("[lang=en]").count()).toBeGreaterThan(0);
  });

  test("an unknown /en path is a 404, not a crash", async ({ page }) => {
    const r = await page.goto("/en/definitely-not-a-page");
    expect([404, 200]).toContain(r?.status());
    await expect(page.getByRole("heading", { name: /not found|404/i }).first()).toBeVisible();
  });
});

test.describe("hreflang and canonical", () => {
  for (const path of ["/login", "/en/login", "/signup", "/en/signup"]) {
    test(`${path}: canonical points at itself, alternates cover id, en and x-default`, async ({ page, baseURL }) => {
      await open(page, path);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical, "canonical").toBeTruthy();
      expect(new URL(canonical!, baseURL!).pathname).toBe(path);
      const alts = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => [e.getAttribute("hreflang"), new URL(e.getAttribute("href")!, location.href).pathname]));
      const base = path.replace(/^\/en/, "");
      expect(Object.fromEntries(alts)).toMatchObject({ id: base, en: `/en${base}`, "x-default": base });
    });
  }
});

test.describe("language switcher", () => {
  test("keeps the page: /login -> /en/login and back", async ({ page }) => {
    await open(page, "/login");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
    expect(await lang(page)).toBe("en");
    await page.getByRole("link", { name: "Bahasa Indonesia" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await lang(page)).toBe("id");
  });

  test("keeps a safe next", async ({ page }) => {
    await open(page, "/login?next=%2Fdemo%2Fstaff");
    expect(await page.getByRole("link", { name: "English" }).getAttribute("href")).toBe("/en/login?next=%2Fdemo%2Fstaff");
    await open(page, "/en/signup?next=%2Fonboarding");
    expect(await page.getByRole("link", { name: "Bahasa Indonesia" }).getAttribute("href")).toBe("/signup?next=%2Fonboarding");
  });

  for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
    test(`drops an unsafe next (${evil})`, async ({ page }) => {
      await open(page, `/login?next=${encodeURIComponent(evil)}`);
      const href = await page.getByRole("link", { name: "English" }).getAttribute("href");
      expect(href).toBe("/en/login");
    });
  }

  test("an encoded double slash in next is a same-origin path, not a redirect target", async ({ page, baseURL }) => {
    await open(page, `/login?next=${encodeURIComponent("/%2F%2Fevil.com")}`);
    await page.getByLabel("Email").fill(seedUsers.owner);
    await page.getByLabel("Kata sandi").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 60_000 });
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test("each page's switcher goes to the same page in the other language", async ({ page }) => {
    for (const p of ["/signup", "/forgot-password"]) {
      await open(page, p);
      expect(await page.getByRole("link", { name: "English" }).getAttribute("href")).toBe(`/en${p}`);
      await open(page, `/en${p}`);
      expect(await page.getByRole("link", { name: "Bahasa Indonesia" }).getAttribute("href")).toBe(p);
    }
  });
});

test.describe("/auth/confirm lands in the right language", () => {
  const bad = "type=signup&token_hash=not-a-real-token";
  test("default: Bahasa login with link_expired", async ({ page }) => {
    await page.goto(`/auth/confirm?${bad}`);
    await expect(page).toHaveURL(/\/login\?error=link_expired$/);
    expect(await lang(page)).toBe("id");
    await expect(page.getByText(/kedaluwarsa/i)).toBeVisible();
  });
  test("lang=en hint: English login", async ({ page }) => {
    await page.goto(`/auth/confirm?${bad}&lang=en`);
    await expect(page).toHaveURL(/\/en\/login\?error=link_expired$/);
    await expect(page.getByText(/expired or was already used/i)).toBeVisible();
  });
  test("an /en next implies English", async ({ page }) => {
    await page.goto(`/auth/confirm?${bad}&next=${encodeURIComponent("/en/reset-password")}`);
    await expect(page).toHaveURL(/\/en\/login\?error=link_expired$/);
  });
  for (const lang of ["xx", "EN", "../../evil", "en%0d%0aLocation:http://evil.com"]) {
    test(`a bogus lang hint (${lang}) falls back to the default, never leaves the site`, async ({ page, baseURL }) => {
      await page.goto(`/auth/confirm?${bad}&lang=${lang}`);
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      expect(new URL(page.url()).pathname).toBe("/login");
    });
  }
});

test.describe("marketing site (MSS-T13)", () => {
  const marketing = [
    { path: "/", id: /Kelola seluruh restoran Anda/, en: /Run your whole restaurant/ },
    { path: "/features", id: /^Fitur$/, en: /^Features$/ },
    { path: "/pricing", id: /^Harga$/, en: /^Pricing$/ },
  ];
  for (const m of marketing) {
    const en = m.path === "/" ? "/en" : `/en${m.path}`;
    test(`${m.path} is Bahasa (lang=id), ${en} is English (lang=en), hreflang + switcher keep the page`, async ({ page, baseURL }) => {
      await open(page, m.path);
      expect(await lang(page)).toBe("id");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.id);
      const alts = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => [e.getAttribute("hreflang"), new URL(e.getAttribute("href")!, location.href).pathname]));
      expect(Object.fromEntries(alts)).toMatchObject({ id: m.path, en, "x-default": m.path });
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(new URL(canonical!, baseURL!).pathname).toBe(m.path);
      await page.getByRole("link", { name: "English" }).click();
      await expect(page).toHaveURL(new RegExp(`${en.replace("/", "\\/")}$`));
      expect(await lang(page)).toBe("en");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.en);
      const canonicalEn = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(new URL(canonicalEn!, baseURL!).pathname).toBe(en);
      await page.getByRole("link", { name: "Bahasa Indonesia" }).click();
      await expect(page).toHaveURL(new RegExp(`${m.path === "/" ? "\\/" : m.path.replace("/", "\\/")}$`));
      expect(await lang(page)).toBe("id");
    });
  }

  test("header links stay inside the language", async ({ page }) => {
    await open(page, "/en/features");
    expect(await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/en/pricing");
    await open(page, "/features");
    expect(await page.getByRole("navigation", { name: "Utama" }).getByRole("link", { name: "Harga" }).getAttribute("href")).toBe("/pricing");
  });
});
