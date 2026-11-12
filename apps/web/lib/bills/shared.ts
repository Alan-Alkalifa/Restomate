export { assertLocation } from "@/lib/venue/shared";

/** Cache tag for everything bill/payment-related at a location. Ids only. */
export const billsTag = (locationId: string) => `bills:${locationId}`;
