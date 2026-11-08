"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** For the dashboard header. `action` is MF-T13's `signOut(): Promise<void>` (redirects to /login). */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={() => {
        startTransition(async () => {
          await action();
        });
      }}
    >
      <Button type="submit" pending={pending} className="bg-transparent text-inherit ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </form>
  );
}
