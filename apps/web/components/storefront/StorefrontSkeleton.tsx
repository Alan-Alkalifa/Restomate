export function StorefrontSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
      <div className="h-12 w-2/3 animate-pulse rounded bg-neutral-200" />
      <div className="h-12 animate-pulse rounded bg-neutral-200" />
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-200" />)}
    </div>
  );
}
