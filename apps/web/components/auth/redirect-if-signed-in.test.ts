import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

import { getCurrentUser } from "@/lib/auth/dal";
import { redirectIfSignedIn, signedInDestination } from "./redirect-if-signed-in";

describe("signedInDestination", () => {
  it("never sends a signed-in user back to an auth page in either locale", () => {
    expect(signedInDestination("/en/login")).toBe("/");
    expect(signedInDestination("/en/signup?x=1")).toBe("/");
    expect(signedInDestination("/english")).toBe("/english");
  });
  it("keeps a same-site next", () => expect(signedInDestination("/acme/pos")).toBe("/acme/pos"));
  it.each([undefined, ["/a", "/b"], "", "//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", "/login", "/signup?next=/x", "/login/"])(
    "falls back to / for %j",
    (v) => expect(signedInDestination(v)).toBe("/"),
  );
});

describe("redirectIfSignedIn", () => {
  it("redirects a signed-in user to the sanitised next", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", email: "a@b.co" });
    await expect(redirectIfSignedIn("/acme")).rejects.toThrow("REDIRECT:/acme");
    await expect(redirectIfSignedIn("//evil.com")).rejects.toThrow("REDIRECT:/");
  });
  it("lets a signed-out user through", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(redirectIfSignedIn("/acme")).resolves.toBeUndefined();
  });
});
