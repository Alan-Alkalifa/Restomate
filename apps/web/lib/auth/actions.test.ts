import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app/" } }));

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getClaims: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
const getCurrentUser = vi.fn();
vi.mock("./dal", () => ({ getCurrentUser: () => getCurrentUser() }));
const guard = vi.fn();
const track = vi.fn();
vi.mock("./seams", () => ({ guard: (...a: unknown[]) => guard(...a), track: (...a: unknown[]) => track(...a) }));

const isSignupEnabled = vi.fn();
vi.mock("@/lib/public/platform-flags", () => ({ isSignupEnabled: () => isSignupEnabled() }));

import { requestPasswordReset, signIn, signOut, signUp, updatePassword } from "./actions";

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ allowed: true });
  isSignupEnabled.mockResolvedValue(true);
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) - 30 }] } } });
  getCurrentUser.mockResolvedValue({ id: "u-1", email: "a@x.test" });
});

describe("signIn", () => {
  const creds = { email: "A@X.test", password: "pw" };
  it("signs in and redirects to a validated next", async () => {
    await expect(signIn(null, form({ ...creds, next: "/invite/abc123" }))).rejects.toMatchObject({ url: "/invite/abc123" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@x.test", password: "pw" });
    expect(guard).toHaveBeenCalledWith("auth", { email: "a@x.test" });
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)"])("falls back to / for next=%s", async (next) => {
    await expect(signIn(null, form({ ...creds, next }))).rejects.toMatchObject({ url: "/" });
  });
  it("defaults next to /", async () => {
    await expect(signIn(null, form(creds))).rejects.toMatchObject({ url: "/" });
  });
  it("returns field errors for invalid input without calling Supabase", async () => {
    const r = await signIn(null, form({ email: "bad", password: "" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { email: expect.any(Array), password: expect.any(Array) } });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });
  it("maps a blocked request to RATE_LIMITED before touching Supabase", async () => {
    guard.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    const r = await signIn(null, form(creds));
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(["BOT", "SHIELD"] as const)("%s denial shows the generic verify message, no RATE_LIMITED code, and logs the reason", async (reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    guard.mockResolvedValue({ allowed: false, reason });
    const r = await signIn(null, form(creds));
    expect(r).toEqual({ ok: false, formError: expect.stringContaining("couldn't verify") });
    expect(JSON.stringify(r)).not.toMatch(/Too many|BOT|SHIELD|rate/i);
    expect(warn).toHaveBeenCalledWith("[auth] request denied by Arcjet", { reason });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it("a real rate limit still says Too many attempts", async () => {
    guard.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await signIn(null, form(creds))).toEqual({ ok: false, code: "RATE_LIMITED", formError: expect.stringContaining("Too many attempts") });
  });
  it("uses one generic message for wrong password and unknown email, never the provider text", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials: leak", status: 400 } });
    const r = await signIn(null, form(creds));
    expect(r).toEqual({ ok: false, formError: "Invalid email or password." });
  });
  it("tells an unconfirmed user to confirm their email", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", message: "x", status: 400 } });
    expect(await signIn(null, form(creds))).toMatchObject({ ok: false, formError: expect.stringContaining("confirm") });
  });
  it("maps provider rate limiting to RATE_LIMITED", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: "over_request_rate_limit", message: "x", status: 429 } });
    expect(await signIn(null, form(creds))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("signUp", () => {
  const input = { fullName: "Ayu", email: "New@X.test", password: "correct horse battery" };
  it("signs up with a confirm link carrying the validated next and tracks signup_started", async () => {
    expect(await signUp(null, form({ ...input, next: "/invite/tok" }))).toEqual({ ok: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "new@x.test",
      password: input.password,
      options: { data: { full_name: "Ayu" }, emailRedirectTo: "https://app.restomate.app/auth/confirm?next=%2Finvite%2Ftok" },
    });
    expect(guard).toHaveBeenCalledWith("signup", { email: "new@x.test" });
    expect(track).toHaveBeenCalledWith("signup_started", { distinctId: "u-1" });
  });
  it("refuses with SIGNUP_DISABLED, before touching Supabase Auth, while signup is off", async () => {
    isSignupEnabled.mockResolvedValue(false);
    expect(await signUp(null, form(input))).toMatchObject({ ok: false, code: "SIGNUP_DISABLED" });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
  it("does not block sign-in while signup is off", async () => {
    isSignupEnabled.mockResolvedValue(false);
    await expect(signIn(null, form({ email: "a@x.test", password: "pw" }))).rejects.toMatchObject({ url: "/" });
    expect(isSignupEnabled).not.toHaveBeenCalled();
  });
  it("locale=en puts lang=en on the confirmation link, after the validated next; other values add nothing", async () => {
    expect(await signUp(null, form({ ...input, next: "/invite/tok", locale: "en" }))).toEqual({ ok: true });
    expect(auth.signUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: "https://app.restomate.app/auth/confirm?next=%2Finvite%2Ftok&lang=en" }) }),
    );
    for (const locale of ["id", "xx", ""]) {
      auth.signUp.mockClear();
      expect(await signUp(null, form({ ...input, locale }))).toEqual({ ok: true });
      expect(auth.signUp).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: "https://app.restomate.app/auth/confirm?next=%2Fonboarding" }) }),
      );
    }
  });
  it("the locale hint cannot smuggle a different next (an open redirect stays closed)", async () => {
    await signUp(null, form({ ...input, next: "https://evil.test", locale: "en" }));
    expect(auth.signUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: "https://app.restomate.app/auth/confirm?next=%2Fonboarding&lang=en" }) }),
    );
  });
  it("defaults next to /onboarding and rejects an unsafe next", async () => {
    await signUp(null, form(input));
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("https://app.restomate.app/auth/confirm?next=%2Fonboarding");
    await signUp(null, form({ ...input, next: "https://evil.test" }));
    expect(auth.signUp.mock.calls[1][0].options.emailRedirectTo).toBe("https://app.restomate.app/auth/confirm?next=%2Fonboarding");
  });
  it("uses a random distinct id when the provider returns no user", async () => {
    auth.signUp.mockResolvedValue({ data: { user: null }, error: null });
    await signUp(null, form(input));
    expect(track).toHaveBeenCalledWith("signup_started", { distinctId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });
  it("validates input", async () => {
    const r = await signUp(null, form({ fullName: "", email: "x", password: "short" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { fullName: expect.any(Array), email: expect.any(Array), password: expect.any(Array) } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("maps a blocked request (EMAIL_INVALID gets its own message)", async () => {
    guard.mockResolvedValue({ allowed: false, reason: "EMAIL_INVALID" });
    expect(await signUp(null, form(input))).toMatchObject({ ok: false, code: "RATE_LIMITED", formError: expect.stringContaining("valid") });
    guard.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await signUp(null, form(input))).toMatchObject({ ok: false, code: "RATE_LIMITED", formError: expect.stringContaining("Too many") });
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("answers ok for an existing account (no enumeration)", async () => {
    auth.signUp.mockResolvedValue({ data: { user: null }, error: { code: "user_already_exists", message: "User already registered", status: 422 } });
    expect(await signUp(null, form(input))).toEqual({ ok: true });
    auth.signUp.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "x", status: 422 } });
    expect(await signUp(null, form(input))).toEqual({ ok: true });
  });
  it("maps weak passwords, provider rate limits and other errors without echoing them", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { code: "weak_password", message: "raw weak", status: 422 } });
    expect(await signUp(null, form(input))).toEqual({ ok: false, fieldErrors: { password: ["Choose a stronger password."] } });
    auth.signUp.mockResolvedValue({ data: {}, error: { code: "over_email_send_rate_limit", message: "raw", status: 429 } });
    expect(await signUp(null, form(input))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    auth.signUp.mockResolvedValue({ data: {}, error: { code: "unexpected_failure", message: "db exploded", status: 500 } });
    const r = await signUp(null, form(input));
    expect(r).toEqual({ ok: false, formError: "Something went wrong. Please try again." });
    expect(JSON.stringify(r)).not.toContain("db exploded");
  });
});

describe("requestPasswordReset", () => {
  it("always answers ok and sends the reset link to /auth/confirm?next=/reset-password", async () => {
    expect(await requestPasswordReset(null, form({ email: "A@x.test" }))).toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@x.test", {
      redirectTo: "https://app.restomate.app/auth/confirm?next=%2Freset-password",
    });
  });
  it("locale=en puts lang=en on the emailed link; id, a missing or an unknown locale add nothing", async () => {
    await requestPasswordReset(null, form({ email: "a@x.test", locale: "en" }));
    expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith("a@x.test", {
      redirectTo: "https://app.restomate.app/auth/confirm?next=%2Freset-password&lang=en",
    });
    for (const locale of ["id", "fr", "EN", "", "<script>"]) {
      auth.resetPasswordForEmail.mockClear();
      expect(await requestPasswordReset(null, form({ email: "a@x.test", locale }))).toEqual({ ok: true }); // never blocks
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@x.test", {
        redirectTo: "https://app.restomate.app/auth/confirm?next=%2Freset-password",
      });
    }
  });
  it("answers the same when the provider errors (unknown email, cooldown, outage)", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "over_email_send_rate_limit", message: "wait 60s", status: 429 } });
    expect(await requestPasswordReset(null, form({ email: "ghost@x.test" }))).toEqual({ ok: true });
  });
  it("validates the email and honours the guard", async () => {
    expect(await requestPasswordReset(null, form({ email: "nope" }))).toMatchObject({ ok: false, fieldErrors: { email: expect.any(Array) } });
    guard.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await requestPasswordReset(null, form({ email: "a@x.test" }))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  const pw = { password: "a brand new password" };
  it("updates the password for a signed-in (recovery) session", async () => {
    expect(await updatePassword(null, form(pw))).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: pw.password });
  });
  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await updatePassword(null, form(pw))).toMatchObject({ ok: false, formError: expect.stringContaining("expired") });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("rejects an ordinary (non-recovery) or stale session", async () => {
    const now = Math.floor(Date.now() / 1000);
    auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "password", timestamp: now }] } } });
    expect(await updatePassword(null, form(pw))).toMatchObject({ ok: false, formError: expect.stringContaining("expired") });
    auth.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "recovery", timestamp: now - 3600 }] } } });
    expect(await updatePassword(null, form(pw))).toMatchObject({ ok: false, formError: expect.stringContaining("expired") });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("validates input and mismatched confirmation", async () => {
    expect(await updatePassword(null, form({ password: "short" }))).toMatchObject({ ok: false, fieldErrors: { password: expect.any(Array) } });
    expect(await updatePassword(null, form({ ...pw, confirmPassword: "nope nope nope" }))).toMatchObject({
      ok: false,
      fieldErrors: { confirmPassword: expect.any(Array) },
    });
  });
  it("maps same_password, weak_password and other errors", async () => {
    auth.updateUser.mockResolvedValue({ error: { code: "same_password", message: "raw" } });
    expect(await updatePassword(null, form(pw))).toMatchObject({ ok: false, fieldErrors: { password: [expect.stringContaining("not used")] } });
    auth.updateUser.mockResolvedValue({ error: { code: "weak_password", message: "raw" } });
    expect(await updatePassword(null, form(pw))).toMatchObject({ ok: false, fieldErrors: { password: ["Choose a stronger password."] } });
    auth.updateUser.mockResolvedValue({ error: { code: "x", message: "raw secret" } });
    const r = await updatePassword(null, form(pw));
    expect(r).toEqual({ ok: false, formError: "Something went wrong. Please try again." });
  });
});

describe("signOut", () => {
  it("clears the session and redirects to /login", async () => {
    await expect(signOut()).rejects.toMatchObject({ url: "/login" });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
