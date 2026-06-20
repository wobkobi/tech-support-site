"use client";
// src/features/admin/components/settings/HoldsTab.tsx
/**
 * @file HoldsTab.tsx
 * @description Editor for the booking form & holds group. Currently just the
 * slot-hold expiry; the job-notes length limits stay structural code consts.
 */

import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { HOLDS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { HoldsSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: HoldsSettings;
  defaults: HoldsSettings;
}

/**
 * Booking form & holds settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current holds settings.
 * @param props.defaults - Code default holds settings.
 * @returns Holds tab element.
 */
export function HoldsTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("holds", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
  const m = HOLDS_FIELD_META;

  return (
    <div>
      <div className="divide-y divide-slate-100">
        <NumberField
          id="holdExpirationMinutes"
          meta={m.holdExpirationMinutes}
          value={draft.holdExpirationMinutes}
          min={1}
          error={fieldErrors.holdExpirationMinutes}
          customised={draft.holdExpirationMinutes !== defaults.holdExpirationMinutes}
          onChange={(v) => setDraft((p) => ({ ...p, holdExpirationMinutes: v ?? 1 }))}
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

      <SettingsHistory group="holds" onRestore={(v: HoldsSettings) => setDraft(v)} />
    </div>
  );
}
