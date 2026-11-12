import { describe, expect, it } from "vitest";
import { isPermissionKey, PERMISSION_KEYS } from "./permissions";

describe("permissions", () => {
  it("has the 24 catalog keys, unique and dotted", () => {
    expect(PERMISSION_KEYS).toHaveLength(24);
    expect(new Set(PERMISSION_KEYS).size).toBe(24);
    for (const k of PERMISSION_KEYS) expect(k).toMatch(/^[a-z]+\.[a-z]+$/);
  });
  it("isPermissionKey", () => {
    expect(isPermissionKey("orders.view")).toBe(true);
    expect(isPermissionKey("orders.nope")).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
});
