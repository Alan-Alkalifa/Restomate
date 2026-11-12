import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { CheckField } from "@/components/ui/check-field";
import { hiddenFieldErrors, menuErrorMessage } from "./errors";
import { MenuManager } from "./MenuManager";
import { MenuTabs } from "./MenuTabs";
import { parseMoneyInput } from "@/lib/money";
import { formatMoneyInput } from "./money-input";
import { moveId } from "./order";
import { selectRangeProblems } from "./GroupsPanel";
import { DIETARY_TAGS as SCHEMA_TAGS } from "@/lib/menu/schemas";
import { DIETARY_TAGS, type BoundMenuAction, type MenuActions, type MenuData } from "./types";
import { buildList } from "./VariantsEditor";

const act: BoundMenuAction = async () => ({ ok: true });
const actions = Object.fromEntries(
  ["createCategory", "updateCategory", "setCategoryActive", "reorderCategories", "createItem", "updateItem", "setItemActive", "setItemPublished", "reorderItems", "saveItemVariants", "createModifierGroup", "updateModifierGroup", "setModifierGroupActive", "saveGroupModifiers", "setItemModifierGroups"].map((k) => [k, act]),
) as MenuActions;
const data = (o: Partial<MenuData> = {}): MenuData => ({
  currency: "IDR",
  canManage: true,
  categories: [{ id: "c1", name: "Mains", description: null, sortOrder: 0, isActive: true, itemCount: 1 }],
  items: [{ id: "i1", categoryId: "c1", name: "<b>Nasi</b>", description: null, basePrice: 35000, imagePath: null, dietaryTags: ["halal"], isPublished: true, isActive: true, sortOrder: 0, variants: [], modifierGroupIds: [] }],
  modifierGroups: [],
  ...o,
});

describe("money input (IDR, no floats)", () => {
  const p = (t: string, neg = false) => parseMoneyInput(t, "IDR", { allowNegative: neg });
  it("accepts whole rupiah in the usual shapes", () => {
    for (const t of ["35000", "35.000", "35,000", "Rp 35.000", " rp35.000 "]) expect(p(t)).toEqual({ ok: true, value: 35000 });
    expect(p("0")).toEqual({ ok: true, value: 0 });
    expect(p("1.000.000")).toEqual({ ok: true, value: 1000000 });
  });
  it("rejects decimals, junk and bad grouping", () => {
    for (const t of ["", "35.5", "35,50", "abc", "1.00", "12.34.567", "1e5", "35000.00"]) expect(p(t).ok).toBe(false);
  });
  it("negative only when allowed (variant deltas)", () => {
    expect(p("-5.000", true)).toEqual({ ok: true, value: -5000 });
    expect(p("-0", true)).toEqual({ ok: true, value: 0 });
    expect(p("-5000").ok).toBe(false);
  });
  it("enforces the 1e12 bound and never loses precision", () => {
    expect(p("1000000000000")).toEqual({ ok: true, value: 1_000_000_000_000 });
    expect(p("1000000000001").ok).toBe(false);
    expect(p("99999999999999999999").ok).toBe(false);
    expect(p("-1000000000001", true).ok).toBe(false);
  });
  it("handles currencies with decimals as strings", () => {
    expect(parseMoneyInput("12.5", "USD")).toEqual({ ok: true, value: 1250 });
    expect(parseMoneyInput("12.50.5", "USD").ok).toBe(false);
    expect(formatMoneyInput(1250, "USD")).toBe("12.50");
    expect(formatMoneyInput(35000, "IDR")).toBe("35000");
    expect(formatMoneyInput(-8000, "IDR")).toBe("-8000");
  });
});

