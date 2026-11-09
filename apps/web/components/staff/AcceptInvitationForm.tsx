"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { staffErrorMessage } from "./errors";
import type { StaffAction, StaffActionResult } from "./types";

export function AcceptInvitationForm({ action, token }: { action: StaffAction; token: string }) {
  const [state, formAction, pending] = useActionState<StaffActionResult | null, FormData>(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormAlert message={staffErrorMessage(state)} />
      <Button type="submit" pending={pending}>{pending ? "Joining…" : "Accept invitation"}</Button>
    </form>
  );
}
