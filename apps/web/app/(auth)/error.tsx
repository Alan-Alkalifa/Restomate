"use client";

import { Button } from "@/components/ui/button";

export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm">Please try again. If the problem continues, come back in a few minutes.</p>
      <Button type="button" onClick={reset}>Try again</Button>
    </div>
  );
}
