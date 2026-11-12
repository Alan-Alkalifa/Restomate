"use server";

import { randomBytes } from "node:crypto";
import { updateTag } from "next/cache";
import { z } from "zod";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import type { ActionErrorCode, ActionResult } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { MENU_IMAGE_EXT, MENU_IMAGE_MIME, MENU_IMAGES_BUCKET, isOwnMenuImagePath, menuImageFolder } from "./image-url";
import { fieldErrors, parseForm } from "./schemas";
import { menuTag } from "./shared";

/*
 * Menu item images (Supabase Storage bucket `menu-images`, public read).
 * Flow: createItemImageUpload -> the browser PUTs the file to the signed URL (uploadToSignedUrl) -> setItemImage.
 * Authorization is layered: menu.manage here, the Storage insert policy on `{orgId}/items/{itemId}/...` (item must
 * belong to the org), and the DB check on menu_items.image_path. Size (2 MiB) and MIME (webp/jpeg/png) limits are
 * enforced by the bucket. Signed upload URLs are valid for Supabase's fixed window (2 hours) and for one object path.
 */
type Failure = { ok: false; code?: ActionErrorCode; formError: string };
export type ImageUploadResult = { ok: true; path: string; token: string; signedUrl: string } | Failure;

const uuid = z.string().uuid();
const contentType = z.enum(MENU_IMAGE_MIME);
const GENERIC: Failure = { ok: false, formError: "Something went wrong. Please try again." };
const NOT_FOUND: Failure = { ok: false, code: "FORBIDDEN", formError: "That item could not be found." };
const OK: ActionResult = { ok: true };

async function authorize(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "menu.manage");
  return { orgId: ctx.org.id, supabase: await createClient() };
}

async function loadItem(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, itemId: string) {
  const { data } = await supabase.from("menu_items").select("id, image_path").eq("organization_id", orgId).eq("id", itemId).maybeSingle();
  return data;
}

/** Best effort: the item already points at the new image (or none), so a failed cleanup only leaves an orphan file. */
async function removeObject(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined) {
  if (!path) return;
  const { error } = await supabase.storage.from(MENU_IMAGES_BUCKET).remove([path]);
  if (error) console.warn("[menu-images] could not remove an old image object");
}

/** Step 1: a signed upload URL for a fresh random path in this item's folder. */
export async function createItemImageUpload(orgSlug: string, itemId: string, mime: string): Promise<ImageUploadResult> {
  const { orgId, supabase } = await authorize(orgSlug);
  const id = uuid.safeParse(itemId);
  const type = contentType.safeParse(mime);
  if (!id.success) return NOT_FOUND;
  if (!type.success) return { ok: false, formError: "Use a WebP, JPEG or PNG image." };
  if (!(await loadItem(supabase, orgId, id.data))) return NOT_FOUND;

  const path = `${menuImageFolder(orgId, id.data)}/${randomBytes(12).toString("base64url")}.${MENU_IMAGE_EXT[type.data]}`;
  const { data, error } = await supabase.storage.from(MENU_IMAGES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return GENERIC;
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
}

const setImageSchema = z.object({ itemId: uuid, path: z.string().max(200) });

/** Step 3: after the upload, attach the file to the item (and remove the previous object). */
export async function setItemImage(orgSlug: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { orgId, supabase } = await authorize(orgSlug);
  const parsed = parseForm(setImageSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { itemId, path } = parsed.data;
  if (!isOwnMenuImagePath(path, orgId, itemId)) return { ok: false, fieldErrors: { path: ["That image does not belong to this item."] } };
  const item = await loadItem(supabase, orgId, itemId);
  if (!item) return NOT_FOUND;

  // The file must really be in Storage (uploaded through the signed URL), not just a well-formed string.
  const folder = menuImageFolder(orgId, itemId);
  const file = path.slice(folder.length + 1);
  const { data: listed } = await supabase.storage.from(MENU_IMAGES_BUCKET).list(folder, { search: file, limit: 5 });
  if (!listed?.some((o) => o.name === file)) return { ok: false, fieldErrors: { path: ["Upload the image first."] } };

  const { error } = await supabase.from("menu_items").update({ image_path: path }).eq("organization_id", orgId).eq("id", itemId);
  if (error) return error.code === "42501" ? { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." } : GENERIC;
  if (item.image_path && item.image_path !== path) await removeObject(supabase, item.image_path);
  updateTag(menuTag(orgId));
  return OK;
}

const clearSchema = z.object({ itemId: uuid });

export async function clearItemImage(orgSlug: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { orgId, supabase } = await authorize(orgSlug);
  const parsed = parseForm(clearSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const item = await loadItem(supabase, orgId, parsed.data.itemId);
  if (!item) return NOT_FOUND;
  const { error } = await supabase.from("menu_items").update({ image_path: null }).eq("organization_id", orgId).eq("id", item.id);
  if (error) return error.code === "42501" ? { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." } : GENERIC;
  await removeObject(supabase, item.image_path);
  updateTag(menuTag(orgId));
  return OK;
}
