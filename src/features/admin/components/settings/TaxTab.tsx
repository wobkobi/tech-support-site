"use client";
// src/features/admin/components/settings/TaxTab.tsx
/**
 * @description Editor for the tax-planner group: the income-tax / ACC /
 * KiwiSaver reserve rates (stored as fractions). These feed the dashboard tax
 * planner and the per-FY tax reserve; a per-FY workbook rate, when present,
 * still takes precedence over these.
 */

import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
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
      <p className="mb-4 text-sm text-admin-muted">
        Enter each rate as a percentage. If a per-FY workbook fills the matching rate cell, that
        value is used for that year and these act as the fallback.
      </p>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="incomeTax"
          meta={m.incomeTax}
          // Stored as a fraction; shown + edited as a percent (2dp, so ACC's 1.46% survives).
          value={Math.round(draft.incomeTax * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors.incomeTax}
          customised={draft.incomeTax !== defaults.incomeTax}
          onChange={(v) => set({ incomeTax: (v ?? 0) / 100 })}
        />
        <NumberField
          id="acc"
          meta={m.acc}
          value={Math.round(draft.acc * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors.acc}
          customised={draft.acc !== defaults.acc}
          onChange={(v) => set({ acc: (v ?? 0) / 100 })}
        />
        <NumberField
          id="kiwiSaver"
          meta={m.kiwiSaver}
          value={Math.round(draft.kiwiSaver * 10000) / 100}
          min={0}
          max={100}
          error={fieldErrors.kiwiSaver}
          customised={draft.kiwiSaver !== defaults.kiwiSaver}
          onChange={(v) => set({ kiwiSaver: (v ?? 0) / 100 })}
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

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void form.save()}
        onReset={form.resetToDefault}
      />

      <SettingsHistory group="tax" onRestore={(v: TaxSettings) => setDraft(v)} />
    </div>
  );
}
