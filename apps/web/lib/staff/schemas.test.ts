import { describe, expect, it } from "vitest";
import { changeRoleSchema, inviteStaffSchema, parseForm, setLocationsSchema } from "./schemas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const form = (pairs: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
};

describe("inviteStaffSchema via parseForm", () => {
  it("lowercases the email and collects repeated locationIds", () => {
    const r = parseForm(inviteStaffSchema, form([["email", " New@X.Test "], ["roleId", U1], ["allLocations", "false"], ["locationIds", U1], ["locationIds", U2]]), ["locationIds"]);
    expect(r.success && r.data).toMatchObject({ email: "new@x.test", allLocations: false, locationIds: [U1, U2] });
  });
  it("accepts allLocations=true with no ids", () => {
    expect(parseForm(inviteStaffSchema, form([["email", "a@b.test"], ["roleId", U1], ["allLocations", "true"]]), ["locationIds"]).success).toBe(true);
  });
  it("requires at least one location unless all", () => {
    const r = parseForm(inviteStaffSchema, form([["email", "a@b.test"], ["roleId", U1], ["allLocations", "false"]]), ["locationIds"]);
    expect(r.success).toBe(false);
  });
  it("rejects bad email, non-uuid ids and bad booleans", () => {
    expect(parseForm(inviteStaffSchema, form([["email", "nope"], ["roleId", U1], ["allLocations", "true"]])).success).toBe(false);
    expect(parseForm(inviteStaffSchema, form([["email", "a@b.test"], ["roleId", "1 or 1=1"], ["allLocations", "true"]])).success).toBe(false);
    expect(parseForm(inviteStaffSchema, form([["email", "a@b.test"], ["roleId", U1], ["allLocations", "yes"]])).success).toBe(false);
  });
  it("ignores an organization_id smuggled into the form", () => {
    const r = parseForm(inviteStaffSchema, form([["email", "a@b.test"], ["roleId", U1], ["allLocations", "true"], ["organization_id", U2]]));
    expect(r.success && r.data).not.toHaveProperty("organization_id");
  });
});

describe("other schemas", () => {
  it("changeRole needs both uuids", () => {
    expect(parseForm(changeRoleSchema, form([["memberId", U1], ["roleId", U2]])).success).toBe(true);
    expect(parseForm(changeRoleSchema, form([["memberId", U1]])).success).toBe(false);
  });
  it("setLocations enforces scope", () => {
    expect(parseForm(setLocationsSchema, form([["memberId", U1], ["allLocations", "false"]]), ["locationIds"]).success).toBe(false);
  });
});
