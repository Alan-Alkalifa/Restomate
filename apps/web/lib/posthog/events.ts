/** The only event names that may be captured. snake_case, object_action (CLAUDE.md "Analytics"). */
export const EVENTS = {
  signupStarted: "signup_started",
  signupCompleted: "signup_completed",
  onboardingCompleted: "onboarding_completed",
  trialStarted: "trial_started",
  staffInvited: "staff_invited",
  invitationAccepted: "invitation_accepted",
  orgStatusChanged: "org_status_changed",
  tenantPasswordResetSent: "tenant_password_reset_sent",
  packageCreated: "package_created",
  packageUpdated: "package_updated",
  packageArchived: "package_archived",
  packageDefaultChanged: "package_default_changed",
  areaCreated: "area_created",
  tableCreated: "table_created",
  tableQrRotated: "table_qr_rotated",
  menuItemCreated: "menu_item_created",
  menuItemUpdated: "menu_item_updated",
  menuItemSoldOutToggled: "menu_item_sold_out_toggled",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export const EVENT_NAMES: readonly string[] = Object.values(EVENTS);
export type EventProperties = Record<string, string | number | boolean | null>;
