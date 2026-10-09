// src/features/business/components/assets/AssetScheduleModal.tsx
// One asset's depreciation schedule in a dialog, a row per financial year: months
// counted, opening and closing tax value, the full depreciation, the business share
// claimed, and any write-off, Investment Boost or disposal result. Cards on phones, a
// table from md.

import {
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { Modal } from "@/features/admin/components/ui/Modal";
import type { AssetView } from "@/features/business/lib/assets";
import { formatNZD } from "@/features/business/lib/business-format";
import type { AssetYearRow } from "@/features/business/lib/tax";
import { formatRatePct } from "@/features/business/lib/tax/workings";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Right-aligned numeric header cell. */
const NUM_TH = cn(TH_CLS, "text-right");
/** Right-aligned numeric body cell. */
const NUM_TD = cn(TD_CLS, "text-right whitespace-nowrap");

/** Props for {@link AssetScheduleModal}. */
interface AssetScheduleModalProps {
  /** Asset to show; null keeps the dialog closed. */
  asset: AssetView | null;
  /** Closes the dialog. */
  onClose: () => void;
  /** Keys of the filed years, whose rows note that the Tax page shows the saved figures. */
  filedFyKeys: ReadonlySet<string>;
}

/**
 * What else happened in a year, in words. A filed year's row is computed live, so it
 * also points to the saved figures.
 * @param row - One FY of the schedule.
 * @param filed - Whether the row's FY is marked filed.
 * @returns Note text, or "" when nothing else happened.
 */
function rowNote(row: AssetYearRow, filed: boolean): string {
  const notes: string[] = [];
  if (row.writtenOff) notes.push("Written off in full (low value)");
  if (row.investmentBoost > 0)
    notes.push(`Includes ${formatNZD(row.investmentBoost)} Investment Boost`);
  if (row.disposed) {
    if (row.recoveryIncome > 0)
      notes.push(`Disposed: ${formatNZD(row.recoveryIncome)} clawed back as income`);
    else if (row.lossOnDisposal > 0)
      notes.push(`Disposed: ${formatNZD(row.lossOnDisposal)} loss claimed`);
    else notes.push("Disposed");
  }
  if (filed) notes.push("Filed: the Tax page shows the saved figures");
  return notes.join(". ");
}

/**
 * Schedule dialog for one asset.
 * @param props - Component props.
 * @param props.asset - Asset to show, or null when closed.
 * @param props.onClose - Closes the dialog.
 * @param props.filedFyKeys - Keys of the filed years.
 * @returns The dialog, or null when closed.
 */
export function AssetScheduleModal({
  asset,
  onClose,
  filedFyKeys,
}: AssetScheduleModalProps): React.ReactElement | null {
  if (!asset) return null;
  const rate =
    asset.vehicleMethod === "km"
      ? "Kilometre rates"
      : `${asset.method} ${formatRatePct(asset.rate)}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={asset.name}
      description={`${asset.classLabel}. ${rate}. ${asset.businessUsePct}% business use.`}
      footer={
        <AdminButton variant="secondary" onClick={onClose}>
          Close
        </AdminButton>
      }
    >
      {asset.vehicleMethod === "km" && (
        <Notice className="mb-4">
          This vehicle is claimed on IRD kilometre rates, so it isn&apos;t depreciated. Its tax
          value stays at {formatNZD(asset.costBase)}, and selling it brings nothing back as income.
        </Notice>
      )}
      {asset.schedule.length === 0 ? (
        <EmptyState
          title="No years to show yet"
          body="The schedule starts in the financial year the asset goes into use."
        />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {asset.schedule.map((row) => {
              const note = rowNote(row, filedFyKeys.has(row.fyKey));
              return (
                <li key={row.fyKey}>
                  <Card padding="sm">
                    <p className="font-bold text-admin-text">
                      FY {row.fyKey}{" "}
                      <span className="font-normal text-admin-muted">
                        ({row.months} {row.months === 1 ? "month" : "months"})
                      </span>
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <dt className="text-admin-muted">Opening value</dt>
                      <dd className="text-right text-admin-text">{formatNZD(row.openingAtv)}</dd>
                      <dt className="text-admin-muted">Depreciation</dt>
                      <dd className="text-right text-admin-text">{formatNZD(row.depreciation)}</dd>
                      <dt className="text-admin-muted">Claimed (business share)</dt>
                      <dd className="text-right font-bold text-admin-text">
                        {formatNZD(row.deductible)}
                      </dd>
                      <dt className="text-admin-muted">Closing value</dt>
                      <dd className="text-right text-admin-text">{formatNZD(row.closingAtv)}</dd>
                    </dl>
                    {note && <p className="mt-2 text-sm text-admin-text-secondary">{note}</p>}
                  </Card>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-admin-border md:block">
            <table className={TABLE_CLS}>
              <thead className={THEAD_CLS}>
                <tr>
                  <th className={TH_CLS}>Year</th>
                  <th className={NUM_TH}>Months</th>
                  <th className={NUM_TH}>Opening value</th>
                  <th className={NUM_TH}>Depreciation</th>
                  <th className={NUM_TH}>Claimed</th>
                  <th className={NUM_TH}>Closing value</th>
                  <th className={TH_CLS}>Notes</th>
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {asset.schedule.map((row) => (
                  <tr key={row.fyKey}>
                    <td className={cn(TD_CLS, "font-bold whitespace-nowrap")}>FY {row.fyKey}</td>
                    <td className={NUM_TD}>{row.months}</td>
                    <td className={NUM_TD}>{formatNZD(row.openingAtv)}</td>
                    <td className={NUM_TD}>{formatNZD(row.depreciation)}</td>
                    <td className={cn(NUM_TD, "font-bold")}>{formatNZD(row.deductible)}</td>
                    <td className={NUM_TD}>{formatNZD(row.closingAtv)}</td>
                    <td className={cn(TD_CLS, "text-sm text-admin-text-secondary")}>
                      {rowNote(row, filedFyKeys.has(row.fyKey))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
