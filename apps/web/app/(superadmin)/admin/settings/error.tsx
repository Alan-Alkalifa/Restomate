"use client";

export default function SettingsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-red-300 p-6">
      <p className="font-medium">Could not load the settings.</p>
      <button type="button" onClick={reset} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Try again</button>
    </div>
  );
}
