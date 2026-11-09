import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { SignupForm } from "./SignupForm";
import { passwordHint } from "./password-hint";
import type { AuthAction } from "./types";
import { sanitizeNext } from "@/lib/auth/redirect";

const action: AuthAction = async () => ({ ok: true });

describe("auth forms (SSR)", () => {
  it("login renders labelled fields, hidden next and initial error in a live region", () => {
    const html = renderToStaticMarkup(<LoginForm action={action} next="/acme" initialError="Link expired" />);
    expect(html).toContain('for="field-email"');
    expect(html).toContain('name="next"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Link expired");
  });
  it("signup, forgot and reset render their fields", () => {
    expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={passwordHint()} />)).toContain('name="fullName"');
    expect(renderToStaticMarkup(<ForgotPasswordForm action={action} />)).toContain('name="email"');
    expect(renderToStaticMarkup(<ResetPasswordForm action={action} passwordHint={passwordHint()} />)).toContain('name="confirmPassword"');
  });
  it("password hint comes from the shared rule (10 characters min, 72 bytes max)", () => {
    expect(passwordHint()).toBe("At least 10 characters (at most 72 bytes).");
    expect(renderToStaticMarkup(<SignupForm action={action} passwordHint={passwordHint()} />)).toContain("At least 10 characters");
  });
  it("shared sanitiser rejects the open-redirect payloads the pages rely on", () => {
    for (const bad of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com"]) {
      expect(sanitizeNext(bad, "")).toBe("");
    }
    expect(sanitizeNext("/acme/pos", "")).toBe("/acme/pos");
  });
});
