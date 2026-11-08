import { describe, expect, it } from "vitest";
import { generateInviteToken, hashInviteToken } from "./token";

describe("invite token", () => {
  it("is 32 random bytes as base64url and hashes to SHA-256 hex", () => {
    const { raw, hash } = generateInviteToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(raw)).toBe(hash);
    expect(hash).not.toContain(raw);
  });
  it("never repeats", () => {
    expect(generateInviteToken().raw).not.toBe(generateInviteToken().raw);
  });
  it("matches a known SHA-256 vector", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
