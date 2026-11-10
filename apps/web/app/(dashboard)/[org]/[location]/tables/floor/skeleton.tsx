export function FloorSkeleton() {
  return (
    <div role="status" aria-label="Loading floor plan" className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 w-72 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="aspect-square w-full max-w-xl animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
