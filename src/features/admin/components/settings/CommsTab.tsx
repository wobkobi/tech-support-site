"use client";
// src/features/admin/components/settings/CommsTab.tsx
// Editor for the comms & automation group: which emails and pushes send, and their timings.
// Review requests aren't here: they go out with the invoice email.

import {
  HourField,
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { cn } from "@/shared/lib/cn";
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
   * Applies an email-toggle change, then confirms if it just turned the LAST customer email
   * off. Cancel restores both emails to their saved state.
   * @param patch - The single email-toggle change.
   */
  const setNotify = (patch: Partial<CommsSettings>): void => {
    const next = { ...draft, ...patch };
    set(patch);
    if (!next.notifyConfirmation && !next.notifyReminder) {
      setConfirmAllOff(true);
    }
  };

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <h3 className={ADMIN_EYEBROW_CLS}>Which emails send</h3>
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
      </div>

      {/* Operator-facing, so plain `set`: turning every push off is legitimate. Devices
          are enrolled on /admin/notifications - these only gate what gets sent. */}
      <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Which push notifications you get</h3>
      <div className="mt-2 divide-y divide-admin-border">
        <ToggleField
          id="pushOnBooking"
          meta={m.pushOnBooking}
          value={draft.pushOnBooking}
          customised={draft.pushOnBooking !== defaults.pushOnBooking}
          onChange={(v) => set({ pushOnBooking: v })}
        />
        <ToggleField
          id="pushOnCancellation"
          meta={m.pushOnCancellation}
          value={draft.pushOnCancellation}
          customised={draft.pushOnCancellation !== defaults.pushOnCancellation}
          onChange={(v) => set({ pushOnCancellation: v })}
        />
        <ToggleField
          id="pushOnReview"
          meta={m.pushOnReview}
          value={draft.pushOnReview}
          customised={draft.pushOnReview !== defaults.pushOnReview}
          onChange={(v) => set({ pushOnReview: v })}
        />
      </div>

      <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Timings</h3>
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
          id="priceEstimateRetentionDays"
          meta={m.priceEstimateRetentionDays}
          value={draft.priceEstimateRetentionDays}
          min={1}
          error={fieldErrors.priceEstimateRetentionDays}
          customised={draft.priceEstimateRetentionDays !== defaults.priceEstimateRetentionDays}
          onChange={(v) => set({ priceEstimateRetentionDays: v ?? 1 })}
        />
      </div>

      <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Quiet hours</h3>
      <div className="mt-2 divide-y divide-admin-border">
        <ToggleField
          id="quietHoursEnabled"
          meta={m.quietHoursEnabled}
          value={draft.quietHoursEnabled}
          customised={draft.quietHoursEnabled !== defaults.quietHoursEnabled}
          onChange={(v) => set({ quietHoursEnabled: v })}
        />
        <HourField
          id="quietHoursStart"
          meta={m.quietHoursStart}
          value={draft.quietHoursStart}
          from={0}
          to={23}
          error={fieldErrors.quietHoursStart}
          customised={draft.quietHoursStart !== defaults.quietHoursStart}
          onChange={(h) => set({ quietHoursStart: h ?? defaults.quietHoursStart })}
        />
        <HourField
          id="quietHoursEnd"
          meta={m.quietHoursEnd}
          value={draft.quietHoursEnd}
          from={0}
          to={23}
          error={fieldErrors.quietHoursEnd}
          customised={draft.quietHoursEnd !== defaults.quietHoursEnd}
          onChange={(h) => set({ quietHoursEnd: h ?? defaults.quietHoursEnd })}
        />
      </div>

      <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Overdue invoice reminders</h3>
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
        <ToggleField
          id="invoiceApologyEnabled"
          meta={m.invoiceApologyEnabled}
          value={draft.invoiceApologyEnabled}
          customised={draft.invoiceApologyEnabled !== defaults.invoiceApologyEnabled}
          onChange={(v) => set({ invoiceApologyEnabled: v })}
        />
      </div>

      <SettingsFooter form={form} />

      <SettingsHistory
        key={form.savedAt ?? 0}
        group="comms"
        onRestore={(v: CommsSettings) => setDraft(v)}
      />

      <ConfirmDialog
        open={confirmAllOff}
        title="Turn off all customer emails?"
        body="Customers won't get booking confirmations or reminders."
        confirmLabel="Turn all off"
        cancelLabel="Keep emails on"
        tone="danger"
        onConfirm={() => setConfirmAllOff(false)}
        onCancel={() => {
          // Restore to the last-SAVED baseline so a mid-session save of one as off is kept.
          setConfirmAllOff(false);
          set({
            notifyConfirmation: baseline.notifyConfirmation,
            notifyReminder: baseline.notifyReminder,
          });
        }}
      />
    </SettingsTabBody>
  );
}
