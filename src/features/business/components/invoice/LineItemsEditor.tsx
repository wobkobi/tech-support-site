"use client";
// src/features/business/components/invoice/LineItemsEditor.tsx
// Editable list of invoice line items: description, qty, unit price, with every row's
// `lineTotal` re-derived through withSplitLineTotals as the operator types, adds or removes a
// row. Purely controlled - the parent owns the array and validates it (mirroring
// isValidLineItem) before persisting.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { REMOVE_ROW_CLS } from "@/features/business/components/calculator/calculator-classes";
import { formatNZD, withSplitLineTotals } from "@/features/business/lib/business";
import type { LineItem } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaXmark } from "react-icons/fa6";

/** Props for {@link LineItemsEditor}. */
interface LineItemsEditorProps {
  /** Current line items (parent-owned). */
  items: LineItem[];
  /** Called with the next array on any edit/add/remove. */
  onChange: (items: LineItem[]) => void;
  /** Disables every control (e.g. while submitting). */
  disabled?: boolean;
}

const INPUT_CLS =
  "rounded-lg border border-admin-border-strong bg-admin-surface px-2.5 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";

/**
 * Parses a numeric input value, treating blank/garbage as 0.
 * @param raw - Raw input string.
 * @returns A finite number (0 when unparseable).
 */
function parseNum(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Editable invoice line-item rows with a derived line total.
 * @param props - Component props.
 * @param props.items - Current line items.
 * @param props.onChange - Change handler receiving the next array.
 * @param props.disabled - Whether editing is disabled.
 * @returns The editor element.
 */
export function LineItemsEditor({
  items,
  onChange,
  disabled = false,
}: LineItemsEditorProps): React.ReactElement {
  /**
   * Applies a patch to one row, re-deriving its line total.
   * @param idx - Row index.
   * @param patch - Fields to merge.
   */
  function updateRow(idx: number, patch: Partial<LineItem>): void {
    onChange(
      withSplitLineTotals(
        items.map((item, i) => {
          if (i !== idx) return item;
          const merged = { ...item, ...patch };
          // This editor works in decimal quantities. A hand-typed qty on a row
          // that carried billed minutes has to rewrite them, or the stale minutes
          // would keep printing the old h:mm while the total moved.
          const minutes =
            patch.qty !== undefined && merged.minutes != null
              ? Math.round(merged.qty * 60)
              : merged.minutes;
          return { ...merged, ...(minutes != null && { minutes }) };
        }),
      ),
    );
  }

  return (
    <div className="space-y-2">
      {/* Column headers (sm+ only; the phone rows carry their own labels). Keep the
          columns in step with the row grid below. */}
      <div className="hidden gap-2 px-1 text-sm font-semibold text-admin-muted sm:grid sm:grid-cols-[1fr_5rem_7rem_6rem_2.75rem]">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Total</span>
        <span />
      </div>

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-admin-border px-3 py-4 text-center text-sm text-admin-faint">
          No line items - add one below.
        </p>
      )}

      {items.map((item, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_2.75rem] items-end gap-2 sm:grid-cols-[1fr_5rem_7rem_6rem_2.75rem] sm:items-center"
        >
          <input
            type="text"
            value={item.description}
            onChange={(e) => updateRow(idx, { description: e.target.value })}
            placeholder="Description"
            disabled={disabled}
            className={cn("col-span-4 sm:col-span-1", INPUT_CLS)}
            aria-label={`Line ${idx + 1} description`}
          />
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-admin-muted sm:hidden">Qty</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.25"
              value={item.qty}
              onChange={(e) => updateRow(idx, { qty: parseNum(e.target.value) })}
              disabled={disabled}
              className={cn("text-right", INPUT_CLS)}
              aria-label={`Line ${idx + 1} quantity`}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-admin-muted sm:hidden">Unit price</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={item.unitPrice}
              onChange={(e) => updateRow(idx, { unitPrice: parseNum(e.target.value) })}
              disabled={disabled}
              className={cn("text-right", INPUT_CLS)}
              aria-label={`Line ${idx + 1} unit price`}
            />
          </label>
          <span className="flex h-10 items-center justify-end px-1 text-sm font-semibold whitespace-nowrap text-admin-text">
            {formatNZD(item.lineTotal)}
          </span>
          <button
            type="button"
            onClick={() => onChange(withSplitLineTotals(items.filter((_, i) => i !== idx)))}
            disabled={disabled}
            aria-label={`Remove line ${idx + 1}`}
            className={REMOVE_ROW_CLS}
          >
            <FaXmark className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}

      <AdminButton
        variant="secondary"
        size="xs"
        onClick={() =>
          onChange([...items, { description: "", qty: 1, unitPrice: 0, lineTotal: 0 }])
        }
        disabled={disabled}
      >
        + Add line item
      </AdminButton>
    </div>
  );
}
