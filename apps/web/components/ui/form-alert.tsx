/** Always-mounted live region so screen readers announce errors/status when text appears. */
export function FormAlert({
  message,
  tone = "error",
  id,
}: {
  message?: string | null;
  tone?: "error" | "info";
  id?: string;
}) {
  return (
    <div id={id} data-form-alert tabIndex={-1} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      {message ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            tone === "error"
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              : "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
