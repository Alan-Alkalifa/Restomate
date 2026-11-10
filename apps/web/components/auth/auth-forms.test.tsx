import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { SignupForm } from "./SignupForm";
import { passwordHint } from "./password-hint";
import type { AuthAction } from "./types";
import { sanitizeNext } from "@/lib/auth/redirect";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";

const action: AuthAction = async () => ({ ok: true });
const hint = passwordHint(en.auth.passwordHint);

describe("auth forms (SSR)", () => {
  it("login renders labelled fields, hidden next and initial error in a live region", () => {
    const html = renderToStaticMarkup(<LoginForm action={action} next="/acme" initialError="Link expired" t={en.auth.login} locale="en" />);
    expect(html).toContain('for="field-email"');
    expect(html).toContain('name="next"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Link expired");
  });
  it("signup, forgot and reset render their fields", () => {
    expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={hint} t={en.auth.signup} locale="en" />)).toContain('name="fullName"');
    expect(renderToStaticMarkup(<ForgotPasswordForm action={action} t={en.auth.forgot} locale="en" />)).toContain('name="email"');
    expect(renderToStaticMarkup(<ResetPasswordForm action={action} passwordHint={hint} t={en.auth.reset} />)).toContain('name="confirmPassword"');
  });
  it("password hint comes from the shared rule (10 characters min, 72 bytes max), in both languages", () => {
    expect(hint).toBe("At least 10 characters (at most 72 bytes).");
    expect(passwordHint(id.auth.passwordHint)).toBe("Minimal 10 karakter (maksimal 72 byte).");
  });
  it("shared sanitiser rejects the open-redirect payloads the pages rely on", () => {
    for (const bad of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com"]) {
      expect(sanitizeNext(bad, "")).toBe("");
    }
    expect(sanitizeNext("/acme/pos", "")).toBe("/acme/pos");
  });
});

describe("auth forms in Bahasa Indonesia and English", () => {
  it("login is in Indonesian at the unprefixed URL and links stay in the same locale", () => {
    const idHtml = renderToStaticMarkup(<LoginForm action={action} t={id.auth.login} locale="id" />);
    expect(idHtml).toContain("Kata sandi");
    expect(idHtml).toContain("Masuk");
    expect(idHtml).toContain('href="/forgot-password"');
    expect(idHtml).toContain('href="/signup"');
    const enHtml = renderToStaticMarkup(<LoginForm action={action} t={en.auth.login} locale="en" />);
    expect(enHtml).toContain("Password");
    expect(enHtml).toContain('href="/en/forgot-password"');
    expect(enHtml).toContain('href="/en/signup"');
  });
  it("signup and forgot link back to the same-locale login", () => {
    expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={hint} t={id.auth.signup} locale="id" />)).toContain('href="/login"');
    expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={hint} t={en.auth.signup} locale="en" />)).toContain('href="/en/login"');
    expect(renderToStaticMarkup(<ForgotPasswordForm action={action} t={en.auth.forgot} locale="en" />)).toContain('href="/en/login"');
  });
});

describe("locale hint for email links", () => {
  it("signup and forgot-password post the route's locale, so the mail link carries lang", () => {
    for (const [l, d] of [["en", en], ["id", id]] as const) {
      expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={hint} t={d.auth.signup} locale={l} />)).toContain(`<input type="hidden" name="locale" value="${l}"/>`);
      expect(renderToStaticMarkup(<ForgotPasswordForm action={action} t={d.auth.forgot} locale={l} />)).toContain(`<input type="hidden" name="locale" value="${l}"/>`);
    }
  });
});

describe("language switcher", () => {
  it("links to the other locale, keeping the path and a sanitised next", () => {
    const html = renderToStaticMarkup(<LanguageSwitcher locale="id" path="/login" next="/invite/abc" t={id.auth.switcher} />);
    expect(html).toContain('href="/en/login?next=%2Finvite%2Fabc"');
    expect(html).toContain('hrefLang="en"');
    expect(html).toContain('aria-current="true"');
    const en2 = renderToStaticMarkup(<LanguageSwitcher locale="en" path="/signup" t={en.auth.switcher} />);
    expect(en2).toContain('href="/signup"');
    expect(en2).not.toContain("?next");
  });
  it("drops an unsafe next", () => {
    const html = renderToStaticMarkup(<LanguageSwitcher locale="id" path="/login" next="//evil.com" t={id.auth.switcher} />);
    expect(html).toContain('href="/en/login"');
    expect(html).not.toContain("evil");
  });
});
