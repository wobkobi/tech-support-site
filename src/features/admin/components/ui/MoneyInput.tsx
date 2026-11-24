"use client";
// src/features/admin/components/ui/MoneyInput.tsx
// Number box for a dollar amount that reads "12.50", never "12.5", once you leave it.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { moneyInputText } from "@/shared/lib/money";
import type React from "react";
import { useState } from "react";

type Props = Omit<React.ComponentProps<"input">, "type" | "value"> & {
  /** The amount in dollars. */
  amount: number;
  /** Show 0 as "0" instead of an empty box. */
  showZero?: boolean;
  /** Skip the admin field style and apply `className` as given. */
  bare?: boolean;
};

/**
 * Dollar-amount number input. While focused it shows exactly what was typed, so "0" on the
 * way to "0.50" stays put; if the amount changes from outside mid-edit it shows that instead.
 * On blur it switches to the two-decimal text.
 * @param props - Native input props plus the amount.
 * @param props.amount - The amount in dollars.
 * @param props.showZero - Show 0 as "0" instead of an empty box.
 * @param props.bare - Skip the admin field style and apply `className` as given.
 * @param props.onFocus - Called after the box starts showing what's typed.
 * @param props.onBlur - Called after the box goes back to two-decimal text.
 * @param props.onChange - Called with each keystroke's change event.
 * @returns The input element.
 */
export function MoneyInput({
  amount,
  showZero = false,
  bare = false,
  onFocus,
  onBlur,
  onChange,
  ...rest
}: Props): React.ReactElement {
  // The typed text while focused; null when not editing.
  const [typed, setTyped] = useState<string | null>(null);
  const blank = amount === 0 && !showZero;
  const Input: React.ElementType = bare ? "input" : AdminInput;
  const typedMatches = typed !== null && Number(typed || "0") === amount;
  const value = typedMatches ? typed : blank ? "" : moneyInputText(amount);
  return (
    <Input
      {...rest}
      type="number"
      value={value}
      onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
        setTyped(blank ? "" : String(amount));
        onFocus?.(e);
      }}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        setTyped(e.target.value);
        onChange?.(e);
      }}
      onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
        setTyped(null);
        onBlur?.(e);
      }}
    />
  );
}
