"use client";

import { useState } from "react";

/**
 * Checkbox that always posts a value: "true" when checked, an explicit hidden "false" when not
 * (an unchecked checkbox posts nothing, and servers must not have to guess).
 */
export function CheckField({
  name,
  label,
  value = "true",
  defaultChecked = false,
  explicitFalse = true,
  onChange,
}: {
  name: string;
  label: string;
  value?: string;
  defaultChecked?: boolean;
  /** false for repeated list fields (dietaryTags), where an absent entry already means "not selected". */
  explicitFalse?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label className="flex min-h-12 items-center gap-3 text-sm">
      {explicitFalse && !checked && <input type="hidden" name={name} value="false" />}
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="h-6 w-6"
      />
      {label}
    </label>
  );
}
