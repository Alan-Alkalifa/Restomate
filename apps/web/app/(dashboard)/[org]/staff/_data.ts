/**
 * TEMPORARY SEAM until MF-T17 (lib/staff actions) merges. Replace with re-exports; actions take
 * (orgSlug, prev, formData) and are bound to the slug in the page with `.bind(null, orgSlug)`.
 */
import type { StaffActionResult, StaffData } from "@/components/staff/types";

export async function listStaff(orgSlug: string): Promise<StaffData> {
  void orgSlug;
  return { members: [], invitations: [], roles: [], locations: [], viewerIsOwner: false };
}

const notWired = async (orgSlug: string, prev: StaffActionResult | null, formData: FormData): Promise<StaffActionResult> => {
  void orgSlug; void prev; void formData;
  return { ok: false, formError: "Not available yet." };
};

export const inviteStaff = notWired;
export const resendInvitation = notWired;
export const revokeInvitation = notWired;
export const changeMemberRole = notWired;
export const setMemberLocations = notWired;
export const deactivateMember = notWired;
export const reactivateMember = notWired;
