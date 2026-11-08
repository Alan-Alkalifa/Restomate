/** The only event names that may be captured. snake_case, object_action (CLAUDE.md "Analytics"). */
export const EVENTS = {
  signupStarted: "signup_started",
  signupCompleted: "signup_completed",
  onboardingCompleted: "onboarding_completed",
  trialStarted: "trial_started",
  staffInvited: "staff_invited",
  invitationAccepted: "invitation_accepted",
  orgStatusChanged: "org_status_changed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export const EVENT_NAMES: readonly string[] = Object.values(EVENTS);
export type EventProperties = Record<string, string | number | boolean | null>;
