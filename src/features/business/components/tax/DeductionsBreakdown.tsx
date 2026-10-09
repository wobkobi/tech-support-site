// src/features/business/components/tax/DeductionsBreakdown.tsx
// Deductions for one FY: each counted line (expenses, depreciation, write-offs, the km
// claim, home office, disposal losses) and the total, then what was left out as
// information: Fuel dated while a car was on kilometre rates, rows turned into assets,
// and km logged on days no km-rate vehicle was on the register. Server-safe.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { WorkingRow } from "@/features/business/components/tax/WorkingRow";
import { formatNZD } from "@/features/business/lib/business";
import type { GstStatus, TaxYearResult } from "@/features/business/lib/tax";
import { formatKm } from "@/features/business/lib/trips";
import { Notice } from "@/shared/components/Notice";
import { formatDateSlash } from "@/shared/lib/date-format";
import type React from "react";

/**
 * What the km rate already pays for. Fuel is the only running cost the estimate leaves
 * out on its own, so the rest rely on not being logged. The accountant notes repeat it.
 */
export const CAR_RUNNING_COSTS_NOTE =
  "The kilometre rate covers the car's running costs. Don't log its insurance, rego, WOF, repairs or tyres as expenses.";

/** Props for {@link DeductionsBreakdown}. */
interface DeductionsBreakdownProps {
  /** computeTaxYear output for the FY. */
  result: TaxYearResult;
  /** GST registration status, for the line saying which amounts count. */
  gst: GstStatus;
}

/**
 * One sentence on whether expenses count with or without GST.
 * @param gst - GST registration status.
 * @returns Description text.
 */
function gstBasisText(gst: GstStatus): string {
  if (!gst.registered) return "Not GST registered, so expenses count with GST included.";
  if (gst.registeredFrom) {
    return `GST registered from ${formatDateSlash(gst.registeredFrom, { utc: true })}: expenses from then count without GST.`;
  }
  return "GST registered, so expenses count without GST.";
}

/**
 * Renders the deductions card.
 * @param props - Component props.
 * @param props.result - computeTaxYear output for the FY.
 * @param props.gst - GST registration status.
 * @returns The card.
 */
export function DeductionsBreakdown({ result, gst }: DeductionsBreakdownProps): React.ReactElement {
  const { lines, total, excludedFuel, excludedAssetLinked, unclaimedKm } = result.deductions;
  const counted = lines.filter((line) => line.amount !== 0);
  const anyExcluded = excludedFuel > 0 || excludedAssetLinked > 0 || unclaimedKm > 0;

  return (
    <Card>
      <CardHeader title="Deductions" description={gstBasisText(gst)} />
      <ul className="divide-y divide-admin-border">
        {counted.length === 0 ? (
          <WorkingRow label="Nothing to deduct yet" value={formatNZD(0)} tone="muted" />
        ) : (
          counted.map((line) => (
            <WorkingRow
              key={line.key}
              label={line.label}
              note={line.note}
              value={formatNZD(line.amount)}
            />
          ))
        )}
        <WorkingRow label="Total deductions" value={formatNZD(total)} tone="total" />
      </ul>

      {anyExcluded && (
        <>
          <h3 className="mt-5 mb-1 text-base font-bold text-admin-text">Not counted</h3>
          <ul className="divide-y divide-admin-border">
            {excludedFuel > 0 && (
              <WorkingRow
                label="Fuel"
                note="Bought while the car was claimed on IRD kilometre rates, which already cover fuel."
                value={formatNZD(excludedFuel)}
                tone="muted"
              />
            )}
            {excludedAssetLinked > 0 && (
              <WorkingRow
                label="Expenses turned into assets"
                note="These are depreciated on the Assets page instead of being deducted in one go."
                value={formatNZD(excludedAssetLinked)}
                tone="muted"
              />
            )}
            {unclaimedKm > 0 && (
              <WorkingRow
                label="Trips with no km-rate vehicle"
                note="Logged on days no kilometre-rate vehicle was on the asset register. Add the vehicle on the Assets page to claim them."
                value={formatKm(unclaimedKm)}
                tone="muted"
              />
            )}
          </ul>
        </>
      )}

      <Notice className="mt-5">{CAR_RUNNING_COSTS_NOTE}</Notice>
    </Card>
  );
}
