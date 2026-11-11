import "server-only";
import type { Locale } from "./config";
import type { Dictionary } from "./types";

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  id: () => import("./id").then((m) => m.id),
  en: () => import("./en").then((m) => m.en),
};

/** Server-only. Client components receive the slice they need as a prop. */
export const getDictionary = (locale: Locale): Promise<Dictionary> => dictionaries[locale]();
