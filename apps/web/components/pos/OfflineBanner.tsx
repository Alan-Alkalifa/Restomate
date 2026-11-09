export function OfflineBanner({ online }: { online: boolean }) {
  // Always mounted so assistive tech announces the change when the text appears.
  return (
    <div role="status" aria-live="polite" data-offline={!online || undefined}>
      {online ? null : (
        <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
          <span aria-hidden>⚠ </span>Reconnecting… You can keep building the cart; nothing is lost.
        </p>
      )}
    </div>
  );
}
