"use client";
// src/features/admin/components/settings/HoldsTab.tsx
/**
 * @description Editor for the booking form & holds group. Currently just the
 * slot-hold expiry; the job-notes length limits stay structural code consts.
 */

import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
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
      <div className="divide-y divide-admin-border">
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

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void form.save()}
        onReset={form.resetToDefault}
      />

      <SettingsHistory group="holds" onRestore={(v: HoldsSettings) => setDraft(v)} />
    </div>
  );
}
