"use client";
// src/features/admin/components/settings/CommsTab.tsx
/**
 * @file CommsTab.tsx
 * @description Editor for the comms & automation group: which emails send
 * (confirmation, reminder, review request) and the timings (reminder lead time,
 * review-request delay, estimate-log retention). Saves through the shared
 * settings form hook.
 */

import { NumberField, ToggleField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { COMMS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { CommsSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: CommsSettings;
  defaults: CommsSettings;
}

/**
 * Comms & automation settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current comms settings.
 * @param props.defaults - Code default comms settings.
 * @returns Comms tab element.
 */
export function CommsTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("comms", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
  const m = COMMS_FIELD_META;

  /**
   * Merges a comms patch into the draft.
   * @param patch - Partial comms fields.
   * @returns void
   */
  const set = (patch: Partial<CommsSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <div>
      <div className="divide-y divide-slate-100">
        <ToggleField
          id="notifyConfirmation"
          meta={m.notifyConfirmation}
          value={draft.notifyConfirmation}
          customised={draft.notifyConfirmation !== defaults.notifyConfirmation}
          onChange={(v) => set({ notifyConfirmation: v })}
        />
        <ToggleField
          id="notifyReminder"
          meta={m.notifyReminder}
          value={draft.notifyReminder}
          customised={draft.notifyReminder !== defaults.notifyReminder}
          onChange={(v) => set({ notifyReminder: v })}
        />
        <ToggleField
          id="notifyReviewRequest"
          meta={m.notifyReviewRequest}
          value={draft.notifyReviewRequest}
          customised={draft.notifyReviewRequest !== defaults.notifyReviewRequest}
          onChange={(v) => set({ notifyReviewRequest: v })}
        />
        <NumberField
          id="reminderLeadHours"
          meta={m.reminderLeadHours}
          value={draft.reminderLeadHours}
          min={1}
          error={fieldErrors.reminderLeadHours}
          customised={draft.reminderLeadHours !== defaults.reminderLeadHours}
          onChange={(v) => set({ reminderLeadHours: v ?? 1 })}
        />
        <NumberField
          id="reviewEmailDelayMins"
          meta={m.reviewEmailDelayMins}
          value={draft.reviewEmailDelayMins}
          min={0}
          error={fieldErrors.reviewEmailDelayMins}
          customised={draft.reviewEmailDelayMins !== defaults.reviewEmailDelayMins}
          onChange={(v) => set({ reviewEmailDelayMins: v ?? 0 })}
        />
        <NumberField
          id="priceEstimateRetentionDays"
          meta={m.priceEstimateRetentionDays}
          value={draft.priceEstimateRetentionDays}
          min={1}
          error={fieldErrors.priceEstimateRetentionDays}
          customised={draft.priceEstimateRetentionDays !== defaults.priceEstimateRetentionDays}
          onChange={(v) => set({ priceEstimateRetentionDays: v ?? 1 })}
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
          onClick={() => {
            if (
              !draft.notifyConfirmation &&
              !draft.notifyReminder &&
              !draft.notifyReviewRequest &&
              !confirm(
                "Turn off all customer emails? Customers won't get booking confirmations, reminders, or review requests.",
              )
            )
              return;
            void form.save();
          }}
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

      <SettingsHistory group="comms" onRestore={(v: CommsSettings) => setDraft(v)} />
    </div>
  );
}
