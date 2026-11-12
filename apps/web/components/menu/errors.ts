import type { ActionResult } from "./types";

/** Friendly copy for known codes; the server's own message is the fallback. */
export function menuErrorMessage(r: ActionResult | null): string | undefined {
  if (!r || r.ok) return undefined;
  switch (r.code as string | undefined) {
    case "FORBIDDEN":
      return "You don't have permission to change the menu.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a moment and try again.";
    case "DUPLICATE_NAME":
      return r.formError ?? "That name is already in use. Choose another.";
    default:
      return r.formError;
  }
}

const LABELS: Record<string, string> = {
  name: "Name", description: "Description", basePrice: "Price", categoryId: "Category", itemId: "Item", groupId: "Group",
  minSelect: "Minimum", maxSelect: "Maximum", variants: "Variants", modifiers: "Modifiers", dietaryTags: "Dietary tags",
  groupIds: "Modifier groups", categoryIds: "Order", itemIds: "Order",
};

/** Field errors whose field has no visible control inside `form` (hidden ids, JSON lists): shown in the summary alert. */
export function hiddenFieldErrors(r: ActionResult | null, form: { elements: ArrayLike<unknown> } | null): string[] {
  if (!r || r.ok || !r.fieldErrors) return [];
  const out: string[] = [];
  for (const [name, msgs] of Object.entries(r.fieldErrors)) {
    if (!msgs?.length) continue;
    const els = form ? Array.from(form.elements as ArrayLike<{ name?: string; type?: string }>).filter((el) => el.name === name) : [];
    if (els.some((el) => el.type !== "hidden")) continue;
    const label = LABELS[name];
    out.push(label ? `${label}: ${msgs.join(" ")}` : msgs.join(" "));
  }
  return out;
}

export const errorsFor = (r: ActionResult | null, name: string) => (r && !r.ok ? r.fieldErrors?.[name] : undefined);

/** Summary for forms that have no DOM to inspect (inline buttons): every field error, labelled. */
export function allFieldErrors(r: ActionResult | null): string[] {
  return hiddenFieldErrors(r, null);
}
