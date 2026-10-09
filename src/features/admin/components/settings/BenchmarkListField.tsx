"use client";
// src/features/admin/components/settings/BenchmarkListField.tsx
// Repeatable-row editor for the estimator's task-duration benchmarks. Each row is a label
// + a minutes input with a remove button, plus an "Add benchmark" button. Row-level
// validation errors are keyed `benchmarks.<index>.label` / `benchmarks.<index>.mins` to
// match the validator.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { COMPACT_BUTTON_CLS } from "@/features/business/components/calculator/calculator-classes";
import { cn } from "@/shared/lib/cn";
import { ESTIMATOR_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { Benchmark } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  benchmarks: Benchmark[];
  /** Field path > message, e.g. "benchmarks.2.mins". */
  fieldErrors: Record<string, string>;
  onChange: (next: Benchmark[]) => void;
}

/**
 * Editable list of { label, mins } benchmark rows.
 * @param props - Component props.
 * @param props.benchmarks - Current benchmark rows.
 * @param props.fieldErrors - Inline validation errors keyed by field path.
 * @param props.onChange - Called with the next benchmark list on any edit.
 * @returns Benchmark list editor element.
 */
export function BenchmarkListField({
  benchmarks,
  fieldErrors,
  onChange,
}: Props): React.ReactElement {
  const meta = ESTIMATOR_FIELD_META.benchmarks;

  /**
   * Patches one benchmark row by index.
   * @param i - Row index to update.
   * @param patch - Partial fields to merge into that row.
   */
  const update = (i: number, patch: Partial<Benchmark>): void => {
    onChange(benchmarks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  /**
   * Removes the benchmark row at the given index.
   * @param i - Row index to remove.
   */
  const remove = (i: number): void => {
    onChange(benchmarks.filter((_, idx) => idx !== i));
  };
  /** Appends a fresh empty benchmark row seeded at 30 minutes. */
  const add = (): void => {
    onChange([...benchmarks, { label: "", mins: 30 }]);
  };

  return (
    <div className="py-3">
      <p className="text-sm font-semibold text-russian-violet">{meta.title}</p>
      <p className="mt-0.5 text-sm text-admin-muted">{meta.description}</p>

      {fieldErrors.benchmarks && (
        <p className="mt-1 text-sm font-medium text-red-600">{fieldErrors.benchmarks}</p>
      )}

      <div className="mt-3 space-y-2">
        {benchmarks.map((b, i) => {
          const labelErr = fieldErrors[`benchmarks.${i}.label`];
          const minsErr = fieldErrors[`benchmarks.${i}.mins`];
          return (
            <div key={i}>
              <div className="flex items-center gap-2">
                <AdminInput
                  aria-label={`Benchmark ${i + 1} task`}
                  type="text"
                  value={b.label}
                  placeholder="Task name"
                  onChange={(e) => update(i, { label: e.target.value })}
                  aria-invalid={labelErr ? true : undefined}
                  className={cn(
                    "w-auto min-w-0 flex-1",
                    labelErr && "border-coquelicot-600 focus:border-coquelicot-600",
                  )}
                />
                <AdminInput
                  aria-label={`Benchmark ${i + 1} minutes`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={b.mins}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) update(i, { mins: n });
                  }}
                  aria-invalid={minsErr ? true : undefined}
                  className={cn(
                    "w-24",
                    minsErr && "border-coquelicot-600 focus:border-coquelicot-600",
                  )}
                />
                <span className="text-sm text-admin-muted">{meta.unit}</span>
                <AdminButton
                  variant="danger"
                  aria-label={`Remove ${b.label || "benchmark"}`}
                  className={cn("shrink-0", COMPACT_BUTTON_CLS)}
                  onClick={() => remove(i)}
                >
                  Remove
                </AdminButton>
              </div>
              {(labelErr || minsErr) && (
                <p className="mt-1 text-sm font-medium text-red-600">{labelErr ?? minsErr}</p>
              )}
            </div>
          );
        })}
      </div>

      <AdminButton variant="secondary" className="mt-3" onClick={add}>
        + Add benchmark
      </AdminButton>
    </div>
  );
}
