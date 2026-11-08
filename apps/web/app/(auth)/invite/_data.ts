/**
 * TEMPORARY SEAM until MF-T17 merges. Replace with re-exports of getInvitationPreview and
 * acceptInvitation (a form action `(prev, formData{token})` that redirects on success).
 */
import type { InvitationPreview, StaffActionResult } from "@/components/staff/types";

export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  void token;
  return null;
}

export async function acceptInvitation(prev: StaffActionResult | null, formData: FormData): Promise<StaffActionResult> {
  void prev;
  void formData;
  return { ok: false, formError: "Not available yet." };
}
