/**
 * Cache tag helpers for the auth DAL. Tags contain IDs only (never emails, tokens or slugs).
 * Call `updateTag(...)` from Server Actions that change what the DAL returns, e.g. after a role change:
 *   updateTag(memberTag(userId, orgId))   // one member's permissions / locations changed
 *   updateTag(orgTag(orgId))              // org-wide change: status, plan, locations, role definitions
 */
export const orgTag = (orgId: string): string => `org:${orgId}`;
export const memberTag = (userId: string, orgId: string): string => `member:${userId}:${orgId}`;

/**
 * Setup checklist progress for one org (lib/onboarding/progress.ts). Org id only, no user data. Call `updateTag` from
 * actions that change an input: location, table or menu item created, staff invited/accepted/deactivated, branding saved.
 */
export const setupProgressTag = (orgId: string): string => `setup-progress:${orgId}`;
