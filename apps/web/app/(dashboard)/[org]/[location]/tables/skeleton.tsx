export function TablesSkeleton() {
  return (
    <div role="status" aria-label="Loading tables" className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-32 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
