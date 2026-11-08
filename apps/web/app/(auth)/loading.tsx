export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
