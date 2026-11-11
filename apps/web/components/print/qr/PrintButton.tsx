"use client";

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => window.print()} className="min-h-12 rounded-lg bg-teal-700 px-5 text-base font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-60">
      Print
    </button>
  );
}
