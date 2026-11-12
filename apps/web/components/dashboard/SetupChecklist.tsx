import Link from "next/link";
import type { SetupProgress, SetupStepKey } from "@/lib/onboarding/progress";

export const SETUP_LABELS: Record<SetupStepKey, string> = {
  location: "Add location details",
  tables: "Add your tables",
  menu: "Build your menu",
  staff: "Invite your staff",
  branding: "Set your branding",
};

function Rows({ progress, orgSlug }: { progress: SetupProgress; orgSlug: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {progress.steps.map((s) => (
        <li key={s.key} data-done={s.done || undefined} className="flex min-h-12 items-center gap-3 rounded-lg border border-neutral-300 px-3 dark:border-neutral-700">
          {/* State is text + icon, never colour alone. */}
          <span aria-hidden className="w-5 text-center">{s.done ? "✓" : "○"}</span>
          {s.href !== null ? (
            <Link href={`/${orgSlug}/${s.href}`} className="flex min-h-12 flex-1 items-center underline">{SETUP_LABELS[s.key]}</Link>
          ) : (
            <span className="flex-1">{SETUP_LABELS[s.key]}</span>
          )}
          <span className={`text-sm ${s.done ? "font-medium text-teal-800 dark:text-teal-300" : "text-neutral-600 dark:text-neutral-400"}`}>{s.done ? "Done" : "To do"}</span>
        </li>
      ))}
    </ul>
  );
}

export function SetupChecklist({ progress, orgSlug }: { progress: SetupProgress; orgSlug: string }) {
  const complete = progress.completed === progress.total;
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <section aria-labelledby="setup" className="flex flex-col gap-3">
      <h2 id="setup" className="text-lg font-semibold">Set up your restaurant</h2>
      <p className="text-sm" aria-live="polite">{progress.completed} of {progress.total} done</p>
      <div role="progressbar" aria-labelledby="setup" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}
        aria-valuetext={`${progress.completed} of ${progress.total} done`} className="h-2 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full bg-teal-700" style={{ width: `${pct}%` }} />
      </div>
      {complete ? (
        <details className="rounded-lg">
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 font-medium">
            <span aria-hidden>✓</span> You&apos;re all set
          </summary>
          <div className="mt-2"><Rows progress={progress} orgSlug={orgSlug} /></div>
        </details>
      ) : (
        <Rows progress={progress} orgSlug={orgSlug} />
      )}
    </section>
  );
}
