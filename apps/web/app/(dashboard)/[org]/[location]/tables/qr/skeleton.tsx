export function QrSkeleton() {
  return (
    <div role="status" aria-label="Loading QR codes" className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 w-80 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="aspect-[210/297] w-full max-w-md animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
