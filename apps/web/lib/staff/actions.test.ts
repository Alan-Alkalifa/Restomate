import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Redirect extends Error { constructor(readonly url: string) { super(`redirect:${url}`); } }
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Redirect(u); }, forbidden: () => { throw new Forbidden("403"); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
const afterCbs: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterCbs.push(cb) }));
const protect = vi.fn();
vi.mock("@/lib/arcjet", () => ({ ajProbe: {}, protect: (...a: unknown[]) => protect(...a) }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app" } }));
const sendStaffInvite = vi.fn();
vi.mock("@/lib/email/staff-invite", () => ({ sendStaffInvite: (...a: unknown[]) => sendStaffInvite(...a) }));
const capture = vi.fn();
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));

const ORG = "99999999-9999-4999-8999-999999999999";
const ROLE_CASHIER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SELF_MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";

let ctxRole = "manager";
const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", name: "Demo", timezone: "Asia/Jakarta" }, membership: { roleKey: ctxRole } }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

// Chainable Supabase mock: results are looked up by "table.op"; every filter returns the chain.
type Res = { data?: unknown; error?: unknown };
let results: Record<string, Res | Res[]> = {};
const calls: { key: string; payload?: unknown }[] = [];
function chain(table: string) {
  let op = "select";
  let payload: unknown;
  const get = (): Res => {
    const key = `${table}.${op}`;
    calls.push({ key, payload });
    const r = results[key] ?? { data: null, error: null };
    return Array.isArray(r) ? (r.shift() ?? { data: null, error: null }) : r;
  };
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "order", "select"]) c[m] = () => c;
  c.insert = (p: unknown) => { op = "insert"; payload = p; return c; };
  c.update = (p: unknown) => { op = "update"; payload = p; return c; };
  c.delete = () => { op = "delete"; return c; };
  c.maybeSingle = async () => get();
  c.single = async () => get();
  c.then = (res: (v: Res) => unknown) => res(get());
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc }) }));

import { acceptInvitation, changeMemberRole, deactivateMember, getInvitationPreview, inviteStaff, resendInvitation, revokeInvitation, setMemberLocations } from "./actions";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const sent = (key: string) => calls.filter((c) => c.key === key);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  afterCbs.length = 0;
  ctxRole = "manager";
  requirePermission.mockResolvedValue(undefined);
  protect.mockResolvedValue({ allowed: true });
  results = {
    "roles.select": { data: { id: ROLE_CASHIER, key: "cashier", name: "Cashier", is_system: true } },
    "profiles.select": { data: null },
    "staff_invitations.select": { data: null },
    "staff_invitations.insert": { data: { id: INV, expires_at: "2026-11-15T00:00:00Z", send_count: 1 } },
    "organizations.select": { data: { contact_email: "hello@demo.test" } },
  };
});

const invite = (extra: [string, string][] = []) =>
  inviteStaff("demo", null, form([["email", "New@X.test"], ["roleId", ROLE_CASHIER], ["allLocations", "true"], ...extra]));

describe("permission", () => {
  it("every action requires staff.manage for the org derived from the slug", async () => {
    requirePermission.mockImplementation(() => { throw new Forbidden("403"); });
    const fd = form([["memberId", MEMBER], ["roleId", ROLE_CASHIER], ["invitationId", INV], ["allLocations", "true"]]);
    for (const act of [inviteStaff, resendInvitation, revokeInvitation, changeMemberRole, setMemberLocations, deactivateMember]) {
      await expect(act("demo", null, fd)).rejects.toBeInstanceOf(Forbidden);
    }
    expect(requirePermission).toHaveBeenCalledWith(ORG, "staff.manage");
  });
});

