import type { en } from "./en";

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
/** The shape every locale must have. Missing and extra keys are both type errors. */
export type Dictionary = Widen<typeof en>;
export type AuthDictionary = Dictionary["auth"];
export type MarketingDictionary = Dictionary["marketing"];
export type ModuleKey = keyof MarketingDictionary["modules"];
export type BillsDictionary = Dictionary["bills"];
