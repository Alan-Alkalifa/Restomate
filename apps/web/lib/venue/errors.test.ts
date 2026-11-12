import { describe, expect, it } from "vitest";
import { mapVenueError } from "./errors";

describe("mapVenueError", () => {
  it("a table in use maps to TABLE_NOT_AVAILABLE with a friendly message and no SQL", () => {
    const r = mapVenueError({ code: "P0001", message: "TABLE_NOT_AVAILABLE" });
    expect(r).toMatchObject({ ok: false, code: "TABLE_NOT_AVAILABLE" });
    expect(JSON.stringify(r)).not.toContain("P0001");
  });
});
