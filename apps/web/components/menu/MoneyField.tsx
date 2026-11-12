"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { currencyExponent, parseMoneyInput } from "@/lib/money";
import { formatMoneyInput } from "./money-input";

/**
 * Price input. The visible text is parsed to integer minor units (no floats); the hidden field `name` carries that
 * integer. Invalid text posts nothing useful, so the form shows the problem and the server's error as well.
 */
export function MoneyField({
  name,
  label,
  currency,
  defaultMinor,
  allowNegative,
  errors,
  required = true,
}: {
  name: string;
  label: string;
  currency: string;
  defaultMinor?: number;
  allowNegative?: boolean;
  errors?: string[];
  required?: boolean;
}) {
  const [text, setText] = useState(defaultMinor === undefined ? "" : formatMoneyInput(defaultMinor, currency));
  const parsed = text.trim() === "" && !required ? null : parseMoneyInput(text, currency, { allowNegative });
  const clientError = parsed && !parsed.ok ? [parsed.message] : [];
  const value = parsed && parsed.ok ? String(parsed.value) : "";
  const exp = currencyExponent(currency);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Field
        name={`${name}-text`}
        label={label}
        inputMode={exp === 0 ? "numeric" : "decimal"}
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        errors={[...(errors ?? []), ...(text !== "" ? clientError : [])]}
        hint={exp === 0 ? "Whole rupiah, e.g. 35000" : undefined}
      />
    </>
  );
}
