"use client";

import { ForbiddenNotice } from "@/components/dashboard/notices";

export default function PosError({ error, reset }: { error: Error; reset: () => void }) {
  if (error.name === "ForbiddenError") return <ForbiddenNotice />;
  return (
    <div role="alert" className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-medium">Could not load the POS.</p>
      <button type="button" onClick={reset} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Try again</button>
    </div>
  );
}
