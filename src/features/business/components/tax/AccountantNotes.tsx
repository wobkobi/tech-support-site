// src/features/business/components/tax/AccountantNotes.tsx
// "Check with your accountant" list on the Tax page: the open questions the estimate
// makes a default call on, so they get raised before the return is filed. Server-safe.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { CAR_RUNNING_COSTS_NOTE } from "@/features/business/components/tax/DeductionsBreakdown";
import type React from "react";

/** Questions left to the accountant; the estimate uses the reading noted in each. */
const ACCOUNTANT_NOTES: readonly string[] = [
  "Whether an item of $1,000 or less that you brought in from personal use can be written off in full. The estimate depreciates it from its market value instead.",
  "Which rate suits the monitors: the general computer equipment rate (50% DV) or the office equipment rate (40% DV).",
  "Whether claiming the office on the square-metre rate affects depreciation on the equipment kept in it.",
  "How the $1,000 write-off works for a phone or laptop that is partly personal.",
  "The 2026-27 square-metre and kilometre rates. IRD publishes them around mid-2027, so the 2025-26 rates are used until then.",
  CAR_RUNNING_COSTS_NOTE,
  "A year with two kilometre-rate vehicles needs the Tier 1 split worked out for each vehicle. The estimate uses one total-km figure for the year.",
  "Investment Boost uses the date an asset went into service as a stand-in for the date it was bought. Confirm it for any asset bought before 22 May 2025 but first used after it.",
];

/**
 * Renders the accountant notes card.
 * @returns The card.
 */
export function AccountantNotes(): React.ReactElement {
  return (
    <Card className="mb-8">
      <CardHeader
        title="Check with your accountant"
        description="The estimate makes a call on each of these. Confirm them before the return is filed."
      />
      <ul className="list-disc space-y-2 pl-5 text-[0.9375rem] text-admin-text">
        {ACCOUNTANT_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </Card>
  );
}
