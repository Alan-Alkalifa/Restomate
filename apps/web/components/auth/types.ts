/**
 * Mirrors the MF-T13 contract (lib/auth). When DAVIN's `ActionResult` lands,
 * replace this with a re-export: `export type { ActionResult } from "@/lib/auth/..."`.
 */
export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      fieldErrors?: Record<string, string[] | undefined>;
      formError?: string;
    };

/** Shape accepted by React's `useActionState`. */
export type AuthAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;
