export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-32 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
