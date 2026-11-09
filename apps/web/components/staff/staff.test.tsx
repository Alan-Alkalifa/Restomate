import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { staffErrorMessage } from "./errors";
import { emailMatchesHint, maskEmail } from "./invite-email";
import { InvitationsTable, MembersTable, roleOptions, type StaffActions } from "./StaffTables";
import type { StaffAction, StaffData } from "./types";

const act: StaffAction = async () => ({ ok: true });
const actions: StaffActions = { invite: act, resend: act, revoke: act, changeRole: act, setLocations: act, deactivate: act, reactivate: act };
const data = (o: Partial<StaffData> = {}): StaffData => ({
  members: [
    { memberId: "m1", userId: "u1", fullName: "<b>Ann</b>", email: "ann@x.com", roleId: "r1", roleKey: "owner", roleName: "Owner", allLocations: true, locationIds: [], status: "active", isSelf: true },
    { memberId: "m2", userId: "u2", fullName: null, email: "bo@x.com", roleId: "r2", roleKey: "cashier", roleName: "Cashier", allLocations: false, locationIds: ["l1"], status: "deactivated", isSelf: false },
  ],
  invitations: [{ id: "i1", email: "c@x.com", roleId: "r2", roleName: "Cashier", expiresAt: "2026-12-01T00:00:00Z", status: "expired", allLocations: true, locationIds: [] }],
  roles: [{ id: "r1", key: "owner", name: "Owner", isSystem: true }, { id: "r2", key: "cashier", name: "Cashier", isSystem: true }],
  locations: [{ id: "l1", name: "Kemang" }],
  viewerIsOwner: false,
  ...o,
});

describe("staff UI", () => {
  it("hides the Owner role unless the viewer is an owner", () => {
    expect(roleOptions(data()).map((r) => r.key)).toEqual(["cashier"]);
    expect(roleOptions(data({ viewerIsOwner: true })).map((r) => r.key)).toEqual(["owner", "cashier"]);
  });
  it("escapes names, shows location names, status, no self-deactivate", () => {
    const html = renderToStaticMarkup(<MembersTable data={data()} actions={actions} upgradeHref="/demo/settings" />);
    expect(html).not.toContain("<b>Ann");
    expect(html).toContain("Kemang");
    expect(html).toContain("Deactivated");
    expect(html).toContain("Reactivate");
    expect(html).not.toContain("Deactivate Ann");
  });
  it("renders empty states and expired badge", () => {
    expect(renderToStaticMarkup(<MembersTable data={data({ members: [] })} actions={actions} upgradeHref="/" />)).toContain("No team members");
    expect(renderToStaticMarkup(<InvitationsTable invitations={[]} actions={actions} />)).toContain("No pending invitations");
    expect(renderToStaticMarkup(<InvitationsTable invitations={data().invitations} actions={actions} />)).toContain("Expired");
  });
  it("maps error codes to friendly messages", () => {
    expect(staffErrorMessage({ ok: false, code: "PLAN_LIMIT" })).toMatch(/Upgrade/);
    expect(staffErrorMessage({ ok: false, code: "LAST_OWNER" })).toMatch(/at least one/);
    expect(staffErrorMessage({ ok: false, code: "ALREADY_INVITED" })).toMatch(/Resend/);
    expect(staffErrorMessage({ ok: false, formError: "Custom" })).toBe("Custom");
    expect(staffErrorMessage({ ok: true })).toBeUndefined();
  });
  it("masks emails like the RPC and compares case-insensitively", () => {
    expect(maskEmail("Alice@Example.com")).toBe("a***@example.com");
    expect(emailMatchesHint("ALICE@example.com", "a***@example.com")).toBe(true);
    expect(emailMatchesHint("bob@example.com", "a***@example.com")).toBe(false);
  });
});

describe("field errors (B1-T10)", () => {
  it("lists only errors that have no visible field", async () => {
    const { unclaimedFieldErrors } = await import("./field-errors");
    const r = { ok: false as const, fieldErrors: { email: ["Enter a valid email."], memberId: ["Member not found."], allLocations: ["Choose all or some."] } };
    expect(unclaimedFieldErrors(r, ["email", "allLocations"])).toEqual(["Team member: Member not found."]);
    expect(unclaimedFieldErrors(r, [])).toHaveLength(3);
    expect(unclaimedFieldErrors({ ok: true }, [])).toEqual([]);
    expect(unclaimedFieldErrors(null, [])).toEqual([]);
  });
  it("renders inline field errors next to their field", async () => {
    const { FieldError, FieldErrorsContext } = await import("./field-errors");
    const html = renderToStaticMarkup(
      <FieldErrorsContext value={{ email: ["Enter a valid email."], locationIds: ["Pick one."] }}>
        <FieldError name="email" />
        <FieldError name={["allLocations", "locationIds"]} />
        <FieldError name="roleId" />
      </FieldErrorsContext>,
    );
    expect(html).toContain("Enter a valid email.");
    expect(html).toContain("Pick one.");
    expect(html.match(/data-field-error/g)).toHaveLength(2);
  });
  it("posts an explicit allLocations=false when unchecked", async () => {
    const { LocationPicker } = await import("./LocationPicker");
    const locs = [{ id: "l1", name: "Kemang" }];
    const off = renderToStaticMarkup(<LocationPicker locations={locs} initialAll={false} />);
    expect(off).toMatch(/type="hidden"[^>]*name="allLocations"[^>]*value="false"|name="allLocations"[^>]*value="false"/);
    const on = renderToStaticMarkup(<LocationPicker locations={locs} initialAll />);
    expect(on).not.toContain('value="false"');
  });
});
