export function KitchenSkeleton() {
  return (
    <div role="status" aria-label="Loading tickets" className="grid min-h-dvh grid-cols-1 gap-4 bg-neutral-100 p-4 md:grid-cols-2 xl:grid-cols-3 dark:bg-neutral-950">
      {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />)}
    </div>
  );
}
