const TONES = {
  neutral: "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-50",
  green: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-50",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-50",
  red: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-50",
  sky: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-50",
} as const;

/** Small status pill. The meaning is always in the text, never in the colour alone. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}
