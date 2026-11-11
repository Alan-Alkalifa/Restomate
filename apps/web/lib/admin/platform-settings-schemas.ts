import { z } from "zod";

export type BannerLevel = "info" | "warning";
export type MaintenanceBanner = { enabled: boolean; message: string; level: BannerLevel };
export type TaxPreset = {
  code: string;
  label: string;
  taxRateBps: number;
  serviceChargeBps: number;
  taxOnServiceCharge: boolean;
};
export type PlatformSettings = {
  signup: { enabled: boolean };
  maintenanceBanner: MaintenanceBanner;
  taxPresets: { presets: TaxPreset[]; defaultCode: string };
  ownedOrgCap: { max: number };
};
/** The API keys (the RPC, the audit log). `owned_org_cap` is stored in the legacy row `max_owned_organizations`. */
export type SettingKey = "signup" | "maintenance_banner" | "tax_presets" | "owned_org_cap";

export const BANNER_MESSAGE_MAX = 200;
export const TAX_PRESETS_MAX = 20;
export const TAX_PRESETS_JSON_MAX = 8192;
export const OWNED_ORG_CAP_RANGE = { min: 1, max: 100 } as const;
export const BPS_MAX = 10_000;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  signup: { enabled: true },
  maintenanceBanner: { enabled: false, message: "", level: "info" },
  taxPresets: {
    presets: [
      { code: "pb1_10", label: "PB1 10%", taxRateBps: 1000, serviceChargeBps: 0, taxOnServiceCharge: true },
      { code: "pb1_10_sc5", label: "PB1 10% + service 5%", taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true },
    ],
    defaultCode: "pb1_10",
  },
  ownedOrgCap: { max: 3 },
};

// ---- value schemas (what the RPC stores) --------------------------------------------------------------------

export const signupSchema = z.strictObject({ enabled: z.boolean() });

// Plain text: no control characters, no angle brackets. The UI renders it as a text node.
export const bannerMessageSchema = z
  .string()
  .trim()
  .max(BANNER_MESSAGE_MAX, `Keep it under ${BANNER_MESSAGE_MAX} characters.`)
  .refine((s) => !/[\p{Cc}]/u.test(s), "Use plain text on one line.")
  .refine((s) => !/[<>]/.test(s), "Plain text only: no < or >.");

export const maintenanceBannerSchema = z
  .strictObject({ enabled: z.boolean(), message: bannerMessageSchema, level: z.enum(["info", "warning"]) })
  .refine((v) => !v.enabled || v.message !== "", { path: ["message"], message: "Enter the message to show." });

const bps = (label: string) =>
  z.number().int(`${label} must be a whole number of basis points.`).min(0, `${label} must be at least 0.`).max(BPS_MAX, `${label} must be at most ${BPS_MAX}.`);

export const taxPresetSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_-]{1,29}$/, "Code: 2–30 lowercase letters, digits, - or _, starting with a letter."),
  label: z.string().trim().min(1, "Enter a label.").max(60, "Keep the label under 60 characters.").refine((s) => !/[\p{Cc}]/u.test(s), "Use plain text."),
  taxRateBps: bps("Tax rate"),
  serviceChargeBps: bps("Service charge"),
  taxOnServiceCharge: z.boolean(),
});

export const taxPresetsSchema = z
  .strictObject({
    presets: z.array(taxPresetSchema).min(1, "Add at least one preset.").max(TAX_PRESETS_MAX, `At most ${TAX_PRESETS_MAX} presets.`),
    defaultCode: z.string(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.presets.forEach((p, i) => {
      if (seen.has(p.code)) ctx.addIssue({ code: "custom", path: ["presets", i, "code"], message: "Codes must be unique." });
      seen.add(p.code);
    });
    if (!seen.has(v.defaultCode)) ctx.addIssue({ code: "custom", path: ["defaultCode"], message: "Pick one of the presets as the default." });
  });

export const ownedOrgCapSchema = z.strictObject({
  max: z.number().int().min(OWNED_ORG_CAP_RANGE.min, "At least 1.").max(OWNED_ORG_CAP_RANGE.max, "At most 100."),
});

// ---- form schemas (FormData -> value) ---------------------------------------------------------------------------

const boolField = z.enum(["true", "false"]).transform((v) => v === "true");

export const signupFormSchema = z.strictObject({ enabled: boolField }).pipe(signupSchema);
export const maintenanceBannerFormSchema = z
  .strictObject({ enabled: boolField, message: z.string(), level: z.enum(["info", "warning"]) })
  .pipe(maintenanceBannerSchema);
export const ownedOrgCapFormSchema = z
  .strictObject({ max: z.string().trim().regex(/^\d{1,3}$/, "Enter a whole number.").transform(Number) })
  .pipe(ownedOrgCapSchema);

/** FormData -> plain object. React's `$ACTION*` bookkeeping fields are skipped; any other unknown field reaches the strict schema. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (!key.startsWith("$ACTION")) o[key] = fd.get(key);
  }
  return o;
}

/** Parse the `presets` JSON field (size-capped) and return the value object, or a field error. */
export function parseTaxPresetsForm(fd: FormData): { ok: true; value: unknown } | { ok: false; fieldErrors: Record<string, string[]>; formError?: string } {
  const raw = formToObject(fd);
  const { presets, defaultCode, ...rest } = raw;
  const extra = Object.keys(rest);
  if (extra.length > 0) return { ok: false, fieldErrors: {}, formError: `Unrecognized field: ${extra.join(", ")}` };
  if (typeof presets !== "string" || presets.length > TAX_PRESETS_JSON_MAX) {
    return { ok: false, fieldErrors: { presets: ["The presets data is missing or too large."] } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(presets);
  } catch {
    return { ok: false, fieldErrors: { presets: ["The presets data is not valid."] } };
  }
  return { ok: true, value: { presets: parsed, defaultCode } };
}

/** Zod issues -> fieldErrors keyed by the first path segment; preset errors name the preset ("Preset 2: ..."). */
export function settingsFieldErrors(error: z.ZodError): { fieldErrors: Record<string, string[]>; formError?: string } {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    const [head, idx] = issue.path;
    if (head === undefined) {
      formErrors.push(issue.message);
      continue;
    }
    const key = String(head);
    const msg = key === "presets" && typeof idx === "number" ? `Preset ${idx + 1}: ${issue.message}` : issue.message;
    (fieldErrors[key] ??= []).push(msg);
  }
  return { fieldErrors, ...(formErrors.length > 0 ? { formError: formErrors.join(" ") } : {}) };
}
