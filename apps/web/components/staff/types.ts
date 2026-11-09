import type { ActionResult } from "@/lib/auth/schemas";

import type { StaffInvitation, StaffMember, StaffRole } from "@/lib/staff/data";

export type { StaffMember, StaffRole };
export type PendingInvitation = StaffInvitation;

export type StaffData = {
  members: StaffMember[];
  invitations: PendingInvitation[];
  roles: StaffRole[];
  locations: { id: string; name: string }[];
  viewerIsOwner: boolean;
};

/** lib's ActionResult already carries the optional machine `code` (PLAN_LIMIT, LAST_OWNER, ...). */
export type StaffActionResult = ActionResult;

/** Server action already bound to the org slug: (prev, formData). */
export type StaffAction = (prev: StaffActionResult | null, formData: FormData) => Promise<StaffActionResult>;

export type InvitationPreview = { restaurantName: string; roleName: string; emailHint: string; expired: boolean };