describe("lists and ordering", () => {
  it("moves ids and stays put at the ends", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
  it("builds the variants JSON with ids kept and integers only", () => {
    const { json, problems } = buildList([{ key: "1", id: "v1", name: " Large ", delta: "10.000" }, { key: "2", name: "Half", delta: "-8000" }], "IDR", true, "variant");
    expect(JSON.parse(json)).toEqual([{ id: "v1", name: "Large", priceDelta: 10000 }, { name: "Half", priceDelta: -8000 }]);
    expect(problems).toEqual([null, null]);
  });
  it("flags empty names and bad deltas; modifiers cannot be negative", () => {
    expect(buildList([{ key: "1", name: "", delta: "0" }], "IDR", true, "variant").problems[0]).toMatch(/name/);
    expect(buildList([{ key: "1", name: "x", delta: "1.5" }], "IDR", true, "variant").problems[0]).toBeTruthy();
    expect(buildList([{ key: "1", name: "x", delta: "-1" }], "IDR", false, "modifier").problems[0]).toBeTruthy();
  });
});

describe("min/max select validation", () => {
  it("requires max >= 1 and min <= max", () => {
    expect(selectRangeProblems("0", "1")).toEqual({});
    expect(selectRangeProblems("2", "1").max).toMatch(/at least the minimum/);
    expect(selectRangeProblems("0", "0").max).toMatch(/at least 1/);
    expect(selectRangeProblems("-1", "2").min).toBeTruthy();
    expect(selectRangeProblems("", "").min && selectRangeProblems("", "").max).toBeTruthy();
  });
});

describe("errors", () => {
  it("lists field errors that have no visible field", () => {
    const form = { elements: [{ name: "name", type: "text" }, { name: "variants", type: "hidden" }] };
    const r = { ok: false as const, fieldErrors: { name: ["Taken."], variants: ["Variant 2: enter a name"], extra: ["Bad."] } };
    expect(hiddenFieldErrors(r, form)).toEqual(["Variants: Variant 2: enter a name", "Bad."]);
    expect(menuErrorMessage({ ok: false, code: "FORBIDDEN" })).toContain("permission");
    expect(menuErrorMessage({ ok: false, formError: "x" })).toBe("x");
  });
});

describe("menu UI", () => {
  it("shows formatted prices, escapes names, and editing controls for managers", () => {
    const html = renderToStaticMarkup(<MenuManager data={data()} actions={actions} />);
    expect(html).toContain("Rp 35.000");
    expect(html).not.toContain("<b>Nasi");
    expect(html).toContain("Add category");
    expect(html).toContain("Add item");
    expect(html).not.toContain("View only");
  });
  it("is read-only without manage permission", () => {
    const html = renderToStaticMarkup(<MenuManager data={data({ canManage: false })} actions={actions} />);
    expect(html).toContain("View only");
    expect(html).not.toContain("Add category");
    expect(html).not.toContain("Add item");
    expect(html).not.toContain("Deactivate");
  });
  it("renders empty states", () => {
    expect(renderToStaticMarkup(<MenuManager data={data({ categories: [], items: [] })} actions={actions} />)).toContain("No categories yet");
    expect(renderToStaticMarkup(<MenuManager data={data({ items: [] })} actions={actions} />)).toContain("No items in this category yet");
  });
  it("checkbox posts an explicit false only when unchecked", () => {
    expect(renderToStaticMarkup(<CheckField name="isPublished" label="P" />)).toMatch(/type="hidden"[^>]*value="false"|name="isPublished"[^>]*value="false"/);
    expect(renderToStaticMarkup(<CheckField name="isPublished" label="P" defaultChecked />)).not.toContain('value="false"');
  });
  it("tab bar: Menu items only with manage; This location needs a location", () => {
    const a = renderToStaticMarkup(<MenuTabs orgSlug="demo" locationId="l1" current="items" canManage />);
    expect(a).toContain('href="/demo/menu"');
    expect(a).toContain('href="/demo/l1/menu"');
    const b = renderToStaticMarkup(<MenuTabs orgSlug="demo" locationId="l1" current="location" canManage={false} />);
    expect(b).not.toContain('href="/demo/menu"');
  });
});

describe("dietary tags", () => {
  it("the client checkbox list matches the validated list in lib/menu/schemas", () => {
    expect([...DIETARY_TAGS]).toEqual([...SCHEMA_TAGS]);
  });
});
