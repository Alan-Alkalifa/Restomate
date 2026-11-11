import { vi } from "vitest";

vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { alternatesFor, defaultLocale, fmt, isLocale, localeFromHints, localePath, otherLocale, parseLocalePath } from "./config";
import { en } from "./en";
import { id } from "./id";
import type { Dictionary } from "./types";


const keys = (o: unknown, p = ""): string[] =>
  typeof o === "string" ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k));
const get = (o: unknown, path: string) => path.split(".").reduce((x, k) => (x as Record<string, unknown>)[k], o) as string;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("id has exactly the keys of en", () => {
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });
  it("placeholders match per key", () => {
    for (const k of keys(en)) expect(placeholders(get(id, k)), k).toEqual(placeholders(get(en, k)));
  });
  it("no empty strings", () => {
    for (const k of keys(id)) expect(get(id, k).trim().length, k).toBeGreaterThan(0);
  });
  it("a missing key is a type error", () => {
    // @ts-expect-error the auth namespace is incomplete
    const bad: Dictionary = { auth: { brand: "x" } };
    expect(bad).toBeDefined();
  });
  it("getDictionary returns the right locale", async () => {
    const { getDictionary } = await import("./dictionaries");
    expect((await getDictionary("id")).auth.login.heading).toBe("Masuk");
    expect((await getDictionary("en")).auth.login.heading).toBe("Sign in");
  });
});

describe("locale helpers", () => {
  it("default is id; en is prefixed", () => {
    expect(defaultLocale).toBe("id");
    expect(localePath("id", "/login")).toBe("/login");
    expect(localePath("en", "/login")).toBe("/en/login");
    expect(localePath("en", "/")).toBe("/en");
    expect(localePath("id", "/")).toBe("/");
    expect(localePath("en", "/login?next=%2Fx")).toBe("/en/login?next=%2Fx");
  });
  it("parses a pathname", () => {
    expect(parseLocalePath("/en/login")).toEqual({ locale: "en", path: "/login" });
    expect(parseLocalePath("/en")).toEqual({ locale: "en", path: "/" });
    expect(parseLocalePath("/login")).toEqual({ locale: "id", path: "/login" });
    expect(parseLocalePath("/english")).toEqual({ locale: "id", path: "/english" }); // not a prefix match
    expect(parseLocalePath("/demo/en/x").locale).toBe("id");
  });
  it("validates and flips", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(otherLocale("id")).toBe("en");
    expect(otherLocale("en")).toBe("id");
  });
  it("picks the redirect locale from hints, else id, never an arbitrary value", () => {
    expect(localeFromHints("en", null)).toBe("en");
    expect(localeFromHints(null, "/en/reset-password")).toBe("en");
    expect(localeFromHints("fr", "/reset-password")).toBe("id");
    expect(localeFromHints("<script>", undefined)).toBe("id");
    expect(localeFromHints(undefined, undefined)).toBe("id");
  });
  it("builds canonical + hreflang", () => {
    expect(alternatesFor("en", "/login")).toEqual({
      canonical: "/en/login",
      languages: { id: "/login", en: "/en/login", "x-default": "/login" },
    });
    expect(alternatesFor("id", "/login").canonical).toBe("/login");
  });
  it("formats placeholders", () => {
    expect(fmt("In {seconds}s", { seconds: 5 })).toBe("In 5s");
    expect(fmt("{a} {b}", { a: "x" })).toBe("x {b}");
  });
});
