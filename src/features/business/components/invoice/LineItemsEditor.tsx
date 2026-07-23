"use client";
// src/features/business/components/invoice/LineItemsEditor.tsx
/**
 * @description Editable list of invoice line items: description, qty, unit price,
 * with `lineTotal` auto-derived (qty x unitPrice, rounded to cents) as the
 * operator types. Add/remove rows. Purely controlled - the parent owns the array
 * and validates it (mirroring isValidLineItem) before persisting.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { formatNZD } from "@/features/business/lib/business";
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
 * Rounds a derived line total to cents.
 * @param qty - Quantity.
 * @param unitPrice - Unit price.
 * @returns qty x unitPrice, rounded to 2dp.
 */
function deriveLineTotal(qty: number, unitPrice: number): number {
  return Math.round(qty * unitPrice * 100) / 100;
}

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
      items.map((item, i) => {
        if (i !== idx) return item;
        const merged = { ...item, ...patch };
        return { ...merged, lineTotal: deriveLineTotal(merged.qty, merged.unitPrice) };
      }),
    );
  }

  return (
    <div className="space-y-2">
      {/* Column headers (sm+ only; the mobile rows carry inline labels). */}
      <div className="hidden gap-2 px-1 text-xs font-semibold text-admin-muted sm:grid sm:grid-cols-[1fr_5rem_7rem_6rem_2rem]">
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
          className="grid grid-cols-[1fr_2rem] items-center gap-2 sm:grid-cols-[1fr_5rem_7rem_6rem_2rem]"
        >
          <input
            type="text"
            value={item.description}
            onChange={(e) => updateRow(idx, { description: e.target.value })}
            placeholder="Description"
            disabled={disabled}
            className={cn("col-span-2 sm:col-span-1", INPUT_CLS)}
            aria-label={`Line ${idx + 1} description`}
          />
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
          <span className="px-1 text-right text-sm font-semibold whitespace-nowrap text-admin-text">
            {formatNZD(item.lineTotal)}
          </span>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            disabled={disabled}
            aria-label={`Remove line ${idx + 1}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-admin-faint hover:bg-admin-bg hover:text-coquelicot-600 disabled:opacity-50"
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
