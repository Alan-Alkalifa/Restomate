export { assertLocation } from "@/lib/venue/shared";

/** Cache tag for everything order-related at a location. Ids only. */
export const ordersTag = (locationId: string) => `orders:${locationId}`;
