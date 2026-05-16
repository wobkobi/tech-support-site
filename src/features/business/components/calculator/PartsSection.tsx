"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";
import type { PartLine } from "@/features/business/types/business";

interface Props {
  parts: PartLine[];
  onPartsChange: (updater: (prev: PartLine[]) => PartLine[]) => void;
  show: boolean;
  onToggle: () => void;
}

/**
 * Collapsible "Parts / materials" card on the calculator. Each row pairs a
 * description text input with a numeric cost input and a remove button; an
 * "Add part" link appends an empty row. Empty list + collapsed state is the
 * default - parts are an opt-in for jobs that need them.
 * @param props - Component props.
 * @param props.parts - Current parts array.
 * @param props.onPartsChange - Functional setter that takes the previous parts list and returns the next.
 * @param props.show - Whether the body is expanded.
 * @param props.onToggle - Click handler for the collapse/expand chevron.
 * @returns Parts section element.
 */
export function PartsSection({ parts, onPartsChange, show, onToggle }: Props): React.ReactElement {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <button
        onClick={onToggle}
        className={cn(
          "text-russian-violet flex w-full items-center justify-between text-left text-sm font-semibold",
        )}
      >
        Parts / materials
        <span className={cn("text-xs text-slate-400")}>{show ? "▲" : "▼"}</span>
      </button>
      {show && (
        <div className={cn("mt-3 space-y-2")}>
          {parts.map((part, idx) => (
            <div
              key={idx}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2",
                "sm:grid-cols-[minmax(0,1fr)_88px_28px]",
              )}
            >
              <input
                type="text"
                placeholder="Description"
                value={part.description}
                onChange={(e) =>
                  onPartsChange((p) => {
                    const n = [...p];
                    n[idx] = { ...n[idx], description: e.target.value };
                    return n;
                  })
                }
                className={cn(
                  "focus:ring-russian-violet/30 col-span-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:col-span-1 sm:py-2 sm:text-xs",
                )}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Cost"
                value={part.cost}
                onChange={(e) =>
                  onPartsChange((p) => {
                    const n = [...p];
                    n[idx] = { ...n[idx], cost: parseFloat(e.target.value) || 0 };
                    return n;
                  })
                }
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
                )}
              />
              <button
                onClick={() => onPartsChange((p) => p.filter((_, i) => i !== idx))}
                aria-label="Remove part"
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-red-50 hover:text-red-500 sm:h-auto sm:w-auto sm:rounded-none sm:text-lg sm:hover:bg-transparent",
                )}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => onPartsChange((p) => [...p, { description: "", cost: 0 }])}
            className={cn(
              "hover:text-russian-violet inline-flex h-11 items-center text-sm text-slate-500 underline sm:h-auto sm:text-xs",
            )}
          >
            + Add part
          </button>
        </div>
      )}
    </div>
  );
}
