import { describe, expect, it } from "vitest";
import { mapVenueError } from "./errors";
import { createTableSchema, MAX_POSITIONS, parseForm, positionsSchema, reorderAreasSchema } from "./schemas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const pos = (v: unknown) => parseForm(positionsSchema, form([["positions", typeof v === "string" ? v : JSON.stringify(v)]]));

describe("createTableSchema", () => {
  it("trims, coerces capacity and checks bounds", () => {
    const ok = parseForm(createTableSchema, form([["areaId", U1], ["label", " T1 "], ["capacity", "4"], ["shape", "round"]]));
    expect(ok.success && ok.data).toEqual({ areaId: U1, label: "T1", capacity: 4, shape: "round" });
    for (const capacity of ["0", "51", "2.5", "", "abc"]) {
      expect(parseForm(createTableSchema, form([["areaId", U1], ["label", "T1"], ["capacity", capacity], ["shape", "square"]])).success).toBe(false);
    }
    expect(parseForm(createTableSchema, form([["areaId", U1], ["label", "x".repeat(21)], ["capacity", "2"], ["shape", "square"]])).success).toBe(false);
    expect(parseForm(createTableSchema, form([["areaId", U1], ["label", "T1"], ["capacity", "2"], ["shape", "hexagon"]])).success).toBe(false);
  });
});

describe("positionsSchema", () => {
  it("accepts valid positions", () => {
    const r = pos([{ tableId: U1, posX: 0, posY: 999 }]);
    expect(r.success && r.data.positions).toEqual([{ tableId: U1, posX: 0, posY: 999 }]);
  });
  it("rejects malformed JSON, wrong types, out-of-range, extras and duplicates", () => {
    expect(pos("{not json").success).toBe(false);
    expect(pos({ tableId: U1 }).success).toBe(false);
    expect(pos([]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: -1, posY: 0 }]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: 1000, posY: 0 }]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: 1.5, posY: 0 }]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: "1", posY: 0 }]).success).toBe(false);
    expect(pos([{ tableId: "1 or 1=1", posX: 1, posY: 0 }]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: 1, posY: 0, organization_id: U2 }]).success).toBe(false);
    expect(pos([{ tableId: U1, posX: 1, posY: 0 }, { tableId: U1, posX: 2, posY: 2 }]).success).toBe(false);
  });
  it("rejects oversized payloads", () => {
    const many = Array.from({ length: MAX_POSITIONS + 1 }, (_, i) => ({ tableId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, posX: 1, posY: 1 }));
    expect(pos(many).success).toBe(false);
    expect(pos(" ".repeat(70_000) + "[]").success).toBe(false);
  });
});

it("reorderAreasSchema needs uuids", () => {
  expect(parseForm(reorderAreasSchema, form([["areaIds", U1], ["areaIds", U2]]), ["areaIds"]).success).toBe(true);
  expect(parseForm(reorderAreasSchema, form([["areaIds", "x"]]), ["areaIds"]).success).toBe(false);
});

describe("mapVenueError", () => {
  it("maps database errors to codes without echoing raw text", () => {
    expect(mapVenueError({ message: "PLAN_LIMIT:max_tables", code: "P0001" })).toMatchObject({ code: "PLAN_LIMIT" });
    expect(mapVenueError({ message: "duplicate key value violates ...", code: "23505" })).toMatchObject({ code: "DUPLICATE_NAME" });
    expect(mapVenueError({ message: "AREA_NOT_EMPTY", code: "P0001" })).toMatchObject({ code: "AREA_NOT_EMPTY" });
    expect(mapVenueError({ message: "FORBIDDEN", code: "42501" })).toMatchObject({ code: "FORBIDDEN" });
    expect(mapVenueError({ message: "AREA_INACTIVE", code: "P0001" })).toMatchObject({ formError: expect.stringContaining("inactive") });
    expect(mapVenueError({ message: "TABLE_INACTIVE", code: "P0001" })).toMatchObject({ formError: expect.stringContaining("Reactivate") });
    const generic = mapVenueError({ message: "relation secret_table does not exist" });
    expect(JSON.stringify(generic)).not.toContain("secret_table");
  });
});
