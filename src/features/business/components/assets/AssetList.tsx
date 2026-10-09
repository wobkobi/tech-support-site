// src/features/business/components/assets/AssetList.tsx
// The asset register: cards up to xl, a table from xl (below that, next to the sidebar,
// the eight columns squeeze). Each asset shows its class, where it came from, value,
// business share, rate, this year's depreciation claimed and tax value, with Schedule,
// Edit and Delete actions. A disposal year's loss or recovery shows in the schedule.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { formatRatePct, type AssetView } from "@/features/business/lib/assets";
import { formatNZD } from "@/features/business/lib/business-format";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/** Props for {@link AssetList}. */
interface AssetListProps {
  /** Assets in register order. */
  assets: readonly AssetView[];
  /** Current FY key, for the depreciation heading. */
  currentFyKey: string;
  /** Opens the add form (from the empty state). */
  onAdd: () => void;
  /** Opens an asset's schedule. */
  onSchedule: (asset: AssetView) => void;
  /** Opens an asset in the edit form. */
  onEdit: (asset: AssetView) => void;
  /** Asks to delete an asset. */
  onDelete: (asset: AssetView) => void;
}

/**
 * Rate text: method and rate, or "Km rates" for a kilometre-rate vehicle.
 * @param asset - The asset.
 * @returns Display text.
 */
function rateText(asset: AssetView): string {
  return asset.vehicleMethod === "km" ? "Km rates" : `${asset.method} ${formatRatePct(asset.rate)}`;
}

/**
 * This FY's business-share depreciation (a disposal loss or recovery isn't included).
 * @param asset - The asset.
 * @returns Money text, or "-" when the asset has no row this year.
 */
function claimText(asset: AssetView): string {
  return asset.current ? formatNZD(asset.current.deductible) : "-";
}

/**
 * Adjusted tax value at the end of this FY.
 * @param asset - The asset.
 * @returns Money text, or "-" when the asset has no row this year.
 */
function valueText(asset: AssetView): string {
  return asset.current ? formatNZD(asset.current.closingAtv) : "-";
}

/**
 * Status pills: origin, km rates, Investment Boost, a low-value write-off, disposal.
 * @param props - Component props.
 * @param props.asset - The asset.
 * @returns The pills.
 */
function AssetBadges({ asset }: { asset: AssetView }): React.ReactElement {
  const writtenOff = asset.schedule.find((r) => r.writtenOff);
  return (
    <span className="flex flex-wrap gap-1.5">
      <StatusPill tone="neutral">
        {asset.origin === "introduced" ? "Brought in" : "Bought"}
      </StatusPill>
      {asset.vehicleMethod === "km" && <StatusPill tone="violet">Km rates</StatusPill>}
      {asset.investmentBoost && <StatusPill tone="success">Investment Boost</StatusPill>}
      {writtenOff && <StatusPill tone="warning">Written off {writtenOff.fyKey}</StatusPill>}
      {asset.disposedAt && <StatusPill tone="critical">Disposed</StatusPill>}
    </span>
  );
}

/**
 * One label/value pair in a phone card.
 * @param props - Component props.
 * @param props.label - Label text.
 * @param props.value - Value text.
 * @returns The pair.
 */
function Fact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-admin-muted">{label}</dt>
      <dd className="font-semibold text-admin-text">{value}</dd>
    </div>
  );
}

/**
 * Schedule, Edit and Delete for one asset.
 * @param props - Component props.
 * @param props.asset - The asset.
 * @param props.onSchedule - Opens its schedule.
 * @param props.onEdit - Opens it in the form.
 * @param props.onDelete - Asks to delete it.
 * @returns The action buttons.
 */
