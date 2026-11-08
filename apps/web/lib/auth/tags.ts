/**
 * Cache tag helpers for the auth DAL. Tags contain IDs only (never emails, tokens or slugs).
 * Call `updateTag(...)` from Server Actions that change what the DAL returns, e.g. after a role change:
 *   updateTag(memberTag(userId, orgId))   // one member's permissions / locations changed
 *   updateTag(orgTag(orgId))              // org-wide change: status, plan, locations, role definitions
 */
export const orgTag = (orgId: string): string => `org:${orgId}`;
export const memberTag = (userId: string, orgId: string): string => `member:${userId}:${orgId}`;
