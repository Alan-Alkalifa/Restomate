import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app" } }));
const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));
const track = vi.fn();
vi.mock("@/lib/auth/seams", () => ({ track: (...a: unknown[]) => track(...a) }));

import { GET } from "./route";

const call = (qs: string) => GET(new NextRequest(`http://internal/auth/confirm?${qs}`));
const location = (r: Response) => r.headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
});

describe("GET /auth/confirm", () => {
  it("verifies the token and redirects to the validated next on our own origin", async () => {
    const r = await call("token_hash=abc&type=signup&next=/invite/tok");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
    expect(location(r)).toBe("https://app.restomate.app/invite/tok");
  });
  it("tracks signup_completed only for type=signup", async () => {
    await call("token_hash=abc&type=signup");
    expect(track).toHaveBeenCalledWith("signup_completed", { distinctId: "u-1" });
    track.mockClear();
    await call("token_hash=abc&type=recovery");
    expect(track).not.toHaveBeenCalled();
  });
  it("does not track when verification returns no user", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    await call("token_hash=abc&type=signup");
    expect(track).not.toHaveBeenCalled();
  });
  it("uses sensible defaults per type when next is absent", async () => {
    expect(location(await call("token_hash=a&type=signup"))).toBe("https://app.restomate.app/onboarding");
    expect(location(await call("token_hash=a&type=recovery"))).toBe("https://app.restomate.app/reset-password");
    expect(location(await call("token_hash=a&type=email"))).toBe("https://app.restomate.app/");
  });
  it("keeps the user's language: lang hint or /en next", async () => {
    expect(location(await call("token_hash=a&type=recovery&lang=en"))).toBe("https://app.restomate.app/en/reset-password");
    expect(location(await call("token_hash=a&type=recovery&next=/en/reset-password"))).toBe("https://app.restomate.app/en/reset-password");
    expect(location(await call("token_hash=a&type=recovery&lang=fr"))).toBe("https://app.restomate.app/reset-password");
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "expired" } });
    expect(location(await call("token_hash=a&type=signup&lang=en"))).toBe("https://app.restomate.app/en/login?error=link_expired");
    expect(location(await call("token_hash=a&type=signup"))).toBe("https://app.restomate.app/login?error=link_expired");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)"])("never redirects off-site (next=%s)", async (next) => {
    const r = await call(`token_hash=a&type=signup&next=${encodeURIComponent(next)}`);
    expect(location(r)).toBe("https://app.restomate.app/onboarding");
  });
  it("sends expired, reused or invalid tokens to /login?error=link_expired", async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid" } });
    expect(location(await call("token_hash=a&type=signup"))).toBe("https://app.restomate.app/login?error=link_expired");
  });
  it("rejects missing or unknown params without calling Supabase", async () => {
    for (const qs of ["", "token_hash=a", "type=signup", "token_hash=a&type=bogus", `token_hash=${"x".repeat(600)}&type=signup`]) {
      expect(location(await call(qs))).toBe("https://app.restomate.app/login?error=link_expired");
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