describe("inviteStaff", () => {
  it("stores only the hash, sends the raw token in the link via after(), tags and captures without PII", async () => {
    expect(await invite()).toEqual({ ok: true });
    const insert = sent("staff_invitations.insert")[0]!.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ organization_id: ORG, email: "new@x.test", role_id: ROLE_CASHIER, all_locations: true, location_ids: [], invited_by: "user-self" });
    expect(insert.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(insert).not.toHaveProperty("expires_at");
    expect(sendStaffInvite).not.toHaveBeenCalled(); // runs after the response
    await afterCbs[0]!();
    const arg = sendStaffInvite.mock.calls[0]![0];
    const raw = arg.props.acceptUrl.replace("https://app.restomate.app/invite/", "");
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(raw).not.toBe(insert.token_hash);
    expect(arg).toMatchObject({ sendCount: 1, to: "new@x.test", replyTo: "hello@demo.test" });
    expect(arg.props.timeZone).toBe("Asia/Jakarta");
    expect(updateTag).toHaveBeenCalledWith(`org:${ORG}`);
    expect(updateTag).toHaveBeenCalledWith(`setup-progress:${ORG}`);
    expect(capture).toHaveBeenCalledWith("staff_invited", expect.objectContaining({ organizationId: ORG }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain("x.test");
  });
  it("a manager cannot invite an owner (403); an owner can", async () => {
    results["roles.select"] = { data: { id: ROLE_OWNER, key: "owner", name: "Owner", is_system: true } };
    await expect(inviteStaff("demo", null, form([["email", "a@b.test"], ["roleId", ROLE_OWNER], ["allLocations", "true"]]))).rejects.toBeInstanceOf(Forbidden);
    ctxRole = "owner";
    expect(await inviteStaff("demo", null, form([["email", "a@b.test"], ["roleId", ROLE_OWNER], ["allLocations", "true"]]))).toEqual({ ok: true });
  });
  it("rejects a role from another org (not found in this org)", async () => {
    results["roles.select"] = { data: null };
    expect(await invite()).toMatchObject({ ok: false, fieldErrors: { roleId: [expect.any(String)] } });
    expect(sent("staff_invitations.insert")).toHaveLength(0);
  });
  it("rejects location ids that are not this org's", async () => {
    results["locations.select"] = { data: [] };
    const r = await inviteStaff("demo", null, form([["email", "a@b.test"], ["roleId", ROLE_CASHIER], ["allLocations", "false"], ["locationIds", LOC]]));
    expect(r).toMatchObject({ ok: false, fieldErrors: { locationIds: [expect.any(String)] } });
  });
  it("a form with no allLocations field creates a location-scoped invite", async () => {
    results["locations.select"] = { data: [{ id: LOC, name: "Main" }] };
    const r = await inviteStaff("demo", null, form([["email", "a@b.test"], ["roleId", ROLE_CASHIER], ["locationIds", LOC]]));
    expect(r).toEqual({ ok: true });
    expect(sent("staff_invitations.insert")[0]!.payload).toMatchObject({ all_locations: false, location_ids: [LOC] });
  });
  it("no allLocations and no locations -> fieldErrors.locationIds", async () => {
    const r = await inviteStaff("demo", null, form([["email", "a@b.test"], ["roleId", ROLE_CASHIER]]));
    expect(r).toMatchObject({ ok: false, fieldErrors: { locationIds: [expect.any(String)] } });
  });
  it("pending or expired invitation -> ALREADY_INVITED; existing active member -> field error", async () => {
    results["staff_invitations.select"] = { data: { id: INV, expires_at: new Date(Date.now() + 1e6).toISOString() } };
    expect(await invite()).toMatchObject({ ok: false, code: "ALREADY_INVITED", formError: expect.stringContaining("Resend") });
    results["staff_invitations.select"] = { data: { id: INV, expires_at: new Date(Date.now() - 1e6).toISOString() } };
    expect(await invite()).toMatchObject({ ok: false, code: "ALREADY_INVITED", formError: expect.stringContaining("expired") });
    results["staff_invitations.select"] = { data: null };
    results["profiles.select"] = { data: { id: "u-9" } };
    results["organization_members.select"] = { data: { id: MEMBER } };
    expect(await invite()).toMatchObject({ ok: false, fieldErrors: { email: [expect.any(String)] } });
  });
  it("maps PLAN_LIMIT from the trigger", async () => {
    results["staff_invitations.insert"] = { data: null, error: { message: "PLAN_LIMIT:max_staff", code: "P0001" } };
    expect(await invite()).toMatchObject({ ok: false, code: "PLAN_LIMIT" });
    expect(afterCbs).toHaveLength(0);
  });
});

describe("resend / revoke", () => {
  it("resend rotates the hash, bumps send_count and the email idempotency count", async () => {
    results["staff_invitations.select"] = { data: { id: INV, email: "p@x.test", role_id: ROLE_CASHIER, all_locations: true, location_ids: [], send_count: 2 } };
    expect(await resendInvitation("demo", null, form([["invitationId", INV]]))).toEqual({ ok: true });
    const upd = sent("staff_invitations.update")[0]!.payload as Record<string, unknown>;
    expect(upd).toMatchObject({ send_count: 3 });
    expect(upd.token_hash).toMatch(/^[0-9a-f]{64}$/);
    await afterCbs[0]!();
    expect(sendStaffInvite.mock.calls[0]![0]).toMatchObject({ sendCount: 3, to: "p@x.test" });
  });
  it("an invitation from another org / already used is the generic error", async () => {
    results["staff_invitations.select"] = { data: null };
    expect(await resendInvitation("demo", null, form([["invitationId", INV]]))).toMatchObject({ ok: false, code: "INVALID_INVITATION" });
    expect(await revokeInvitation("demo", null, form([["invitationId", INV]]))).toMatchObject({ ok: false, code: "INVALID_INVITATION" });
  });
  it("revoke sets revoked_at", async () => {
    results["staff_invitations.select"] = { data: { id: INV, role_id: ROLE_CASHIER } };
    expect(await revokeInvitation("demo", null, form([["invitationId", INV]]))).toEqual({ ok: true });
    expect(sent("staff_invitations.update")[0]!.payload).toHaveProperty("revoked_at");
    expect(updateTag).toHaveBeenCalledWith(`setup-progress:${ORG}`);
  });
});

describe("member changes", () => {
  const member = (user_id: string, roleKey: string) => {
    results["organization_members.select"] = { data: { id: MEMBER, user_id, role_id: ROLE_CASHIER, status: "active", all_locations: true } };
    results["roles.select"] = [{ data: { key: roleKey } }, { data: { id: ROLE_CASHIER, key: "cashier", name: "Cashier", is_system: true } }];
  };
  it("changes a role and tags the member and org", async () => {
    member("u-other", "waiter");
    expect(await changeMemberRole("demo", null, form([["memberId", MEMBER], ["roleId", ROLE_CASHIER]]))).toEqual({ ok: true });
    expect(updateTag).toHaveBeenCalledWith(`member:u-other:${ORG}`);
    expect(updateTag).toHaveBeenCalledWith(`org:${ORG}`);
    expect(updateTag).toHaveBeenCalledWith(`setup-progress:${ORG}`);
  });
  it("cannot change your own role", async () => {
    member("user-self", "manager");
    expect(await changeMemberRole("demo", null, form([["memberId", MEMBER], ["roleId", ROLE_CASHIER]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("a manager cannot touch an owner (403)", async () => {
    member("u-owner", "owner");
    await expect(deactivateMember("demo", null, form([["memberId", MEMBER]]))).rejects.toBeInstanceOf(Forbidden);
    expect(sent("organization_members.update")).toHaveLength(0);
  });
  it("a member id from another org is 'not found' and nothing is written", async () => {
    results["organization_members.select"] = { data: null };
    expect(await deactivateMember("demo", null, form([["memberId", MEMBER]]))).toMatchObject({ ok: false });
    expect(sent("organization_members.update")).toHaveLength(0);
  });
  it("maps LAST_OWNER and cannot deactivate yourself", async () => {
    ctxRole = "owner";
    member("u-owner2", "owner");
    results["organization_members.update"] = { error: { message: "LAST_OWNER", code: "P0001" } };
    expect(await deactivateMember("demo", null, form([["memberId", MEMBER]]))).toMatchObject({ ok: false, code: "LAST_OWNER" });
    expect(updateTag).not.toHaveBeenCalledWith(`setup-progress:${ORG}`); // a failed write refreshes nothing
    member("user-self", "owner");
    expect(await deactivateMember("demo", null, form([["memberId", SELF_MEMBER]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("setMemberLocations makes ONE rpc call (atomic) and tags the member", async () => {
    member("u-other", "waiter");
    rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await setMemberLocations("demo", null, form([["memberId", MEMBER], ["allLocations", "false"], ["locationIds", LOC], ["locationIds", LOC]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_member_locations", { member: MEMBER, all_locations: false, location_ids: [LOC] });
    expect(sent("location_staff.insert")).toHaveLength(0);
    expect(sent("organization_members.update")).toHaveLength(0);
    expect(updateTag).toHaveBeenCalledWith(`member:u-other:${ORG}`);
  });
  it("setMemberLocations with no allLocations field scopes to the given locations", async () => {
    member("u-other", "waiter");
    rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await setMemberLocations("demo", null, form([["memberId", MEMBER], ["locationIds", LOC]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_member_locations", { member: MEMBER, all_locations: false, location_ids: [LOC] });
  });
  it("setMemberLocations maps INVALID_LOCATION and 42501, and does not tag on failure", async () => {
    member("u-other", "waiter");
    rpc.mockResolvedValue({ data: null, error: { message: "INVALID_LOCATION", code: "P0001" } });
    const fd = () => form([["memberId", MEMBER], ["allLocations", "false"], ["locationIds", LOC]]);
    expect(await setMemberLocations("demo", null, fd())).toMatchObject({ ok: false, fieldErrors: { locationIds: [expect.any(String)] } });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN", code: "42501" } });
    expect(await setMemberLocations("demo", null, fd())).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation / preview", () => {
  it("redirects to the org on success and tags the new membership", async () => {
    rpc.mockResolvedValue({ data: { organization_id: ORG, slug: "demo" }, error: null });
    await expect(acceptInvitation(null, form([["token", "t".repeat(43)]]))).rejects.toMatchObject({ url: "/demo" });
    expect(updateTag).toHaveBeenCalledWith(`member:user-self:${ORG}`);
    expect(updateTag).toHaveBeenCalledWith(`setup-progress:${ORG}`);
    expect(capture).toHaveBeenCalledWith("invitation_accepted", expect.objectContaining({ organizationId: ORG }));
  });
  it("any failure (wrong email, expired, revoked, reused) is the same generic error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "INVALID_INVITATION" } });
    const a = await acceptInvitation(null, form([["token", "t".repeat(43)]]));
    rpc.mockResolvedValue({ data: null, error: { message: "something internal" } });
    const b = await acceptInvitation(null, form([["token", "t".repeat(43)]]));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, code: "INVALID_INVITATION" });
    expect(await acceptInvitation(null, form([["token", "short"]]))).toEqual(a);
  });
  it("preview maps the RPC, rate limits, and returns null for bad tokens", async () => {
    rpc.mockResolvedValue({ data: { restaurant_name: "Demo", role_name: "Cashier", email_hint: "a***@x.test", expired: false }, error: null });
    expect(await getInvitationPreview("t".repeat(43))).toEqual({ restaurantName: "Demo", roleName: "Cashier", emailHint: "a***@x.test", expired: false });
    expect(await getInvitationPreview("x")).toBeNull();
    protect.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await getInvitationPreview("t".repeat(43))).toBeNull();
  });
});
