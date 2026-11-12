export function BillsSkeleton() {
  return (
    <div role="status" aria-label="Loading bill" className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4">
      <div className="h-10 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
