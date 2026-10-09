// src/features/business/components/tax/IncomeTaxWorkings.tsx
// Income tax workings for one FY: the tax on each NZ bracket the profit reaches, the
// independent earner tax credit, ACC, the total to set aside, and KiwiSaver shown apart
/// because it is savings paid to a provider, not tax. A filed year shows its saved figures,
// so every label there comes from those figures rather than from Settings. Server-safe.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { WorkingRow } from "@/features/business/components/tax/WorkingRow";
import { formatNZD } from "@/features/business/lib/business";
import type { TaxRulesSettings, TaxYearResult } from "@/features/business/lib/tax";
import {
  bandBreakdown,
  bandLabel,
  bracketsMatchFiled,
  filedRateLabel,
  formatRatePct,
  formatWholeDollars,
} from "@/features/business/lib/tax/workings";
import type React from "react";

/** Props for {@link IncomeTaxWorkings}. */
interface IncomeTaxWorkingsProps {
  /** computeTaxYear output for the FY. */
  result: TaxYearResult;
  /** Live tax settings (brackets, IETC, ACC, KiwiSaver). */
  settings: TaxRulesSettings;
  /** True when the result is a filed year's saved figures, worked out on the settings then. */
  filed: boolean;
}

/**
 * The IETC rule in one line, from the live settings.
 * @param ietc - IETC settings.
 * @returns Note text.
 */
function ietcNote(ietc: TaxRulesSettings["ietc"]): string {
  if (!ietc.enabled) return "Turned off in Settings.";
  const cents = Math.round(ietc.abatementPerDollar * 100);
  return (
    `${formatWholeDollars(ietc.annual)} a year for income from ${formatWholeDollars(ietc.from)} ` +
    `to ${formatWholeDollars(ietc.fullTo)}, then ${cents}c less per dollar, ending at ` +
    `${formatWholeDollars(ietc.cutoff)}.`
  );
}

/**
 * Renders the income tax workings card.
 * @param props - Component props.
 * @param props.result - computeTaxYear output for the FY.
 * @param props.settings - Live tax settings, used for the labels of a year not yet filed.
 * @param props.filed - True when the result is a filed year's saved figures.
 * @returns The card.
 */
export function IncomeTaxWorkings({
  result,
  settings,
  filed,
}: IncomeTaxWorkingsProps): React.ReactElement {
  // A filed year keeps its saved income tax, so the live band rows only show while
  // the brackets in Settings still give that total.
  const showBands = !filed || bracketsMatchFiled(result, settings.brackets);
  const bands = bandBreakdown(result.taxable, settings.brackets).filter((b) => b.taxedAmount > 0);
  const accRate = filed ? filedRateLabel(result.acc, result.taxable) : formatRatePct(settings.acc);
  const kiwiSaverRate = filed
    ? filedRateLabel(result.kiwiSaver, result.taxable)
    : formatRatePct(settings.kiwiSaver);

  return (
    <Card>
      <CardHeader
        title="Income tax workings"
        description={`On a taxable profit of ${formatNZD(result.taxable)}`}
      />
      <ul className="divide-y divide-admin-border">
        {showBands &&
          (bands.length === 0 ? (
            <WorkingRow
              label="No income tax on a profit of $0 or less"
              value={formatNZD(0)}
              tone="muted"
            />
          ) : (
            bands.map((band) => (
              <WorkingRow
                key={band.from}
                label={bandLabel(band)}
                note={`${formatNZD(band.taxedAmount)} of profit in this band`}
                value={formatNZD(band.tax)}
              />
            ))
          ))}
        <WorkingRow
          label="Income tax"
          note={
            showBands ? undefined : "Worked out on the brackets in force when this year was filed."
          }
          value={formatNZD(result.incomeTax)}
          tone="total"
        />
        <WorkingRow
          label="Less the independent earner tax credit (IETC)"
          note={filed ? undefined : ietcNote(settings.ietc)}
          value={formatNZD(-result.ietc)}
        />
        <WorkingRow
          label="Income tax after the credit"
          value={formatNZD(result.residualIncomeTax)}
        />
        <WorkingRow
          label={accRate ? `ACC levies at ${accRate}` : "ACC levies"}
          note={filed ? undefined : "Set the rate in Settings to match your ACC invoice."}
          value={formatNZD(result.acc)}
        />
        <WorkingRow
          label="Total to set aside"
          value={formatNZD(result.totalToSetAside)}
          tone="total"
        />
      </ul>

      <h3 className="mt-5 mb-1 text-base font-bold text-admin-text">KiwiSaver (not tax)</h3>
      <ul className="divide-y divide-admin-border">
        <WorkingRow
          label={kiwiSaverRate ? `KiwiSaver at ${kiwiSaverRate} of taxable profit` : "KiwiSaver"}
          note="Voluntary. Paid to your KiwiSaver provider, not IRD, so it isn't in the total above."
          value={formatNZD(result.kiwiSaver)}
        />
      </ul>
    </Card>
  );
}
