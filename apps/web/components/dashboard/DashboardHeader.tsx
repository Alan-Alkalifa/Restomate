/**
 * Shell header. Everything wraps instead of overflowing (BUG-63-1: the document was 865px wide at 768–864px because
 * the right-hand group never wrapped and the column had no `min-w-0`). The right column also needs `min-w-0` where
 * it is a flex child; see layout.tsx.
 */
export function DashboardHeader({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
      <p className="min-w-0 font-semibold break-words">{orgName}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
    </header>
  );
}
