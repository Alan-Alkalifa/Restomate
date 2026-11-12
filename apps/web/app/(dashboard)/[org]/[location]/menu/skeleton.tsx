export function LocationMenuSkeleton() {
  return (
    <div role="status" aria-label="Loading menu" className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 w-72 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-24 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-24 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
