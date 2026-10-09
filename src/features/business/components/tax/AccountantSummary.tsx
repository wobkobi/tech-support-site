// src/features/business/components/tax/AccountantSummary.tsx
// Accountant handover for one financial year on the Tax page: IR3 net income and the IR10
// box figures, that year's asset depreciation schedule and the trip total, with a CSV of
// the same figures. Renders whatever snapshot it's given, so a filed year shows its saved
// figures. Phones get cards; the schedule becomes a table from md.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { TaxExportButton } from "@/features/business/components/tax/TaxExportButton";
import { formatNZD } from "@/features/business/lib/business-format";
import type { SnapshotAsset, TaxYearSnapshot } from "@/features/business/lib/tax/snapshot";
import type { AssetYearRow, TaxYearResult } from "@/features/business/lib/tax/types";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** IR3 and IR10 figures in return order, with the box each one goes in. */
const RETURN_FIGURES: ReadonlyArray<{
  key: keyof TaxYearResult["ir"];
  label: string;
  box: string;
}> = [
  { key: "ir3NetIncome", label: "Net income", box: "IR3 question 24" },
  {
    key: "ir10Box52Depreciation",
    label: "Depreciation, incl. Investment Boost",
    box: "IR10 box 52",
  },
  { key: "ir10Box54Additions", label: "Assets added", box: "IR10 box 54" },
  { key: "ir10Box55Disposals", label: "Assets sold or disposed of", box: "IR10 box 55" },
  { key: "ir10Box59LossOnDisposal", label: "Loss on disposal", box: "IR10 box 59" },
  { key: "ir10Box60BoostValue", label: "Investment Boost asset value", box: "IR10 box 60" },
];

/**
 * Short note explaining an unusual schedule row.
 * @param row - The asset's row for the year.
 * @param asset - Its register details.
 * @returns The note, or "" for an ordinary row.
 */
function rowNote(row: AssetYearRow, asset: SnapshotAsset | undefined): string {
  if (asset?.vehicleMethod === "km") return "Vehicle on km rates, not depreciated";
  if (row.disposed) return "Sold or disposed of this year";
  if (row.writtenOff) return "Written off (low value)";
  if (row.investmentBoost > 0) return "Includes Investment Boost";
  return "";
}

/**
 * Distance with a km suffix, to one decimal place.
 * @param km - Distance.
 * @returns E.g. "1,240.5 km".
 */
function formatKm(km: number): string {
  return `${km.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} km`;
}

/**
 * Line under the card title: whose figures these are.
 * @param filed - Whether the snapshot is the saved one.
 * @param unreadable - Whether the year is filed but its saved figures couldn't be read.
 * @param fyLabel - FY display label.
 * @returns The description.
 */
function summaryDescription(filed: boolean, unreadable: boolean, fyLabel: string): string {
  if (filed) return `The figures saved when ${fyLabel} was marked filed.`;
  if (unreadable) return `Fresh figures for ${fyLabel}, because the saved ones couldn't be read.`;
  return `Live figures for ${fyLabel}. They're saved when you mark the year filed.`;
}

/**
 * Accountant summary card for one year.
 * @param props - Component props.
 * @param props.view - The year's snapshot (saved when filed, otherwise live).
 * @param props.fyKey - FY key for the CSV download.
 * @param props.fyLabel - FY display label.
 * @param props.unreadable - True when the year is filed but its saved figures couldn't be
 *   read, so `view` holds fresh figures.
 * @returns The card.
 */
