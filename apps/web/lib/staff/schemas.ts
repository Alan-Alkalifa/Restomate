import { z } from "zod";

const id = z.string().uuid("Invalid selection.");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const locationIds = z.array(id).max(100).default([]);

const scope = {
  allLocations: bool,
  locationIds,
};
const needsLocations = (v: { allLocations: boolean; locationIds: string[] }) => v.allLocations || v.locationIds.length > 0;
const needsLocationsMsg = { path: ["locationIds"], message: "Choose at least one location or all locations." };

export const inviteStaffSchema = z
  .object({
    email: z.string().trim().toLowerCase().min(1, "Enter an email address.").max(254, "That email address is too long.").pipe(z.email("Enter a valid email address.")),
    roleId: id,
    ...scope,
  })
  .refine(needsLocations, needsLocationsMsg);

export const invitationIdSchema = z.object({ invitationId: id });
export const memberIdSchema = z.object({ memberId: id });
export const changeRoleSchema = z.object({ memberId: id, roleId: id });
export const setLocationsSchema = z.object({ memberId: id, ...scope }).refine(needsLocations, needsLocationsMsg);
export const acceptSchema = z.object({ token: z.string().min(16).max(256) });

/** FormData -> object; keys listed in `multi` are collected with getAll(). */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData, multi: string[] = []) {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (multi.includes(key)) obj[key] = formData.getAll(key).filter((v): v is string => typeof v === "string");
    else {
      const v = formData.get(key);
      if (typeof v === "string") obj[key] = v;
    }
  }
  return schema.safeParse(obj);
}

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) (out[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  return out;
}
