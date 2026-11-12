import { publicEnv } from "@/lib/env";

/** Pure and client-safe: components and server code both import this. */
export const MENU_IMAGES_BUCKET = "menu-images";
export const MENU_IMAGE_MIME = ["image/webp", "image/jpeg", "image/png"] as const;
export type MenuImageMime = (typeof MENU_IMAGE_MIME)[number];
export const MENU_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const MENU_IMAGE_EXT: Record<MenuImageMime, "webp" | "jpg" | "png"> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE = "[A-Za-z0-9_-]{1,64}\\.(?:webp|jpg|png)";
const ANY_PATH = new RegExp(`^${UUID}/items/${UUID}/${FILE}$`);

/** `{organization_id}/items/{item_id}/{name}.(webp|jpg|png)`: the only shape the bucket policies and the DB check accept. */
export const isMenuImagePath = (path: string) => ANY_PATH.test(path);
export const menuImageFolder = (orgId: string, itemId: string) => `${orgId}/items/${itemId}`;
export const isOwnMenuImagePath = (path: string, orgId: string, itemId: string) =>
  isMenuImagePath(path) && path.startsWith(`${menuImageFolder(orgId, itemId)}/`);

/** Public URL of a stored image (the bucket is public-read), or null for a missing or malformed path. */
export function menuImageUrl(path: string | null | undefined): string | null {
  if (!path || !isMenuImagePath(path)) return null;
  const base = publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
