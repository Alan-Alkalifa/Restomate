import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes as base64url: the raw token lives only in the email link. */
export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

/** SHA-256 hex, the same function the DB RPCs use (`encode(digest(token,'sha256'),'hex')`). */
export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
