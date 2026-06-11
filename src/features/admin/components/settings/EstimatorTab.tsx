"use client";
// src/features/admin/components/settings/EstimatorTab.tsx
/**
 * @file EstimatorTab.tsx
 * @description Editor for the price-estimator group - the task-duration benchmark
 * list the public estimator uses. Tracks dirty state via {@link useSettingsForm} and
 * saves to the admin settings route, surfacing inline row errors, guardrail
 * blocks, and warnings (with a "save anyway" confirm).
 */

import { BenchmarkListField } from "@/features/admin/components/settings/BenchmarkListField";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { cn } from "@/shared/lib/cn";
import type { EstimatorSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: EstimatorSettings;
  defaults: EstimatorSettings;
}

/**
 * Price-estimator settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current estimator settings.
 * @param props.defaults - Code default estimator settings (for reset).
 * @returns Estimator tab element.
 */
export function EstimatorTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("estimator", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, warns, savedAt } = form;

  return (
    <div>
      <BenchmarkListField
        benchmarks={draft.benchmarks}
        fieldErrors={fieldErrors}
        onChange={(benchmarks) => setDraft((p) => ({ ...p, benchmarks }))}
      />

      {/* Guardrail blocks - save was refused. */}
      {blocks.length > 0 && (
        <div className={cn("mt-6 rounded-lg border border-red-200 bg-red-50 p-4")}>
          <p className={cn("text-sm font-semibold text-red-700")}>Can&apos;t save yet:</p>
          <ul className={cn("mt-1 list-disc space-y-1 pl-5 text-sm text-red-700")}>
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Guardrail warnings - allowed, but confirm. */}
      {warns.length > 0 && (
        <div className={cn("mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4")}>
          <p className={cn("text-sm font-semibold text-amber-800")}>Heads up:</p>
          <ul className={cn("mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800")}>
            {warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void form.save(true)}
            disabled={saving}
            className={cn(
              "mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
            )}
          >
            Save anyway
          </button>
        </div>
      )}

      {/* Save bar */}
      <div className={cn("mt-6 flex items-center gap-3")}>
        <button
          type="button"
          onClick={() => void form.save()}
          disabled={!dirty || saving}
          className={cn(
            "bg-russian-violet rounded-lg px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={form.resetToDefault}
          disabled={saving}
          className={cn(
            "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
          )}
        >
          Reset to defaults
        </button>
        {dirty && !saving && <span className={cn("text-sm text-slate-400")}>Unsaved changes</span>}
        {!dirty && savedAt && (
          <span className={cn("text-sm font-medium text-emerald-600")}>Saved</span>
        )}
      </div>

      <SettingsHistory group="estimator" onRestore={(v: EstimatorSettings) => setDraft(v)} />
    </div>
  );
}
