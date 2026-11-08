import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { SignupForm } from "./SignupForm";
import type { AuthAction } from "./types";

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
    expect(renderToStaticMarkup(<SignupForm action={action} />)).toContain('name="fullName"');
    expect(renderToStaticMarkup(<ForgotPasswordForm action={action} />)).toContain('name="email"');
    expect(renderToStaticMarkup(<ResetPasswordForm action={action} />)).toContain('name="confirmPassword"');
  });
});
