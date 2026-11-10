"use client";

import { ForbiddenNotice } from "@/components/dashboard/notices";

export default function TablesError({ error, retry }: { error: Error; retry: () => void }) {
  if (error.name === "ForbiddenError") return <ForbiddenNotice />;
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">We couldn&apos;t load your tables</h1>
      <p className="text-sm">Check your connection and try again.</p>
      <button type="button" onClick={() => retry()} className="min-h-12 rounded-lg bg-teal-700 px-5 font-semibold text-white">Try again</button>
    </div>
  );
}
