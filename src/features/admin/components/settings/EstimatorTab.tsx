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
import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { ESTIMATOR_FIELD_META } from "@/shared/lib/settings/field-meta";
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
  const m = ESTIMATOR_FIELD_META;

  /**
   * Updates one confidence band's low/high multiplier (stored as a fraction).
   * @param level - Confidence level being edited.
   * @param key - Which end of the band to set.
   * @param value - New multiplier as a fraction (e.g. 0.85).
   * @returns void
   */
  const setBand = (
    level: "high" | "medium" | "low",
    key: "lowFactor" | "highFactor",
    value: number,
  ): void =>
    setDraft((p) => ({
      ...p,
      range: { ...p.range, [level]: { ...p.range[level], [key]: value } },
    }));

  return (
    <div>
      <BenchmarkListField
        benchmarks={draft.benchmarks}
        fieldErrors={fieldErrors}
        onChange={(benchmarks) => setDraft((p) => ({ ...p, benchmarks }))}
      />

      {/* Price range width - the confidence-scaled band the public estimator shows. */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-russian-violet">Estimate range width</h3>
        <p className="mt-1 text-sm text-slate-500">
          How wide the customer-facing price range is, set by how clearly the job was described.
          Percentages are of the estimate; vaguer jobs get a wider, lower range so they read
          &ldquo;from $X&rdquo; without a scary top number.
        </p>
        <div className="divide-y divide-slate-100">
          <NumberField
            id="range.high.lowFactor"
            meta={m["range.high.lowFactor"]}
            value={Math.round(draft.range.high.lowFactor * 100)}
            min={0}
            step={1}
            customised={draft.range.high.lowFactor !== defaults.range.high.lowFactor}
            onChange={(v) => setBand("high", "lowFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.high.highFactor"
            meta={m["range.high.highFactor"]}
            value={Math.round(draft.range.high.highFactor * 100)}
            min={0}
            step={1}
            error={fieldErrors["range.high"]}
            customised={draft.range.high.highFactor !== defaults.range.high.highFactor}
            onChange={(v) => setBand("high", "highFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.medium.lowFactor"
            meta={m["range.medium.lowFactor"]}
            value={Math.round(draft.range.medium.lowFactor * 100)}
            min={0}
            step={1}
            customised={draft.range.medium.lowFactor !== defaults.range.medium.lowFactor}
            onChange={(v) => setBand("medium", "lowFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.medium.highFactor"
            meta={m["range.medium.highFactor"]}
            value={Math.round(draft.range.medium.highFactor * 100)}
            min={0}
            step={1}
            error={fieldErrors["range.medium"]}
            customised={draft.range.medium.highFactor !== defaults.range.medium.highFactor}
            onChange={(v) => setBand("medium", "highFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.low.lowFactor"
            meta={m["range.low.lowFactor"]}
            value={Math.round(draft.range.low.lowFactor * 100)}
            min={0}
            step={1}
            customised={draft.range.low.lowFactor !== defaults.range.low.lowFactor}
            onChange={(v) => setBand("low", "lowFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.low.highFactor"
            meta={m["range.low.highFactor"]}
            value={Math.round(draft.range.low.highFactor * 100)}
            min={0}
            step={1}
            error={fieldErrors["range.low"]}
            customised={draft.range.low.highFactor !== defaults.range.low.highFactor}
            onChange={(v) => setBand("low", "highFactor", (v ?? 0) / 100)}
          />
          <NumberField
            id="range.minSpread"
            meta={m["range.minSpread"]}
            value={draft.range.minSpread}
            min={0}
            error={fieldErrors["range.minSpread"]}
            customised={draft.range.minSpread !== defaults.range.minSpread}
            onChange={(v) => setDraft((p) => ({ ...p, range: { ...p.range, minSpread: v ?? 0 } }))}
          />
        </div>
      </div>

      {/* Guardrail blocks - save was refused. */}
      {blocks.length > 0 && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Can&apos;t save yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700">
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Guardrail warnings - allowed, but confirm. */}
      {warns.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Heads up:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void form.save(true)}
            disabled={saving}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save anyway
          </button>
        </div>
      )}

      {/* Save bar */}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void form.save()}
          disabled={!dirty || saving}
          className="rounded-lg bg-russian-violet px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={form.resetToDefault}
          disabled={saving}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Reset to defaults
        </button>
        {dirty && !saving && <span className="text-sm text-slate-400">Unsaved changes</span>}
        {!dirty && savedAt && <span className="text-sm font-medium text-emerald-600">Saved</span>}
      </div>

      <SettingsHistory group="estimator" onRestore={(v: EstimatorSettings) => setDraft(v)} />
    </div>
  );
}
