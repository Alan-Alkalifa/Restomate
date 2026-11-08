"use server";

/**
 * TEMPORARY SEAM until MF-T13 (lib/auth actions) merges.
 * Wiring = replace this file's body with:
 *   export { signIn, signUp, requestPasswordReset, updatePassword, signOut } from "@/lib/auth/actions";
 * (adapt names/paths to DAVIN's final exports). Pages import only from here.
 */
import type { ActionResult } from "@/components/auth/types";

const notWired = async (): Promise<ActionResult> => ({
  ok: false,
  formError: "Authentication is not available yet.",
});

export const signIn = notWired;
export const signUp = notWired;
export const requestPasswordReset = notWired;
export const updatePassword = notWired;
export const signOut = async (): Promise<void> => {};