function AssetActions({
  asset,
  onSchedule,
  onEdit,
  onDelete,
}: Pick<AssetListProps, "onSchedule" | "onEdit" | "onDelete"> & {
  asset: AssetView;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2 xl:flex-nowrap xl:justify-end">
      <AdminButton
        variant="ghost"
        onClick={() => onSchedule(asset)}
        aria-label={`Schedule for ${asset.name}`}
      >
        Schedule
      </AdminButton>
      <AdminButton
        variant="secondary"
        onClick={() => onEdit(asset)}
        aria-label={`Edit ${asset.name}`}
      >
        Edit
      </AdminButton>
      <AdminButton
        variant="danger"
        onClick={() => onDelete(asset)}
        aria-label={`Delete ${asset.name}`}
      >
        Delete
      </AdminButton>
    </div>
  );
}

/**
 * The register, or an empty state with an Add button.
 * @param props - Component props.
 * @param props.assets - Assets in register order.
 * @param props.currentFyKey - Current FY key.
 * @param props.onAdd - Opens the add form.
 * @param props.onSchedule - Opens an asset's schedule.
 * @param props.onEdit - Opens an asset in the form.
 * @param props.onDelete - Asks to delete an asset.
 * @returns The list element.
 */
export function AssetList({
  assets,
  currentFyKey,
  onAdd,
  onSchedule,
  onEdit,
  onDelete,
}: AssetListProps): React.ReactElement {
  if (assets.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No assets yet"
          body="Add the gear you brought into the business, like your computer, phone, tools and desk, with what each was worth when you started using it for work."
          action={<AdminButton onClick={onAdd}>Add asset</AdminButton>}
        />
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-3 xl:hidden">
        {assets.map((a) => (
          <li key={a.id}>
            <Card padding="sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-admin-text">{a.name}</p>
                  <p className="text-sm text-admin-muted">{a.classLabel}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold text-admin-text">{claimText(a)}</p>
                  <p className="text-sm text-admin-muted">Depreciation {currentFyKey}</p>
                </div>
              </div>
              <div className="mt-2">
                <AssetBadges asset={a} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Fact label="In use from" value={formatDateShort(a.inServiceDate)} />
                <Fact
                  label={a.origin === "introduced" ? "Value brought in" : "Cost"}
                  value={formatNZD(a.costBase)}
                />
                <Fact label="Business use" value={`${a.businessUsePct}%`} />
                <Fact label="Rate" value={rateText(a)} />
                <Fact label="Tax value" value={valueText(a)} />
                {a.disposedAt && <Fact label="Disposed" value={formatDateShort(a.disposedAt)} />}
              </dl>
              <div className="mt-3">
                <AssetActions
                  asset={a}
                  onSchedule={onSchedule}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Card padding="none" className="hidden overflow-x-auto xl:block">
        <table className={TABLE_CLS}>
          <thead className={THEAD_CLS}>
            <tr>
              <th className={TH_CLS}>Asset</th>
              <th className={TH_CLS}>In use from</th>
              <th className={cn(TH_CLS, "text-right")}>Cost or value</th>
              <th className={cn(TH_CLS, "text-right")}>Business use</th>
              <th className={TH_CLS}>Rate</th>
              <th className={cn(TH_CLS, "text-right")}>Depreciation {currentFyKey}</th>
              <th className={cn(TH_CLS, "text-right")}>Tax value</th>
              <th className={TH_CLS}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {assets.map((a) => (
              <tr key={a.id} className={ROW_CLS}>
                <td className={TD_CLS}>
                  <p className="font-bold text-admin-text">{a.name}</p>
                  <p className="text-sm text-admin-muted">{a.classLabel}</p>
                  <div className="mt-1.5">
                    <AssetBadges asset={a} />
                  </div>
                </td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>
                  {formatDateShort(a.inServiceDate)}
                </td>
                <td className={cn(TD_CLS, "text-right whitespace-nowrap")}>
                  {formatNZD(a.costBase)}
                </td>
                <td className={cn(TD_CLS, "text-right")}>{a.businessUsePct}%</td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>{rateText(a)}</td>
                <td className={cn(TD_CLS, "text-right font-bold whitespace-nowrap")}>
                  {claimText(a)}
                </td>
                <td className={cn(TD_CLS, "text-right whitespace-nowrap")}>{valueText(a)}</td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>
                  <AssetActions
                    asset={a}
                    onSchedule={onSchedule}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
