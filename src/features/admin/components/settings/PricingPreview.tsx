"use client";
// src/features/admin/components/settings/PricingPreview.tsx
// Live worked-example for the pricing tab - renders the draft cancellation policy,
// billing rounding, surcharge, and GST status as the plain-English lines a customer or
// invoice would reflect, so the abstract numbers have a concrete meaning before saving.

import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
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

  // In person and remote are priced separately, so the preview shows both -
  // reading only one line would hide half the policy from the operator.
  lines.push(
    c.travelChargeHours > 0
      ? `In person: free more than ${c.freeNoticeHours}h out. Inside that, a $${c.callOutFee} fee. Within ${c.travelChargeHours}h, or a no-show, the full $${c.fullCallOutFee} call-out plus round-trip travel.`
      : `In person: free more than ${c.freeNoticeHours}h out. Inside that, a $${c.callOutFee} fee.`,
  );
  lines.push(
    `Remote: free more than ${c.remoteFreeNoticeHours}h out. Inside that, or a no-show, a $${c.remoteFee} fee - no travel.`,
  );

  lines.push(
    config.minBillableMins > 0
      ? `Work is billed in ${config.billingIncrementMins}-min steps, with a ${config.minBillableMins} min minimum per job.`
      : `Work is billed in ${config.billingIncrementMins}-min steps, no minimum.`,
  );
  lines.push(
    `A quick one-off job bills ${config.shortTaskMins} min, so it can't take an even share of a long visit.`,
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
    <Card className="mt-6 bg-admin-bg">
      <h3 className={ADMIN_EYEBROW_CLS}>Live preview</h3>
      <ul className="mt-2 space-y-1 text-sm text-admin-text-secondary">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Card>
  );
}
