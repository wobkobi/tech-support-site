"use client";
// src/features/admin/components/settings/PricingTab.tsx
/**
 * @file PricingTab.tsx
 * @description Editor for the pricing & cancellation group. Renders each field
 * from `PRICING_FIELD_META`, tracks dirty state via `useSettingsForm`, and saves
 * to the admin settings route - surfacing inline field errors, guardrail blocks,
 * and warnings (with a "save anyway" confirm). The public site doesn't read
 * these yet; that wiring lands in the next part.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { PRICING_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { PricingSettings } from "@/shared/lib/settings/types";
import { NumberField, ToggleField } from "@/features/admin/components/settings/SettingsFields";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { PricingPreview } from "@/features/admin/components/settings/PricingPreview";

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
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, warns, savedAt } = form;
  const m = PRICING_FIELD_META;

  /**
   * Updates a top-level pricing field.
   * @param patch - Partial pricing fields to merge into the draft.
   * @returns void
   */
  const setTop = (patch: Partial<PricingSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <div>
      <div className={cn("divide-y divide-slate-100")}>
        <ToggleField
          id="gstRegistered"
          meta={m.gstRegistered}
          value={draft.gstRegistered}
          customised={draft.gstRegistered !== defaults.gstRegistered}
          onChange={(v) => {
            // Turning GST on is high-impact (changes every invoice) - confirm first.
            if (v && !window.confirm("Turn on GST registration? Invoices will start showing GST."))
              return;
            setTop({ gstRegistered: v });
          }}
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
      </div>

      <h3 className={cn("text-russian-violet mt-6 text-xs font-bold uppercase tracking-wide")}>
        Cancellation
      </h3>
      <div className={cn("divide-y divide-slate-100")}>
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
      </div>

      <h3 className={cn("text-russian-violet mt-6 text-xs font-bold uppercase tracking-wide")}>
        Reschedule
      </h3>
      <div className={cn("divide-y divide-slate-100")}>
        <NumberField
          id="rescheduleCutoff"
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
          onClick={() => {
            if (
              draft.gstRegistered &&
              !initial.gstRegistered &&
              !confirm(
                "Turn on GST registration? Invoices will then show a GST breakdown - set your GST number in Business identity first.",
              )
            )
              return;
            void form.save();
          }}
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

      <SettingsHistory group="pricing" onRestore={(v: PricingSettings) => setDraft(v)} />
    </div>
  );
}