export function AccountantSummary({
  view,
  fyKey,
  fyLabel,
  unreadable = false,
}: {
  view: TaxYearSnapshot;
  fyKey: string;
  fyLabel: string;
  unreadable?: boolean;
}): React.ReactElement {
  const { result } = view;
  const assetsById = new Map(view.assets.map((asset) => [asset.id, asset] as const));
  const tripCount = view.trips.length;
  const { km } = result;
  const { unclaimedKm } = result.deductions;

  return (
    <Card className="mb-8">
      <CardHeader
        title="Accountant summary"
        description={summaryDescription(view.filedAt !== null, unreadable, fyLabel)}
        actions={<TaxExportButton fyKey={fyKey} />}
        // Stack on phones so the description isn't squeezed into a narrow column beside the button.
        className="max-sm:flex-col"
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RETURN_FIGURES.map((figure) => (
          <div key={figure.key} className="rounded-md border border-admin-border px-4 py-3">
            <dt className="text-sm font-bold text-admin-muted">{figure.box}</dt>
            <dd className="mt-1 text-lg font-extrabold text-admin-text tabular-nums">
              {formatNZD(result.ir[figure.key])}
            </dd>
            <dd className="text-sm text-admin-text-secondary">{figure.label}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 mb-3 text-base font-extrabold text-admin-text">Asset schedule</h3>
      {result.assets.length === 0 ? (
        <p className="text-[0.9375rem] text-admin-text-secondary">No assets in use this year.</p>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {result.assets.map((row) => {
              const asset = assetsById.get(row.assetId);
              const note = rowNote(row, asset);
              return (
                <li key={row.assetId} className="rounded-md border border-admin-border p-3">
                  <p className="font-bold text-admin-text">{asset?.name ?? row.assetId}</p>
                  <p className="text-sm text-admin-text-secondary">{asset?.classLabel ?? ""}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.9375rem]">
                    <dt className="text-admin-muted">Opening value</dt>
                    <dd className="text-right tabular-nums">{formatNZD(row.openingAtv)}</dd>
                    <dt className="text-admin-muted">Depreciation</dt>
                    <dd className="text-right tabular-nums">{formatNZD(row.depreciation)}</dd>
                    <dt className="text-admin-muted">Deductible</dt>
                    <dd className="text-right font-bold tabular-nums">
                      {formatNZD(row.deductible)}
                    </dd>
                    <dt className="text-admin-muted">Closing value</dt>
                    <dd className="text-right tabular-nums">{formatNZD(row.closingAtv)}</dd>
                  </dl>
                  {note && <p className="mt-2 text-sm text-admin-text-secondary">{note}</p>}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className={TABLE_CLS}>
              <thead className={THEAD_CLS}>
                <tr>
                  <th className={TH_CLS}>Asset</th>
                  <th className={cn(TH_CLS, "text-right")}>Opening value</th>
                  <th className={cn(TH_CLS, "text-right")}>Depreciation</th>
                  <th className={cn(TH_CLS, "text-right")}>Deductible</th>
                  <th className={cn(TH_CLS, "text-right")}>Closing value</th>
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {result.assets.map((row) => {
                  const asset = assetsById.get(row.assetId);
                  const note = rowNote(row, asset);
                  return (
                    <tr key={row.assetId} className={ROW_CLS}>
                      <td className={TD_CLS}>
                        <span className="block font-bold">{asset?.name ?? row.assetId}</span>
                        <span className="block text-sm text-admin-text-secondary">
                          {asset?.classLabel ?? ""}
                          {note ? ` - ${note}` : ""}
                        </span>
                      </td>
                      <td className={cn(TD_CLS, "text-right tabular-nums")}>
                        {formatNZD(row.openingAtv)}
                      </td>
                      <td className={cn(TD_CLS, "text-right tabular-nums")}>
                        {formatNZD(row.depreciation)}
                      </td>
                      <td className={cn(TD_CLS, "text-right font-bold tabular-nums")}>
                        {formatNZD(row.deductible)}
                      </td>
                      <td className={cn(TD_CLS, "text-right tabular-nums")}>
                        {formatNZD(row.closingAtv)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mt-6 mb-2 text-base font-extrabold text-admin-text">Trips</h3>
      <p className="text-[0.9375rem] text-admin-text-secondary">
        {tripCount === 0
          ? "No business trips logged this year."
          : `${tripCount} ${tripCount === 1 ? "trip" : "trips"} logged. ${formatKm(km.businessKm)} claimed: ${formatKm(km.tier1Km)} at the Tier 1 rate and ${formatKm(km.tier2Km)} at Tier 2, a claim of ${formatNZD(km.amount)}.`}
        {unclaimedKm > 0 &&
          ` ${formatKm(unclaimedKm)} was logged on days with no kilometre-rate vehicle on the asset register, so it isn't claimed.`}
        {/* The car's total km sets the Tier 1 split, so the accountant needs it beside the claim. */}
        {km.businessKm > 0 &&
          (view.totalVehicleKm === null
            ? " The car's total km for the year isn't entered, so Tier 1 covers the first 14,000 business km."
            : ` The car travelled ${formatKm(view.totalVehicleKm)} in total this year (odometer).`)}
      </p>
    </Card>
  );
}
