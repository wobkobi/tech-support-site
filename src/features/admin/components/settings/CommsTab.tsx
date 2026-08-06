"use client";
// src/features/admin/components/settings/CommsTab.tsx
/**
 * @description Editor for the comms & automation group: which emails send
 * (confirmation, reminder, review request) and their timings. Saves through
 * the shared settings form hook.
 */

import {
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { COMMS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { CommsSettings } from "@/shared/lib/settings/types";
import type React from "react";
import { useState } from "react";

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
  const { draft, setDraft, baseline, fieldErrors } = form;
  const m = COMMS_FIELD_META;
  const [confirmAllOff, setConfirmAllOff] = useState(false);

  /**
   * Merges a comms patch into the draft.
   * @param patch - Partial comms fields.
   * @returns void
   */
  const set = (patch: Partial<CommsSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  /**
   * Applies an email-toggle change, then confirms if it has just turned the LAST
   * remaining customer email off. The switch flips right away so the dialog
   * reflects what was done; Cancel restores all three emails to their saved
   * state (see the dialog's onCancel).
   * @param patch - The single email-toggle change.
   */
  const setNotify = (patch: Partial<CommsSettings>): void => {
    const next = { ...draft, ...patch };
    set(patch);
    if (!next.notifyConfirmation && !next.notifyReminder && !next.notifyReviewRequest) {
      setConfirmAllOff(true);
    }
  };

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <h3 className="text-xs font-bold tracking-wide text-russian-violet uppercase">
        Which emails send
      </h3>
      <div className="mt-2 divide-y divide-admin-border">
        <ToggleField
          id="notifyConfirmation"
          meta={m.notifyConfirmation}
          value={draft.notifyConfirmation}
          customised={draft.notifyConfirmation !== defaults.notifyConfirmation}
          onChange={(v) => setNotify({ notifyConfirmation: v })}
        />
        <ToggleField
          id="notifyReminder"
          meta={m.notifyReminder}
          value={draft.notifyReminder}
          customised={draft.notifyReminder !== defaults.notifyReminder}
          onChange={(v) => setNotify({ notifyReminder: v })}
        />
        <ToggleField
          id="notifyReviewRequest"
          meta={m.notifyReviewRequest}
          value={draft.notifyReviewRequest}
          customised={draft.notifyReviewRequest !== defaults.notifyReviewRequest}
          onChange={(v) => setNotify({ notifyReviewRequest: v })}
        />
      </div>

      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Timings
      </h3>
      <div className="mt-2 divide-y divide-admin-border">
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
          minutesHint
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

      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Overdue invoice reminders
      </h3>
      <div className="mt-2 divide-y divide-admin-border">
        <ToggleField
          id="invoiceRemindersEnabled"
          meta={m.invoiceRemindersEnabled}
          value={draft.invoiceRemindersEnabled}
          customised={draft.invoiceRemindersEnabled !== defaults.invoiceRemindersEnabled}
          onChange={(v) => set({ invoiceRemindersEnabled: v })}
        />
        <NumberField
          id="invoiceReminderFirstDays"
          meta={m.invoiceReminderFirstDays}
          value={draft.invoiceReminderFirstDays}
          min={1}
          error={fieldErrors.invoiceReminderFirstDays}
          customised={draft.invoiceReminderFirstDays !== defaults.invoiceReminderFirstDays}
          onChange={(v) => set({ invoiceReminderFirstDays: v ?? 1 })}
        />
        <NumberField
          id="invoiceReminderSecondDays"
          meta={m.invoiceReminderSecondDays}
          value={draft.invoiceReminderSecondDays}
          min={1}
          error={fieldErrors.invoiceReminderSecondDays}
          customised={draft.invoiceReminderSecondDays !== defaults.invoiceReminderSecondDays}
          onChange={(v) => set({ invoiceReminderSecondDays: v ?? 1 })}
        />
        <NumberField
          id="invoiceReminderMaxCount"
          meta={m.invoiceReminderMaxCount}
          value={draft.invoiceReminderMaxCount}
          min={0}
          max={10}
          error={fieldErrors.invoiceReminderMaxCount}
          customised={draft.invoiceReminderMaxCount !== defaults.invoiceReminderMaxCount}
          onChange={(v) => set({ invoiceReminderMaxCount: v ?? 0 })}
        />
      </div>

      <SettingsFooter form={form} />

      <SettingsHistory group="comms" onRestore={(v: CommsSettings) => setDraft(v)} />

      <ConfirmDialog
        open={confirmAllOff}
        title="Turn off all customer emails?"
        body="Customers won't get booking confirmations, reminders, or review requests."
        confirmLabel="Turn all off"
        cancelLabel="Keep emails on"
        tone="danger"
        onConfirm={() => setConfirmAllOff(false)}
        onCancel={() => {
          // Restore all three email switches to their last-SAVED state (baseline,
          // not the page-load value), so a mid-session save of one as off is kept.
          setConfirmAllOff(false);
          set({
            notifyConfirmation: baseline.notifyConfirmation,
            notifyReminder: baseline.notifyReminder,
            notifyReviewRequest: baseline.notifyReviewRequest,
          });
        }}
      />
    </SettingsTabBody>
  );
}
