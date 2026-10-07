"use client";
// src/features/business/components/invoice/AlreadyPaidField.tsx
// The "Already paid" box: an amount and Cash or Bank, with the balance it leaves. Shared
// by the calculator and the invoice edit page. The method never shows on the invoice; it
// only decides how the income entry is recorded.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import {
  ALREADY_PAID_METHODS,
  alreadyPaidAmount,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import { formatNZD } from "@/features/business/lib/business-format";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId } from "react";

interface Props {
  value: AlreadyPaidState;
  onChange: (next: AlreadyPaidState) => void;
  /** Invoice total the amount comes off. */
  total: number;
  disabled?: boolean;
  /** Classes for the amount input, so it matches the surrounding form. */
  inputClassName: string;
  /** Hint shown when the amount covers the whole total. */
  coversNote: string;
  /** Field label; defaults to "Already paid". */
  label?: string;
  /** Words before the remaining amount; defaults to "Balance due". */
  balanceLabel?: string;
}

/**
 * Amount and Cash/Bank for money handed over before the invoice goes out.
 * @param props - Component props.
 * @param props.value - Current amount and method.
 * @param props.onChange - Receives the next amount and method.
 * @param props.total - Invoice total the amount comes off.
 * @param props.disabled - Disables the input and method buttons.
 * @param props.inputClassName - Classes for the amount input.
 * @param props.coversNote - Hint shown when the amount covers the whole total.
 * @param props.label - Field label; defaults to "Already paid".
 * @param props.balanceLabel - Words before the remaining amount; defaults to "Balance due".
 * @returns The field element.
 */
export function AlreadyPaidField({
  value,
  onChange,
  total,
  disabled = false,
  inputClassName,
  coversNote,
  label = "Already paid",
  balanceLabel = "Balance due",
}: Props): React.ReactElement {
  const id = useId();
  const amount = alreadyPaidAmount(value);
  const balance = Math.max(0, Math.round((total - amount) * 100) / 100);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          disabled={disabled}
          className={cn(inputClassName, "w-28 flex-none")}
        />
        <div className="flex gap-2">
          {ALREADY_PAID_METHODS.map((m) => (
            <AdminButton
              key={m}
              size="sm"
              aria-label={value.method === m ? `Paid by ${m} (selected)` : `Paid by ${m}`}
              variant={value.method === m ? "primary" : "secondary"}
              disabled={disabled}
              onClick={() => onChange({ ...value, method: m })}
            >
              {m}
            </AdminButton>
          ))}
        </div>
      </div>
      {amount > 0 && (
        <p className="text-sm opacity-75">
          {balance > 0 ? `${balanceLabel} ${formatNZD(balance)}` : coversNote}
        </p>
      )}
    </div>
  );
}
