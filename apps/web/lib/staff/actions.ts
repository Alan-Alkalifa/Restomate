"use server";

import { updateTag } from "next/cache";
import { forbidden, redirect } from "next/navigation";
import { after } from "next/server";
import { ajProbe, protect } from "@/lib/arcjet";
import { requireOrgContext, requirePermission, requireUser, type OrgContext } from "@/lib/auth/dal";
import { publicEnv } from "@/lib/env";
import type { ActionResult } from "@/lib/auth/schemas";
import { memberTag, orgTag, setupProgressTag } from "@/lib/auth/tags";
import { sendStaffInvite } from "@/lib/email/staff-invite";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { invalidInvitation, mapStaffError } from "./errors";
import {
  acceptSchema, changeRoleSchema, fieldErrors, invitationIdSchema, inviteStaffSchema, memberIdSchema,
  parseForm, setLocationsSchema,
} from "./schemas";
import { generateInviteToken } from "./token";

/*
 * Staff Server Actions. Every mutation: requireOrgContext(slug) -> requirePermission(org.id, 'staff.manage') -> Zod ->
 * ownership checks (ids must belong to this org) -> RLS-checked write -> updateTag. Audit rows are written by SQL
 * triggers in the same transaction (migration 20261108080000), so there is nothing to forget here.
 * The org id is NEVER read from FormData: it comes from the bound slug plus the caller's membership.
 */
