import type { SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name"> & {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  errors?: string[];
  hint?: string;
};

/** Labelled native select with the same error wiring as Field. */
export function SelectField({ name, label, options, errors, hint, ...select }: Props) {
  const id = `field-${name}`;
  const hasError = !!errors?.length;
  const describedBy = [hint && `${id}-hint`, hasError && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select
        {...select}
        id={id}
        name={name}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2 text-base aria-[invalid=true]:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p id={`${id}-hint`} className="text-xs text-neutral-600 dark:text-neutral-400">{hint}</p>}
      {hasError && <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">{errors!.join(" ")}</p>}
    </div>
  );
}
