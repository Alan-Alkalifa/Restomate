import { describe, expect, it } from "vitest";
import {
  fieldErrorsOf,
  formDataToObject,
  requestPasswordResetSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "./schemas";

describe("signInSchema", () => {
  it("normalizes the email and accepts any non-empty password", () => {
    const r = signInSchema.parse({ email: "  Owner@Demo.Local ", password: "x", next: "/demo" });
    expect(r).toEqual({ email: "owner@demo.local", password: "x", next: "/demo" });
  });
  it("rejects a bad email and an empty password", () => {
    const r = signInSchema.safeParse({ email: "nope", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrorsOf(r.error)).sort()).toEqual(["email", "password"]);
  });
});

describe("signUpSchema", () => {
  const ok = { fullName: " Ayu ", email: "a@x.test", password: "correct horse" };
  it("accepts a valid signup and trims the name", () => {
    expect(signUpSchema.parse(ok)).toMatchObject({ fullName: "Ayu", email: "a@x.test" });
  });
  it("requires 10+ characters and at most 72", () => {
    expect(signUpSchema.safeParse({ ...ok, password: "123456789" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...ok, password: "1234567890" }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, password: "x".repeat(73) }).success).toBe(false);
  });
  it("requires a name within 100 characters", () => {
    expect(signUpSchema.safeParse({ ...ok, fullName: "   " }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...ok, fullName: "x".repeat(101) }).success).toBe(false);
  });
  it("rejects an email longer than 254 characters", () => {
    expect(signUpSchema.safeParse({ ...ok, email: `${"a".repeat(250)}@x.test` }).success).toBe(false);
  });
});

describe("requestPasswordResetSchema / updatePasswordSchema", () => {
  it("validates the reset email", () => {
    expect(requestPasswordResetSchema.safeParse({ email: "a@x.test" }).success).toBe(true);
    expect(requestPasswordResetSchema.safeParse({ email: "" }).success).toBe(false);
  });
  it("confirmPassword is optional but must match when present", () => {
    expect(updatePasswordSchema.safeParse({ password: "long enough pw" }).success).toBe(true);
    expect(updatePasswordSchema.safeParse({ password: "long enough pw", confirmPassword: "long enough pw" }).success).toBe(true);
    const r = updatePasswordSchema.safeParse({ password: "long enough pw", confirmPassword: "different pw!" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsOf(r.error)).toEqual({ confirmPassword: ["The passwords do not match."] });
  });
});

describe("helpers", () => {
  it("formDataToObject keeps strings and drops files", () => {
    const fd = new FormData();
    fd.set("a", "1");
    fd.set("f", new Blob(["x"]), "x.txt");
    expect(formDataToObject(fd)).toEqual({ a: "1", f: undefined });
  });
  it("fieldErrorsOf groups messages by field and falls back to 'form'", () => {
    const r = signUpSchema.safeParse({ fullName: "", email: "x", password: "1" });
    if (r.success) throw new Error("expected failure");
    const errs = fieldErrorsOf(r.error);
    expect(Object.keys(errs).sort()).toEqual(["email", "fullName", "password"]);
    const root = updatePasswordSchema.safeParse(null);
    if (root.success) throw new Error("expected failure");
    expect(Object.keys(fieldErrorsOf(root.error))).toEqual(["form"]);
  });
});

describe("password byte limit", () => {
  it("rejects a password over 72 UTF-8 bytes even if under 72 characters", () => {
    const multibyte = "é".repeat(40); // 40 chars, 80 bytes
    expect(updatePasswordSchema.safeParse({ password: multibyte }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({ password: "a".repeat(72) }).success).toBe(true);
  });
});
