/** Seed users from supabase/seed.sql. Local-only shared password (see README). */
export const SEED_PASSWORD = "restomate-local-dev";

export const seedUsers = {
  owner: "owner@demo.local",
  manager: "manager@demo.local",
  cashier: "cashier@demo.local",
  waiter: "waiter@demo.local",
  kitchen: "kitchen@demo.local",
  otherOwner: "owner@other.local",
  platformAdmin: "admin@restomate.local",
} as const;

/**
 * Tests never depend on order or on a DB reset: every test that creates data uses a unique,
 * throwaway address. Run `supabase db reset` between full runs to clear them.
 */
export function uniqueEmail(tag = "e2e"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${tag}+${Date.now()}-${rand}@restomate.local`;
}

export const NEW_PASSWORD = "Sup3r-secret-e2e!";
