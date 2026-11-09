import type { ActionResult } from "@/lib/auth/schemas";

export type { ActionResult };

/** Shape accepted by React's `useActionState`. */
export type AuthAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;
