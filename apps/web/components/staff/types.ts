import type { ActionResult } from "@/components/auth/types";

/** Mirrors the pinned MF-T17 contract; replace with lib re-exports once it lands. */
export type StaffMember = {
  memberId: string;
  userId: string;
  fullName: string | null;
  isSelf: boolean;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  allLocations: boolean;
  locationIds: string[];
  status: "active" | "deactivated";
};

export type PendingInvitation = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  expiresAt: string;
  status: "pending" | "expired";
  allLocations: boolean;
  locationIds: string[];
};

export type StaffRole = { id: string; key: string; name: string; isSystem: boolean };

export type StaffData = {
  members: StaffMember[];
  invitations: PendingInvitation[];
  roles: StaffRole[];
  locations: { id: string; name: string }[];
  viewerIsOwner: boolean;
};

/** Optional machine code on ActionResult (pinned in MF-T13); formError is already user-friendly. */
export type StaffActionResult = ActionResult & { code?: "PLAN_LIMIT" | "LAST_OWNER" | "SYSTEM_ROLE" | "ALREADY_INVITED" | "INVALID_INVITATION" | "FORBIDDEN" | "RATE_LIMITED" };

/** Server action already bound to the org slug: (prev, formData). */
export type StaffAction = (prev: StaffActionResult | null, formData: FormData) => Promise<StaffActionResult>;

export type InvitationPreview = { restaurantName: string; roleName: string; emailHint: string; expired: boolean };
