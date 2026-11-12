import type { ActionResult } from "@/lib/auth/schemas";

// Data shapes come from the real lib/menu/data (type-only import: erased at build, so nothing server-only reaches the client).
import type { DietaryTag, getMenu } from "@/lib/menu/data";
export type { DietaryTag, MenuCategory, MenuItem, MenuVariant, Modifier, ModifierGroup } from "@/lib/menu/data";

export type MenuData = Awaited<ReturnType<typeof getMenu>>;

// Runtime list for the form checkboxes. lib/menu/schemas.ts owns the validated list (a test keeps the two in sync);
// it is not imported here so zod stays out of the client bundle.
export const DIETARY_TAGS = ["vegetarian", "vegan", "halal", "spicy", "contains_nuts", "gluten_free"] as const satisfies readonly DietaryTag[];

/** A form action with the org slug already bound on the server. The client never sends an organization. */
export type BoundMenuAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export type MenuActions = {
  createCategory: BoundMenuAction; updateCategory: BoundMenuAction; setCategoryActive: BoundMenuAction; reorderCategories: BoundMenuAction;
  createItem: BoundMenuAction; updateItem: BoundMenuAction; setItemActive: BoundMenuAction; setItemPublished: BoundMenuAction;
  reorderItems: BoundMenuAction; saveItemVariants: BoundMenuAction;
  createModifierGroup: BoundMenuAction; updateModifierGroup: BoundMenuAction; setModifierGroupActive: BoundMenuAction;
  saveGroupModifiers: BoundMenuAction; setItemModifierGroups: BoundMenuAction;
};

export type { ActionResult };
