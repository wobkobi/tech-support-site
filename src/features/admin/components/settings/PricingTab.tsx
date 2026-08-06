"use client";
// src/features/admin/components/settings/PricingTab.tsx
/**
 * @description Editor for the pricing & cancellation group. Renders each field
 * from {@link PRICING_FIELD_META}, tracks dirty state via {@link useSettingsForm}, and saves
 * to the admin settings route - surfacing inline field errors, guardrail blocks,
 * and warnings (with a "save anyway" confirm).
 */

import { PricingPreview } from "@/features/admin/components/settings/PricingPreview";
import {
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { PRICING_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { PricingSettings } from "@/shared/lib/settings/types";
import type React from "react";
import { useState } from "react";

interface Props {
  initial: PricingSettings;
  defaults: PricingSettings;
}

/**
 * Pricing & cancellation settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current pricing settings.
 * @param props.defaults - Code default pricing settings (for reset + markers).
 * @returns Pricing tab element.
 */
export function PricingTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("pricing", initial, defaults);
  const { draft, setDraft, baseline, fieldErrors } = form;
  const m = PRICING_FIELD_META;
  const [confirmGst, setConfirmGst] = useState(false);

  /**
   * Updates a top-level pricing field.
   * @param patch - Partial pricing fields to merge into the draft.
   * @returns void
   */
  const setTop = (patch: Partial<PricingSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  /**
   * Flips GST registration, then confirms if it has just been turned on (and
   * wasn't on at load). The switch moves right away so the dialog reflects the
   * change; Cancel restores it to its saved state.
   * @param v - The attempted GST-registered value.
   */
  const setGst = (v: boolean): void => {
    setTop({ gstRegistered: v });
    if (v && !baseline.gstRegistered) setConfirmGst(true);
  };

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <div className="divide-y divide-admin-border">
        <ToggleField
          id="gstRegistered"
          meta={m.gstRegistered}
          value={draft.gstRegistered}
          customised={draft.gstRegistered !== defaults.gstRegistered}
          onChange={setGst}
        />
        <NumberField
          id="minBillableMins"
          meta={m.minBillableMins}
          value={draft.minBillableMins}
          min={0}
          error={fieldErrors.minBillableMins}
          customised={draft.minBillableMins !== defaults.minBillableMins}
          onChange={(v) => setTop({ minBillableMins: v ?? 0 })}
        />
        <NumberField
          id="billingIncrementMins"
          meta={m.billingIncrementMins}
          value={draft.billingIncrementMins}
          min={1}
          max={60}
          error={fieldErrors.billingIncrementMins}
          customised={draft.billingIncrementMins !== defaults.billingIncrementMins}
          onChange={(v) => setTop({ billingIncrementMins: v ?? 1 })}
        />
        <NumberField
          id="shortTaskMins"
          meta={m.shortTaskMins}
          value={draft.shortTaskMins}
          min={1}
          max={240}
          error={fieldErrors.shortTaskMins}
          customised={draft.shortTaskMins !== defaults.shortTaskMins}
          onChange={(v) => setTop({ shortTaskMins: v ?? 1 })}
        />
        <NumberField
          id="minTaskMins"
          meta={m.minTaskMins}
          value={draft.minTaskMins}
          min={1}
          max={240}
          error={fieldErrors.minTaskMins}
          customised={draft.minTaskMins !== defaults.minTaskMins}
          onChange={(v) => setTop({ minTaskMins: v ?? 1 })}
        />
        <NumberField
          id="maxJobMins"
          meta={m.maxJobMins}
          value={draft.maxJobMins}
          min={60}
          max={1440}
          step={30}
          error={fieldErrors.maxJobMins}
          customised={draft.maxJobMins !== defaults.maxJobMins}
          onChange={(v) => setTop({ maxJobMins: v ?? 60 })}
        />
        <NumberField
          id="publicHolidayUplift"
          meta={m.publicHolidayUplift}
          // Stored as a fraction; shown + edited as a whole percent for readability.
          value={Math.round(draft.publicHolidayUplift * 100)}
          min={0}
          step={1}
          error={fieldErrors.publicHolidayUplift}
          customised={draft.publicHolidayUplift !== defaults.publicHolidayUplift}
          onChange={(v) => setTop({ publicHolidayUplift: (v ?? 0) / 100 })}
        />
        <NumberField
          id="minTravelCharge"
          meta={m.minTravelCharge}
          value={draft.minTravelCharge}
          min={0}
          error={fieldErrors.minTravelCharge}
          customised={draft.minTravelCharge !== defaults.minTravelCharge}
          onChange={(v) => setTop({ minTravelCharge: v ?? 0 })}
        />
        <NumberField
          id="travelRatePerHour"
          meta={m.travelRatePerHour}
          value={draft.travelRatePerHour}
          min={0}
          error={fieldErrors.travelRatePerHour}
          customised={draft.travelRatePerHour !== defaults.travelRatePerHour}
          onChange={(v) => setTop({ travelRatePerHour: v ?? 0 })}
        />
        <NumberField
          id="unsuccessfulWorkFactor"
          meta={m.unsuccessfulWorkFactor}
          // Stored as a fraction; shown + edited as a whole percent for readability.
          value={Math.round(draft.unsuccessfulWorkFactor * 100)}
          min={0}
          max={100}
          step={1}
          error={fieldErrors.unsuccessfulWorkFactor}
          customised={draft.unsuccessfulWorkFactor !== defaults.unsuccessfulWorkFactor}
          onChange={(v) => setTop({ unsuccessfulWorkFactor: (v ?? 0) / 100 })}
        />
        <NumberField
          id="workmanshipWindowDays"
          meta={m.workmanshipWindowDays}
          value={draft.workmanshipWindowDays}
          min={0}
          step={1}
          error={fieldErrors.workmanshipWindowDays}
          customised={draft.workmanshipWindowDays !== defaults.workmanshipWindowDays}
          onChange={(v) => setTop({ workmanshipWindowDays: v ?? 0 })}
        />
      </div>

      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Cancellation
      </h3>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="freeNoticeHours"
          meta={m["cancellation.freeNoticeHours"]}
          value={draft.cancellation.freeNoticeHours}
          min={0}
          error={fieldErrors["cancellation.freeNoticeHours"]}
          customised={draft.cancellation.freeNoticeHours !== defaults.cancellation.freeNoticeHours}
          onChange={(v) =>
            setDraft((p) => ({
              ...p,
              cancellation: { ...p.cancellation, freeNoticeHours: v ?? 0 },
            }))
          }
        />
        <NumberField
          id="travelChargeHours"
          meta={m["cancellation.travelChargeHours"]}
          value={draft.cancellation.travelChargeHours}
          min={0}
          error={fieldErrors["cancellation.travelChargeHours"]}
          customised={
            draft.cancellation.travelChargeHours !== defaults.cancellation.travelChargeHours
          }
          onChange={(v) =>
            setDraft((p) => ({
              ...p,
              cancellation: { ...p.cancellation, travelChargeHours: v ?? 0 },
            }))
          }
        />
        <NumberField
          id="callOutFee"
          meta={m["cancellation.callOutFee"]}
          value={draft.cancellation.callOutFee}
          min={0}
          error={fieldErrors["cancellation.callOutFee"]}
          customised={draft.cancellation.callOutFee !== defaults.cancellation.callOutFee}
          onChange={(v) =>
            setDraft((p) => ({ ...p, cancellation: { ...p.cancellation, callOutFee: v ?? 0 } }))
          }
        />
        <NumberField
          id="fullCallOutFee"
          meta={m["cancellation.fullCallOutFee"]}
          value={draft.cancellation.fullCallOutFee}
          min={0}
          error={fieldErrors["cancellation.fullCallOutFee"]}
          customised={draft.cancellation.fullCallOutFee !== defaults.cancellation.fullCallOutFee}
          onChange={(v) =>
            setDraft((p) => ({ ...p, cancellation: { ...p.cancellation, fullCallOutFee: v ?? 0 } }))
          }
        />
        <NumberField
          id="remoteFreeNoticeHours"
          meta={m["cancellation.remoteFreeNoticeHours"]}
          value={draft.cancellation.remoteFreeNoticeHours}
          min={0}
          error={fieldErrors["cancellation.remoteFreeNoticeHours"]}
          customised={
            draft.cancellation.remoteFreeNoticeHours !== defaults.cancellation.remoteFreeNoticeHours
          }
          onChange={(v) =>
            setDraft((p) => ({
              ...p,
              cancellation: { ...p.cancellation, remoteFreeNoticeHours: v ?? 0 },
            }))
          }
        />
        <NumberField
          id="remoteFee"
          meta={m["cancellation.remoteFee"]}
          value={draft.cancellation.remoteFee}
          min={0}
          error={fieldErrors["cancellation.remoteFee"]}
          customised={draft.cancellation.remoteFee !== defaults.cancellation.remoteFee}
          onChange={(v) =>
            setDraft((p) => ({ ...p, cancellation: { ...p.cancellation, remoteFee: v ?? 0 } }))
          }
        />
        <ToggleField
          id="autoSendCancellationInvoice"
          meta={m["cancellation.autoSendCancellationInvoice"]}
          value={draft.cancellation.autoSendCancellationInvoice}
          customised={
            draft.cancellation.autoSendCancellationInvoice !==
            defaults.cancellation.autoSendCancellationInvoice
          }
          onChange={(v) =>
            setDraft((p) => ({
              ...p,
              cancellation: { ...p.cancellation, autoSendCancellationInvoice: v },
            }))
          }
        />
      </div>

      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Reschedule
      </h3>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="reschedule.cutoffHours"
          meta={m["reschedule.cutoffHours"]}
          value={draft.reschedule.cutoffHours}
          min={0}
          error={fieldErrors["reschedule.cutoffHours"]}
          customised={draft.reschedule.cutoffHours !== defaults.reschedule.cutoffHours}
          onChange={(v) =>
            setDraft((p) => ({ ...p, reschedule: { ...p.reschedule, cutoffHours: v ?? 0 } }))
          }
        />
        <NumberField
          id="maxReschedules"
          meta={m["reschedule.maxReschedules"]}
          value={draft.reschedule.maxReschedules}
          nullable
          min={0}
          error={fieldErrors["reschedule.maxReschedules"]}
          customised={draft.reschedule.maxReschedules !== defaults.reschedule.maxReschedules}
          onChange={(v) =>
            setDraft((p) => ({ ...p, reschedule: { ...p.reschedule, maxReschedules: v } }))
          }
        />
      </div>

      <PricingPreview config={draft} />

      <SettingsFooter form={form} />

      <SettingsHistory group="pricing" onRestore={(v: PricingSettings) => setDraft(v)} />

      <ConfirmDialog
        open={confirmGst}
        title="Turn on GST registration?"
        body="Invoices will then show a GST breakdown - set your GST number in Business identity first."
        confirmLabel="Turn on GST"
        cancelLabel="Leave GST off"
        onConfirm={() => setConfirmGst(false)}
        onCancel={() => {
          // Cancel puts GST back to its last-saved state (baseline).
          setConfirmGst(false);
          setTop({ gstRegistered: baseline.gstRegistered });
        }}
      />
    </SettingsTabBody>
  );
}
