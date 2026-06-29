"use client";
// src/features/admin/components/settings/TaxTab.tsx
/**
 * @description Editor for the tax-planner group: the income-tax / ACC /
 * KiwiSaver reserve rates (stored as fractions) and the weekly transfer
 * amounts. These feed the dashboard tax planner and the per-FY tax reserve;
 * a per-FY workbook rate, when present, still takes precedence over these.
 */

import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { TAX_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { TaxSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: TaxSettings;
  defaults: TaxSettings;
}

/**
 * Tax-planner settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current tax settings.
 * @param props.defaults - Code default tax settings.
 * @returns Tax tab element.
 */
export function TaxTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("tax", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
  const m = TAX_FIELD_META;

  /**
   * Merges a tax patch into the draft.
   * @param patch - Partial tax fields.
   * @returns void
   */
  const set = (patch: Partial<TaxSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Rates are entered as fractions (0.2 = 20%). If a per-FY workbook fills the matching rate
        cell, that value is used for that year and these act as the fallback.
      </p>
      <div className="divide-y divide-slate-100">
        <NumberField
          id="incomeTax"
          meta={m.incomeTax}
          value={draft.incomeTax}
          min={0}
          max={1}
          error={fieldErrors.incomeTax}
          customised={draft.incomeTax !== defaults.incomeTax}
          onChange={(v) => set({ incomeTax: v ?? 0 })}
        />
        <NumberField
          id="acc"
          meta={m.acc}
          value={draft.acc}
          min={0}
          max={1}
          error={fieldErrors.acc}
          customised={draft.acc !== defaults.acc}
          onChange={(v) => set({ acc: v ?? 0 })}
        />
        <NumberField
          id="kiwiSaver"
          meta={m.kiwiSaver}
          value={draft.kiwiSaver}
          min={0}
          max={1}
          error={fieldErrors.kiwiSaver}
          customised={draft.kiwiSaver !== defaults.kiwiSaver}
          onChange={(v) => set({ kiwiSaver: v ?? 0 })}
        />
        <NumberField
          id="weeklyKiwiSaver"
          meta={m.weeklyKiwiSaver}
          value={draft.weeklyKiwiSaver}
          min={0}
          error={fieldErrors.weeklyKiwiSaver}
          customised={draft.weeklyKiwiSaver !== defaults.weeklyKiwiSaver}
          onChange={(v) => set({ weeklyKiwiSaver: v ?? 0 })}
        />
        <NumberField
          id="weeklyTax"
          meta={m.weeklyTax}
          value={draft.weeklyTax}
          min={0}
          error={fieldErrors.weeklyTax}
          customised={draft.weeklyTax !== defaults.weeklyTax}
          onChange={(v) => set({ weeklyTax: v ?? 0 })}
        />
      </div>

      {/* Guardrail blocks */}
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

      <SettingsHistory group="tax" onRestore={(v: TaxSettings) => setDraft(v)} />
    </div>
  );
}
