import { describe, expect, it } from "vitest";
import { invalidInvitation, mapStaffError } from "./errors";

describe("mapStaffError", () => {
  it.each([
    ["PLAN_LIMIT:max_staff", undefined, "PLAN_LIMIT"],
    ["LAST_OWNER", undefined, "LAST_OWNER"],
    ["SYSTEM_ROLE", undefined, "SYSTEM_ROLE"],
    ["duplicate key", "23505", "ALREADY_INVITED"],
    ['new row violates row-level security policy for table "x"', "42501", "FORBIDDEN"],
    ["INVALID_INVITATION", undefined, "INVALID_INVITATION"],
  ])("%s -> %s", (message, code, expected) => {
    expect(mapStaffError({ message, code })).toMatchObject({ ok: false, code: expected, formError: expect.any(String) });
  });
  it("never echoes unknown provider text", () => {
    const r = mapStaffError({ message: 'relation "secret_table" does not exist' });
    expect(JSON.stringify(r)).not.toContain("secret_table");
    expect(r.code).toBeUndefined();
  });
  it("invalidInvitation is generic", () => {
    expect(invalidInvitation()).toMatchObject({ code: "INVALID_INVITATION" });
  });
});
