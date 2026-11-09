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
 * Dollar-amount number input. While focused it gets the raw number, which React leaves
 * alone when it equals the typed text ("12.50" stays as typed), so nothing reformats
 * mid-typing; on blur it switches to the two-decimal text.
 * @param props - Native input props plus the amount.
 * @param props.amount - The amount in dollars.
 * @param props.showZero - Show 0 as "0" instead of an empty box.
 * @param props.bare - Skip the admin field style and apply `className` as given.
 * @param props.onFocus - Called after the box starts showing what's typed.
 * @param props.onBlur - Called after the box goes back to two-decimal text.
 * @returns The input element.
 */
export function MoneyInput({
  amount,
  showZero = false,
  bare = false,
  onFocus,
  onBlur,
  ...rest
}: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const blank = amount === 0 && !showZero;
  const Input: React.ElementType = bare ? "input" : AdminInput;
  return (
    <Input
      {...rest}
      type="number"
      value={blank ? "" : editing ? amount : moneyInputText(amount)}
      onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
        setEditing(false);
        onBlur?.(e);
      }}
    />
  );
}
