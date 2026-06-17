"use client";
// src/features/admin/components/settings/PricingPreview.tsx
/**
 * @file PricingPreview.tsx
 * @description Live worked-example for the pricing tab - renders the draft
 * cancellation policy, billing rounding, surcharge, and GST status as the
 * plain-English lines a customer or invoice would reflect, so the abstract
 * numbers have a concrete meaning before saving.
 */

import type { PricingSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  config: PricingSettings;
}

/**
 * Live pricing preview (worked example from the draft values).
 * @param props - Component props.
 * @param props.config - The draft pricing settings.
 * @returns Preview element.
 */
export function PricingPreview({ config }: Props): React.ReactElement {
  const { cancellation: c, reschedule: r } = config;
  const lines: string[] = [];

  lines.push(`Cancellations more than ${c.freeNoticeHours}h before the appointment are free.`);
  lines.push(
    c.travelChargeHours > 0
      ? `Within ${c.freeNoticeHours}h a $${c.callOutFee} call-out applies; within ${c.travelChargeHours}h, round-trip travel is added too.`
      : `Within ${c.freeNoticeHours}h a $${c.callOutFee} call-out applies.`,
  );

  lines.push(
    config.minBillableMins > 0
      ? `Work is billed in ${config.billingIncrementMins}-min steps, minimum ${config.minBillableMins} min.`
      : `Work is billed in ${config.billingIncrementMins}-min steps, no minimum.`,
  );

  if (config.publicHolidayUplift > 0) {
    lines.push(
      `Public-holiday labour carries a +${Math.round(config.publicHolidayUplift * 100)}% surcharge.`,
    );
  }
  if (config.minTravelCharge > 0) {
    lines.push(`Any travel bills at least $${config.minTravelCharge}.`);
  }

  if (r.cutoffHours > 0 || r.maxReschedules !== null) {
    const parts: string[] = [];
    if (r.cutoffHours > 0)
      parts.push(`no rescheduling within ${r.cutoffHours}h of the appointment`);
    if (r.maxReschedules !== null)
      parts.push(`up to ${r.maxReschedules} reschedule(s) per booking`);
    lines.push(`Rescheduling: ${parts.join(", ")}.`);
  }

  lines.push(
    config.gstRegistered
      ? "GST registered - invoices show a GST breakdown."
      : "Not GST registered - invoices show no GST.",
  );

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-xs font-bold tracking-wide text-russian-violet uppercase">
        Live preview
      </h3>
      <ul className="mt-2 space-y-1 text-sm text-slate-600">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
