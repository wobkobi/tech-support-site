"use client";
// src/features/admin/components/settings/BenchmarkListField.tsx
/**
 * @description Repeatable-row editor for the estimator's task-duration
 * benchmarks. Each row is a label + a minutes input with a remove button, plus
 * an "Add benchmark" button. Row-level validation errors are keyed
 * `benchmarks.<index>.label` / `benchmarks.<index>.mins` to match the validator.
 */

import { cn } from "@/shared/lib/cn";
import { ESTIMATOR_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { Benchmark } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  benchmarks: Benchmark[];
  /** Field path -> message, e.g. "benchmarks.2.mins". */
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

  /**
   * Input class string, reddened when the field has a validation error.
   * @param err - The field's error message, if any.
   * @returns The composed className.
   */
  const inputClass = (err?: string): string =>
    cn(
      "focus:ring-russian-violet/30 rounded-lg border px-3 py-2.5 text-base focus:outline-none focus:ring-2",
      err ? "border-red-400" : "border-slate-300",
    );

  return (
    <div className="py-4">
      <p className="text-sm font-semibold text-russian-violet">{meta.title}</p>
      <p className="mt-0.5 text-sm text-slate-500">{meta.description}</p>

      {fieldErrors.benchmarks && (
        <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.benchmarks}</p>
      )}

      <div className="mt-3 space-y-2">
        {benchmarks.map((b, i) => {
          const labelErr = fieldErrors[`benchmarks.${i}.label`];
          const minsErr = fieldErrors[`benchmarks.${i}.mins`];
          return (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Benchmark ${i + 1} task`}
                  type="text"
                  value={b.label}
                  placeholder="Task name"
                  onChange={(e) => update(i, { label: e.target.value })}
                  className={cn(inputClass(labelErr), "flex-1")}
                />
                <input
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
                  className={cn(inputClass(minsErr), "w-24")}
                />
                <span className="text-sm text-slate-500">{meta.unit}</span>
                <button
                  type="button"
                  aria-label={`Remove ${b.label || "benchmark"}`}
                  onClick={() => remove(i)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              {(labelErr || minsErr) && (
                <p className="mt-1 text-xs font-medium text-red-600">{labelErr ?? minsErr}</p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        + Add benchmark
      </button>
    </div>
  );
}
