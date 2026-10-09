// src/features/business/components/tax/WorkingRow.tsx
// One label-and-amount line in the Tax page's breakdowns, with an optional note under the
// label. Renders an <li>, so callers wrap rows in a <ul>. Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** How a row reads: a normal line, an informational line outside the total, or a total. */
export type WorkingRowTone = "default" | "muted" | "total";

/** Props for {@link WorkingRow}. */
interface WorkingRowProps {
  /** Left-hand label. */
  label: React.ReactNode;
  /** Pre-formatted amount. */
  value: string;
  /** Optional explanation under the label. */
  note?: React.ReactNode;
  /** Row style; defaults to "default". */
  tone?: WorkingRowTone;
}

/**
 * Text colour for a row's label and amount.
 * @param tone - Row tone.
 * @returns Class string.
 */
function toneTextClass(tone: WorkingRowTone): string {
  switch (tone) {
    case "default":
      return "text-admin-text";
    case "muted":
      return "text-admin-muted";
    case "total":
      return "font-bold text-russian-violet";
  }
}

/**
 * Renders one breakdown line.
 * @param props - Component props.
 * @param props.label - Left-hand label.
 * @param props.value - Pre-formatted amount.
 * @param props.note - Optional explanation under the label.
 * @param props.tone - Row style.
 * @returns The list item.
 */
export function WorkingRow({
  label,
  value,
  note,
  tone = "default",
}: WorkingRowProps): React.ReactElement {
  const text = toneTextClass(tone);
  return (
    <li className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={cn("text-[0.9375rem]", text)}>{label}</p>
        {note && <p className="mt-0.5 text-sm text-admin-muted">{note}</p>}
      </div>
      <p className={cn("shrink-0 font-mono text-[0.9375rem]", text)}>{value}</p>
    </li>
  );
}