type StaffAction = (orgSlug: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const INVITE_DAYS = 7;
const OK: ActionResult = { ok: true };
const fail = (formError: string, code?: "FORBIDDEN"): ActionResult => ({ ok: false, formError, ...(code ? { code } : {}) });

async function authorize(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "staff.manage");
  const user = await requireUser();
  const supabase = await createClient();
  return { ctx, user, supabase, isOwner: ctx.membership.roleKey === "owner" };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A role id from the client must belong to this org. */
async function loadRole(supabase: Supabase, orgId: string, roleId: string) {
  const { data } = await supabase.from("roles").select("id, key, name, is_system").eq("organization_id", orgId).eq("id", roleId).maybeSingle();
  return data;
}

/** Location ids from the client must all be active locations of this org. */
async function validLocations(supabase: Supabase, orgId: string, ids: string[]) {
  if (ids.length === 0) return [] as { id: string; name: string }[];
  const unique = [...new Set(ids)];
  const { data } = await supabase.from("locations").select("id, name").eq("organization_id", orgId).eq("is_active", true).in("id", unique);
  return data && data.length === unique.length ? data : null;
}

async function loadMember(supabase: Supabase, orgId: string, memberId: string) {
  const { data } = await supabase.from("organization_members")
    .select("id, user_id, role_id, status, all_locations").eq("organization_id", orgId).eq("id", memberId).maybeSingle();
  if (!data) return null;
  const { data: role } = await supabase.from("roles").select("key").eq("organization_id", orgId).eq("id", data.role_id).maybeSingle();
  return { ...data, roleKey: role?.key ?? "" };
}

function bumpMember(userId: string, orgId: string) {
  updateTag(memberTag(userId, orgId));
  updateTag(orgTag(orgId));
  updateTag(setupProgressTag(orgId)); // the staff step counts active members
}

async function queueInviteEmail(ctx: OrgContext, args: {
  invitationId: string; sendCount: number; to: string; rawToken: string; expiresAt: string;
  roleName: string; locationNames: string[]; inviterName: string | null;
}) {
  const supabase = await createClient();
  const [{ data: org }, { data: brand }] = await Promise.all([
    supabase.from("organizations").select("contact_email").eq("id", ctx.org.id).maybeSingle(),
    supabase.from("org_branding").select("logo_url, primary_color").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  const input = {
    organizationId: ctx.org.id, invitationId: args.invitationId, sendCount: args.sendCount, to: args.to,
    replyTo: org?.contact_email ?? null,
    props: {
      restaurantName: ctx.org.name, inviterName: args.inviterName, roleName: args.roleName, locationNames: args.locationNames,
      acceptUrl: `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/invite/${args.rawToken}`,
      expiresAt: args.expiresAt, logoUrl: brand?.logo_url ?? null, brandColor: brand?.primary_color ?? null, timeZone: ctx.org.timezone,
    },
  };
  // Email never blocks or fails the action; sendStaffInvite never throws.
  after(async () => { await sendStaffInvite(input); });
}

async function inviterName(supabase: Supabase, userId: string) {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}

export const inviteStaff: StaffAction = async (orgSlug, _prev, formData) => {
  const { ctx, user, supabase, isOwner } = await authorize(orgSlug);
  const parsed = parseForm(inviteStaffSchema, formData, ["locationIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { email, roleId, allLocations, locationIds } = parsed.data;
  const orgId = ctx.org.id;

  const role = await loadRole(supabase, orgId, roleId);
  if (!role) return { ok: false, fieldErrors: { roleId: ["Choose a role from the list."] } };
  if (role.is_system && role.key === "owner" && !isOwner) forbidden();

  const locations = allLocations ? [] : await validLocations(supabase, orgId, locationIds);
  if (locations === null) return { ok: false, fieldErrors: { locationIds: ["Choose locations from the list."] } };

  // Existing active member with this email?
  const { data: prof } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (prof) {
    const { data: existing } = await supabase.from("organization_members").select("id")
      .eq("organization_id", orgId).eq("user_id", prof.id).eq("status", "active").maybeSingle();
    if (existing) return { ok: false, fieldErrors: { email: ["This person is already on your team."] } };
  }
  // Pending invitation (the DB's one-pending index also counts expired rows, so offer Resend for those too).
  const { data: pending } = await supabase.from("staff_invitations").select("id, expires_at")
    .eq("organization_id", orgId).eq("email", email).is("accepted_at", null).is("revoked_at", null).maybeSingle();
  if (pending) {
    const expired = new Date(pending.expires_at).getTime() <= Date.now();
    return {
      ok: false, code: "ALREADY_INVITED",
      formError: expired ? "Already invited, and that invitation has expired. Use Resend to send a new one." : "Already invited. Use Resend instead.",
    };
  }

  const { raw, hash } = generateInviteToken();
  const { data: inv, error } = await supabase.from("staff_invitations").insert({
    organization_id: orgId, email, role_id: role.id, all_locations: allLocations,
    location_ids: allLocations ? [] : locations.map((l) => l.id), token_hash: hash, invited_by: user.id,
  }).select("id, expires_at, send_count").single();
  if (error || !inv) return mapStaffError(error);

  await queueInviteEmail(ctx, {
    invitationId: inv.id, sendCount: inv.send_count, to: email, rawToken: raw, expiresAt: inv.expires_at,
    roleName: role.name, locationNames: locations.map((l) => l.name), inviterName: await inviterName(supabase, user.id),
  });
  captureServer(EVENTS.staffInvited, { distinctId: user.id, organizationId: orgId, properties: { role_key: role.key } });
  updateTag(orgTag(orgId));
  updateTag(setupProgressTag(orgId)); // the staff step counts pending invitations
  return OK;
};

export const resendInvitation: StaffAction = async (orgSlug, _prev, formData) => {
  const { ctx, user, supabase, isOwner } = await authorize(orgSlug);
  const parsed = parseForm(invitationIdSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const orgId = ctx.org.id;

  const { data: inv } = await supabase.from("staff_invitations")
    .select("id, email, role_id, all_locations, location_ids, send_count")
    .eq("organization_id", orgId).eq("id", parsed.data.invitationId).is("accepted_at", null).is("revoked_at", null).maybeSingle();
  if (!inv) return invalidInvitation();
  const role = await loadRole(supabase, orgId, inv.role_id);
  if (!role) return invalidInvitation();
  if (role.is_system && role.key === "owner" && !isOwner) forbidden();

  const { raw, hash } = generateInviteToken(); // rotating the hash kills the old link
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const sendCount = inv.send_count + 1;
  const { error } = await supabase.from("staff_invitations")
    .update({ token_hash: hash, expires_at: expiresAt, send_count: sendCount })
    .eq("organization_id", orgId).eq("id", inv.id).is("accepted_at", null).is("revoked_at", null);
  if (error) return mapStaffError(error);

  const locs = inv.all_locations ? [] : ((await validLocations(supabase, orgId, inv.location_ids)) ?? []);
  await queueInviteEmail(ctx, {
    invitationId: inv.id, sendCount, to: inv.email, rawToken: raw, expiresAt,
    roleName: role.name, locationNames: locs.map((l) => l.name), inviterName: await inviterName(supabase, user.id),
  });
  updateTag(orgTag(orgId));
  updateTag(setupProgressTag(orgId)); // the staff step counts pending invitations
  return OK;
};

export const revokeInvitation: StaffAction = async (orgSlug, _prev, formData) => {
  const { ctx, supabase, isOwner } = await authorize(orgSlug);
  const parsed = parseForm(invitationIdSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const orgId = ctx.org.id;

  const { data: inv } = await supabase.from("staff_invitations").select("id, role_id")
    .eq("organization_id", orgId).eq("id", parsed.data.invitationId).is("accepted_at", null).is("revoked_at", null).maybeSingle();
  if (!inv) return invalidInvitation();
  const role = await loadRole(supabase, orgId, inv.role_id);
  if (role?.is_system && role.key === "owner" && !isOwner) forbidden();

  const { error } = await supabase.from("staff_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", orgId).eq("id", inv.id).is("accepted_at", null).is("revoked_at", null);
  if (error) return mapStaffError(error);
  updateTag(orgTag(orgId));
  updateTag(setupProgressTag(orgId)); // the staff step counts pending invitations
  return OK;
};

/** Shared guard for acting on an existing member: org-scoped lookup, and non-owners may not touch owners. */
async function targetMember(orgSlug: string, memberId: string) {
  const a = await authorize(orgSlug);
  const member = await loadMember(a.supabase, a.ctx.org.id, memberId);
  if (!member) return { ...a, member: null };
  if (member.roleKey === "owner" && !a.isOwner) forbidden();
  return { ...a, member };
}

export const changeMemberRole: StaffAction = async (orgSlug, _prev, formData) => {
  const parsed = parseForm(changeRoleSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { ctx, user, supabase, isOwner, member } = await targetMember(orgSlug, parsed.data.memberId);
  if (!member) return fail("That team member was not found.");
  if (member.user_id === user.id) return fail("You can't change your own role.", "FORBIDDEN");
  const role = await loadRole(supabase, ctx.org.id, parsed.data.roleId);
  if (!role) return { ok: false, fieldErrors: { roleId: ["Choose a role from the list."] } };
  if (role.is_system && role.key === "owner" && !isOwner) forbidden();

  const { error } = await supabase.from("organization_members").update({ role_id: role.id }).eq("organization_id", ctx.org.id).eq("id", member.id);
  if (error) return mapStaffError(error);
  bumpMember(member.user_id, ctx.org.id);
  return OK;
};

export const setMemberLocations: StaffAction = async (orgSlug, _prev, formData) => {
  const parsed = parseForm(setLocationsSchema, formData, ["locationIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { memberId, allLocations, locationIds } = parsed.data;
  const { ctx, supabase, member } = await targetMember(orgSlug, memberId);
  if (!member) return fail("That team member was not found.");

  // One atomic RPC: privilege checks, org-scoped location validation, the diff and the flag all happen in the DB.
  const { error } = await supabase.rpc("set_member_locations", {
    member: member.id, all_locations: allLocations, location_ids: allLocations ? [] : [...new Set(locationIds)],
  });
  if (error) return mapStaffError(error);
  bumpMember(member.user_id, ctx.org.id);
  return OK;
};

function statusAction(next: "active" | "deactivated"): StaffAction {
  return async (orgSlug, _prev, formData) => {
    const parsed = parseForm(memberIdSchema, formData);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    const { ctx, user, supabase, member } = await targetMember(orgSlug, parsed.data.memberId);
    if (!member) return fail("That team member was not found.");
    if (next === "deactivated" && member.user_id === user.id) return fail("You can't deactivate yourself.", "FORBIDDEN");
    const { error } = await supabase.from("organization_members").update({ status: next }).eq("organization_id", ctx.org.id).eq("id", member.id);
    if (error) return mapStaffError(error); // LAST_OWNER, PLAN_LIMIT (reactivate)
    bumpMember(member.user_id, ctx.org.id);
    return OK;
  };
}
export const deactivateMember: StaffAction = statusAction("deactivated");
export const reactivateMember: StaffAction = statusAction("active");

/** Accept an invitation as the signed-in user. The RPC checks token, expiry, revocation and that the email matches. */
export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseForm(acceptSchema, formData);
  if (!parsed.success) return invalidInvitation();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { token: parsed.data.token });
  const res = data as { organization_id?: string; slug?: string } | null;
  if (error || !res?.slug || !res.organization_id) return invalidInvitation(); // one generic answer for every failure
  bumpMember(user.id, res.organization_id);
  captureServer(EVENTS.invitationAccepted, { distinctId: user.id, organizationId: res.organization_id });
  redirect(`/${res.slug}`);
}

/** Invite landing preview (works signed out). Rate limited; returns only what the RPC exposes (masked email hint). */
export async function getInvitationPreview(token: string): Promise<{ restaurantName: string; roleName: string; emailHint: string; expired: boolean } | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 256) return null;
  const decision = await protect(ajProbe);
  if (!decision.allowed) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", { token });
  const r = data as { restaurant_name?: string; role_name?: string; email_hint?: string; expired?: boolean } | null;
  if (error || !r?.restaurant_name) return null;
  return { restaurantName: r.restaurant_name, roleName: r.role_name ?? "", emailHint: r.email_hint ?? "", expired: r.expired === true };
}

