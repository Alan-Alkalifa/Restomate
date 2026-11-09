/** Which wizard step shows a server field error, which input to focus and what to say in the step's alert. */
export type ErrorTarget = { step: 1 | 2 | 3; field?: string; alert: string };

/** Server error key (dotted path from lib/onboarding) -> step and the id suffix of the input that shows it. */
const KEYS: Record<string, { step: 1 | 2 | 3; field?: string }> = {
  name: { step: 1, field: "name" },
  slug: { step: 1, field: "slug" },
  "location.name": { step: 2, field: "locationName" },
  "location.address": { step: 2, field: "address" },
  "location.city": { step: 2, field: "city" },
  "location.phone": { step: 2, field: "phone" },
  "location.taxRateBps": { step: 2, field: "tax" },
  "location.serviceChargeBps": { step: 2, field: "service" },
  "branding.logoUrl": { step: 3, field: "logoUrl" },
};

const stepOf = (key: string): 1 | 2 | 3 => KEYS[key]?.step ?? (key.startsWith("location") ? 2 : key.startsWith("branding") ? 3 : 1);

/**
 * Pick the earliest step that has a field error, so a failure from the last step is never hidden on an earlier one.
 * Returns null when there are no field errors.
 */
export function errorTarget(fieldErrors: Record<string, string[] | undefined> | undefined): ErrorTarget | null {
  const entries = Object.entries(fieldErrors ?? {}).filter(([, v]) => v && v.length > 0) as [string, string[]][];
  if (entries.length === 0) return null;
  entries.sort(([a], [b]) => stepOf(a) - stepOf(b));
  const [key, messages] = entries[0];
  const message = messages[0];
  const alert = key === "slug" && /already taken/i.test(message) ? "That web address was just taken. Please choose another." : message;
  return { step: stepOf(key), field: KEYS[key]?.field, alert };
}
