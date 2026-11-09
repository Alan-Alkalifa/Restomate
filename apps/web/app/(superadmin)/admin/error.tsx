"use client";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <button type="button" onClick={reset} className="min-h-12 rounded-lg bg-indigo-700 px-5 font-semibold text-white">Try again</button>
    </div>
  );
}
