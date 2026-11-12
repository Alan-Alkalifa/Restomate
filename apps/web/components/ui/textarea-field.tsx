import type { TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "name"> & { name: string; label: string; errors?: string[] };

export function TextAreaField({ name, label, errors, ...rest }: Props) {
  const id = `field-${name}`;
  const hasError = !!errors?.length;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <textarea
        {...rest}
        id={id}
        name={name}
        rows={rest.rows ?? 3}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className="rounded-lg border border-neutral-400 bg-transparent px-3 py-2 text-base aria-[invalid=true]:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      />
      {hasError && <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">{errors!.join(" ")}</p>}
    </div>
  );
}
