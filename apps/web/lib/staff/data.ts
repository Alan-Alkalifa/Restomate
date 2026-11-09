import "server-only";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type StaffMember = {
  memberId: string; userId: string; fullName: string | null; email: string | null;
  roleId: string; roleKey: string; roleName: string; status: "active" | "deactivated";
  allLocations: boolean; locationIds: string[]; isSelf: boolean;
};
export type StaffInvitation = {
  id: string; email: string; roleId: string; roleName: string; allLocations: boolean; locationIds: string[];
  expiresAt: string; status: "pending" | "expired";
};
export type StaffRole = { id: string; key: string; name: string; isSystem: boolean };

/**
 * Team page data. Authorizes itself (requireOrgContext + staff.manage). Selects explicit columns, so `token_hash`
 * is never read. Call inside <Suspense>.
 */
export async function listStaff(orgSlug: string): Promise<{
  members: StaffMember[]; invitations: StaffInvitation[]; roles: StaffRole[];
  locations: { id: string; name: string }[]; viewerIsOwner: boolean;
}> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "staff.manage");
  const user = await getCurrentUser();
  const orgId = ctx.org.id;
  const supabase = await createClient();

  const [membersRes, rolesRes, invRes, locRes, lsRes] = await Promise.all([
    supabase.from("organization_members").select("id, user_id, role_id, status, all_locations").eq("organization_id", orgId).order("created_at"),
    supabase.from("roles").select("id, key, name, is_system").eq("organization_id", orgId).order("name"),
    supabase.from("staff_invitations")
      .select("id, email, role_id, all_locations, location_ids, expires_at")
      .eq("organization_id", orgId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
    supabase.from("locations").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase.from("location_staff").select("member_id, location_id").eq("organization_id", orgId),
  ]);

  const roles = (rolesRes.data ?? []).map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.is_system }));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const rows = membersRes.data ?? [];
  const userIds = rows.map((m) => m.user_id);
  const profRes = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const profById = new Map((profRes.data ?? []).map((p) => [p.id, p]));
  const locsByMember = new Map<string, string[]>();
  for (const l of lsRes.data ?? []) locsByMember.set(l.member_id, [...(locsByMember.get(l.member_id) ?? []), l.location_id]);

  const members: StaffMember[] = rows.map((m) => {
    const role = roleById.get(m.role_id);
    const prof = profById.get(m.user_id);
    return {
      memberId: m.id, userId: m.user_id, fullName: prof?.full_name ?? null, email: prof?.email ?? null,
      roleId: m.role_id, roleKey: role?.key ?? "", roleName: role?.name ?? "",
      status: m.status === "active" ? "active" : "deactivated",
      allLocations: m.all_locations, locationIds: locsByMember.get(m.id) ?? [], isSelf: m.user_id === user?.id,
    };
  });

  const now = Date.now();
  const invitations: StaffInvitation[] = (invRes.data ?? []).map((i) => ({
    id: i.id, email: i.email, roleId: i.role_id, roleName: roleById.get(i.role_id)?.name ?? "",
    allLocations: i.all_locations, locationIds: i.location_ids,
    expiresAt: i.expires_at, status: new Date(i.expires_at).getTime() > now ? "pending" : "expired",
  }));

  return {
    members, invitations, roles,
    locations: (locRes.data ?? []).map((l) => ({ id: l.id, name: l.name })),
    viewerIsOwner: ctx.membership.roleKey === "owner",
  };
}
