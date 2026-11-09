import { describe, expect, it } from "vitest";
import { mapCreateOrganizationError } from "./errors";

describe("mapCreateOrganizationError", () => {
  it("maps slug errors to fieldErrors.slug", () => {
    expect(mapCreateOrganizationError("SLUG_TAKEN")).toMatchObject({ fieldErrors: { slug: [expect.any(String)] } });
    expect(mapCreateOrganizationError("SLUG_RESERVED")).toMatchObject({ fieldErrors: { slug: [expect.any(String)] } });
  });
  it("maps the owned-org cap and plan limits to PLAN_LIMIT", () => {
    expect(mapCreateOrganizationError("ORG_LIMIT_REACHED")).toMatchObject({ code: "PLAN_LIMIT" });
    expect(mapCreateOrganizationError("PLAN_LIMIT:locations")).toMatchObject({ code: "PLAN_LIMIT" });
  });
  it("never echoes unknown provider text", () => {
    const r = mapCreateOrganizationError('relation "secret_table" does not exist');
    expect(JSON.stringify(r)).not.toContain("secret_table");
    expect(r.formError).toBeTruthy();
  });
});
