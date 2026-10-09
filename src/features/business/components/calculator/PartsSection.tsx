"use client";
// src/features/business/components/calculator/PartsSection.tsx
// Collapsible "Parts / materials" card. Each row is a description + cost; cost pastes
// carrying "$"/commas route through parseMoney. Collapsed with an empty list is the
// default - parts are opt-in per job.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card } from "@/features/admin/components/ui/Card";
import { SectionClearButton } from "@/features/business/components/calculator/SectionClearButton";
import {
  REMOVE_ROW_CLS,
  TEXT_ACTION_CLS,
} from "@/features/business/components/calculator/calculator-classes";
import type { PartLine } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { parseMoney } from "@/shared/lib/parse-money";
import type React from "react";

interface Props {
  parts: PartLine[];
  onPartsChange: (updater: (prev: PartLine[]) => PartLine[]) => void;
  show: boolean;
  onToggle: () => void;
}

/**
 * Collapsible "Parts / materials" card on the calculator. Empty list +
 * collapsed state is the default - parts are an opt-in for jobs that need them.
 * @param props - Component props.
 * @param props.parts - Current parts array.
 * @param props.onPartsChange - Functional setter that takes the previous parts list and returns the next.
 * @param props.show - Whether the body is expanded.
 * @param props.onToggle - Click handler for the collapse/expand chevron.
 * @returns Parts section element.
 */
export function PartsSection({ parts, onPartsChange, show, onToggle }: Props): React.ReactElement {
  return (
    <Card>
      {/* Clear sits beside the collapse toggle rather than inside it - a button
          cannot nest inside another button. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={show}
          className="flex flex-1 items-center justify-between text-left text-lg font-extrabold text-admin-text"
        >
          Parts / materials
          <span className="text-sm text-admin-muted">{show ? "▲" : "▼"}</span>
        </button>
        {parts.length > 0 && (
          <SectionClearButton onClear={() => onPartsChange(() => [])} label="parts" />
        )}
      </div>
      {show && (
        <div className="mt-3 space-y-2">
          {parts.map((part, idx) => (
            <div
              key={idx}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2",
                "sm:grid-cols-[minmax(0,1fr)_96px_44px]",
              )}
            >
              <AdminInput
                type="text"
                placeholder="Description"
                value={part.description}
                onChange={(e) =>
                  onPartsChange((p) => {
                    const n = [...p];
                    n[idx] = { ...n[idx]!, description: e.target.value };
                    return n;
                  })
                }
                className="col-span-2 sm:col-span-1"
              />
              <AdminInput
                type="number"
                min="0"
                step="0.01"
                placeholder="Cost"
                value={part.cost || ""}
                onPaste={(e) => {
                  // Only intercept when the clipboard carries a "$", commas, or
                  // other junk; plain numeric pastes fall through to the native
                  // number input so decimal entry stays unaffected.
                  const text = e.clipboardData.getData("text");
                  if (!/[^\d.]/.test(text)) return;
                  const value = parseMoney(text);
                  if (value === null) return;
                  e.preventDefault();
                  onPartsChange((p) => {
                    const n = [...p];
                    n[idx] = { ...n[idx]!, cost: value };
                    return n;
                  });
                }}
                onChange={(e) =>
                  onPartsChange((p) => {
                    const n = [...p];
                    n[idx] = { ...n[idx]!, cost: parseFloat(e.target.value) || 0 };
                    return n;
                  })
                }
              />
              <button
                type="button"
                onClick={() => onPartsChange((p) => p.filter((_, i) => i !== idx))}
                aria-label="Remove part"
                className={REMOVE_ROW_CLS}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onPartsChange((p) => [...p, { description: "", cost: 0 }])}
            className={cn(TEXT_ACTION_CLS, "inline-flex h-11 items-center sm:h-auto")}
          >
            + Add part
          </button>
        </div>
      )}
    </Card>
  );
}
