"use client";

// `retry`, per node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
export default function AdminError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <button type="button" onClick={() => retry()} className="min-h-12 rounded-lg bg-indigo-700 px-5 font-semibold text-white">Try again</button>
    </div>
  );
}
