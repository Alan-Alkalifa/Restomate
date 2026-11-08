"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { AuthAction } from "./types";

/** For the dashboard header. `action` is MF-T13's `signOut` (redirects to /login on success). */
export function SignOutButton({ action }: { action: AuthAction }) {
  const [, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction}>
      <Button type="submit" pending={pending} className="bg-transparent text-inherit ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  );
}
