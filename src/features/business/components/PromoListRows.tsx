"use client";
// src/features/business/components/PromoListRows.tsx
// The admin promo list: a table from sm, stacked cards on phones. Markup only; the list
// state and every row action handler live in PromosView.

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
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
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { ROW_BUTTON_CLS } from "@/features/business/components/ledger-classes";
import {
  describeDiscount,
  getStatus,
  overlapNote,
  statusLabel,
  statusTone,
  usageNote,
  type PromoStats,
} from "@/features/business/components/promo-list-helpers";
import { formatNZD } from "@/features/business/lib/business";
import { endIsoToInclusiveDate } from "@/features/business/lib/promo-form";
import { describeRecurringWindow } from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import React from "react";

/** Grey tag naming one restriction on a promo. */
const PROMO_TAG_CLS = "rounded bg-admin-bg px-1.5 py-0.5 text-sm font-semibold text-admin-muted";

/** Props for {@link PromoStatsBlock}. */
interface PromoStatsBlockProps {
  /** The promo being reported on. */
  promo: PromoRow;
  /** Its redemption totals, or undefined when it has none. */
  stats: PromoStats | undefined;
}

/**
 * Usage detail for one promo: how often it was redeemed, what it gave away, and
 * how much of its cap is left.
 *
 * Deliberately answers only what the redemption rows can support. Whether the
 * promo caused the bookings is not knowable from this data, and a number
 * implying it were would be worse than no number.
 * @param props - Component props.
 * @param props.promo - The promo being reported on.
 * @param props.stats - Its redemption totals.
 * @returns The stats block.
 */
function PromoStatsBlock({ promo, stats }: PromoStatsBlockProps): React.ReactElement {
  const used = stats?.redemptions ?? 0;
  const rows: [string, string][] = [["Redemptions", String(used)]];

  if (promo.maxRedemptions != null) {
    const left = Math.max(0, promo.maxRedemptions - used);
    rows.push([
      "Cap",
      `${used} of ${promo.maxRedemptions} used, ${left} left${left === 0 ? " - the promo will no longer apply" : ""}`,
    ]);
  }
  if (promo.perCustomerLimit != null) {
    rows.push(["Per customer", `${promo.perCustomerLimit} max`]);
  }

  // Unvalued rows are called out rather than counted as zero: a redemption
  // recorded before the value was tracked is not a discount of nothing.
  if (used > 0) {
    const valued = used - (stats?.unvaluedRedemptions ?? 0);
    rows.push([
      "Discount given",
      valued > 0
        ? `${formatNZD(stats?.totalDiscount ?? 0)} across ${valued} of them`
        : "not recorded on any of them",
    ]);
    if (stats?.lastRedeemedAt) {
      rows.push(["Last used", formatDateShort(stats.lastRedeemedAt)]);
    }
  }

  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-admin-bg px-3 py-2 text-sm">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-admin-muted">{label}</dt>
          <dd className="text-admin-text">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Props for {@link PromoChips}. */
interface PromoChipsProps {
  /** The promo the chips describe. */
  promo: PromoRow;
}

/**
 * Marks everything that narrows a promo below "applies to everyone, always".
 *
 * Without these a restricted promo reads as broken in the list: it says Active
 * while the banner stays silent or the discount only lands on some jobs, which
 * is correct but looks like a bug.
 * @param props - Component props.
 * @param props.promo - The promo the chips describe.
 * @returns The chip row, or null when nothing narrows the promo.
 */
function PromoChips({ promo }: PromoChipsProps): React.ReactElement | null {
  const chips: string[] = [];
  if (promo.kind === "code" && promo.code) chips.push(`Code only: ${promo.code}`);
  // Shared with the customer-facing banner so the operator reads the same
  // wording the customer will.
  const window = describeRecurringWindow(promo);
  if (window) chips.push(window);
  if (promo.tiers.length > 0) chips.push(`${promo.tiers.length} spend tiers`);
  else if (promo.minSpend != null) chips.push(`Jobs over $${promo.minSpend}`);
  if (promo.newCustomersOnly) chips.push("New customers only");
  if (promo.maxRedemptions != null) chips.push(`${promo.maxRedemptions} uses total`);
  if (promo.perCustomerLimit != null) chips.push(`${promo.perCustomerLimit} per customer`);
  if (chips.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className={PROMO_TAG_CLS}>
          {chip}
        </span>
      ))}
    </span>
  );
}

/** Props for {@link PromoListRows}. */
interface PromoListRowsProps {
  /** Promos left after the status filter. */
  visiblePromos: PromoRow[];
  /** Every promo, for naming the winner of an overlap. */
  promos: PromoRow[];
  /** Ids of active promos that overlap another. */
  overlaps: Set<string>;
  /** Winning promo id per overlapping promo id. */
  overlapWinners: Map<string, string>;
  /** Redemption totals per promo id. */
  stats: Record<string, PromoStats>;
  /** Ids whose stats block is open. */
  openStats: Set<string>;
  /** Opens or closes a promo's stats block. */
  onToggleStats: (id: string) => void;
  /** Id of the promo whose email draft is opening, if any. */
  emailingId: string | null;
  /** Id of the promo whose social post draft is opening, if any. */
  postingId: string | null;
  /** Starts an email draft for a promo. */
  onEmail: (p: PromoRow) => void;
  /** Starts a social post draft for a promo. */
  onPost: (p: PromoRow) => void;
  /** Flips a promo's isActive. */
  onToggleActive: (p: PromoRow) => void;
  /** Loads a promo into the form for editing. */
  onEdit: (p: PromoRow) => void;
  /** Loads a promo into the form as a new copy. */
  onDuplicate: (p: PromoRow) => void;
  /** Opens the delete confirm for a promo. */
  onDelete: (p: PromoRow) => void;
}

/**
 * Promo list: a table from sm with compact row buttons, stacked cards below it.
 * @param props - Component props.
 * @param props.visiblePromos - Promos left after the status filter.
 * @param props.promos - Every promo, for naming overlap winners.
 * @param props.overlaps - Ids of active promos that overlap another.
 * @param props.overlapWinners - Winning promo id per overlapping promo id.
 * @param props.stats - Redemption totals per promo id.
 * @param props.openStats - Ids whose stats block is open.
 * @param props.onToggleStats - Opens or closes a stats block.
 * @param props.emailingId - Id of the promo whose email draft is opening.
 * @param props.postingId - Id of the promo whose social post draft is opening.
 * @param props.onEmail - Starts an email draft.
 * @param props.onPost - Starts a social post draft.
 * @param props.onToggleActive - Flips isActive.
 * @param props.onEdit - Loads a promo into the form.
 * @param props.onDuplicate - Loads a promo into the form as a copy.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The table and the phone cards.
 */
export function PromoListRows({
  visiblePromos,
  promos,
  overlaps,
  overlapWinners,
  stats,
  openStats,
  onToggleStats,
  emailingId,
  postingId,
  onEmail,
  onPost,
  onToggleActive,
  onEdit,
  onDuplicate,
  onDelete,
}: PromoListRowsProps): React.ReactElement {
  return (
    <>
      {/* Desktop: table */}
      <Card padding="none" className="hidden overflow-x-auto sm:block">
        <table className={TABLE_CLS}>
          <thead className={THEAD_CLS}>
            <tr>
              <th className={TH_CLS}>Title</th>
              <th className={TH_CLS}>Period</th>
              <th className={TH_CLS}>Type</th>
              <th className={TH_CLS}>Status</th>
              <th className={cn(TH_CLS, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {visiblePromos.map((p) => {
              const status = getStatus(p);
              const overlapping = overlaps.has(p.id);
              return (
                <tr key={p.id} className={cn(ROW_CLS, overlapping && "bg-amber-50/50")}>
                  <td className={cn(TD_CLS, "align-top")}>
                    <p className="font-semibold text-admin-text">{p.title}</p>
                    {p.description && <p className="text-sm text-admin-muted">{p.description}</p>}
                    <PromoChips promo={p} />
                    <button
                      type="button"
                      onClick={() => onToggleStats(p.id)}
                      aria-expanded={openStats.has(p.id)}
                      className="mt-0.5 text-left text-sm text-admin-muted underline decoration-dotted hover:text-admin-text"
                    >
                      {usageNote(stats[p.id])}
                    </button>
                    {openStats.has(p.id) && <PromoStatsBlock promo={p} stats={stats[p.id]} />}
                    {overlapping && (
                      <p className="text-sm font-medium text-amber-700">
                        {overlapNote(p, overlapWinners, promos)}
                      </p>
                    )}
                  </td>
                  <td className={cn(TD_CLS, "align-top text-sm text-admin-text-secondary")}>
                    <span className="whitespace-nowrap">{formatDateShort(p.startAt)}</span> -{" "}
                    <span className="whitespace-nowrap">
                      {formatDateShort(endIsoToInclusiveDate(p.endAt))}
                    </span>
                  </td>
                  <td className={cn(TD_CLS, "align-top text-sm text-admin-text")}>
                    {describeDiscount(p)}
                  </td>
                  <td className={cn(TD_CLS, "align-top")}>
                    <StatusPill tone={statusTone(status)}>{statusLabel(status)}</StatusPill>
                  </td>
                  <td className={cn(TD_CLS, "align-top")}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {/* Code promos are never advertised, so only a running
                          automatic one can be emailed or posted. */}
                      {p.kind === "automatic" && status === "active" && (
                        <AdminButton
                          variant="outline"
                          size="xs"
                          className={ROW_BUTTON_CLS}
                          onClick={() => onEmail(p)}
                          disabled={emailingId !== null}
                        >
                          {emailingId === p.id ? "Opening..." : "Email it"}
                        </AdminButton>
                      )}
                      {p.kind === "automatic" && status === "active" && (
                        <AdminButton
                          variant="outline"
                          size="xs"
                          className={ROW_BUTTON_CLS}
                          onClick={() => onPost(p)}
                          disabled={postingId !== null}
                        >
                          {postingId === p.id ? "Opening..." : "Post it"}
                        </AdminButton>
                      )}
                      <AdminButton
                        variant="secondary"
                        size="xs"
                        className={ROW_BUTTON_CLS}
                        onClick={() => onToggleActive(p)}
                      >
                        {p.isActive ? "Disable" : "Enable"}
                      </AdminButton>
                      <AdminButton
                        variant="secondary"
                        size="xs"
                        className={ROW_BUTTON_CLS}
                        onClick={() => onEdit(p)}
                      >
                        Edit
                      </AdminButton>
                      <AdminButton
                        variant="secondary"
                        size="xs"
                        className={ROW_BUTTON_CLS}
                        onClick={() => onDuplicate(p)}
                      >
                        Duplicate
                      </AdminButton>
                      <AdminButton
                        variant="danger"
                        size="xs"
                        className={ROW_BUTTON_CLS}
                        onClick={() => onDelete(p)}
                      >
                        Delete
                      </AdminButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Mobile: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {visiblePromos.map((p) => {
          const status = getStatus(p);
          const overlapping = overlaps.has(p.id);
          return (
            <Card key={p.id} className={cn(overlapping && "border-amber-300 bg-amber-50/40")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-admin-text">{p.title}</p>
                  {p.description && (
                    <p className="mt-0.5 text-sm text-admin-muted">{p.description}</p>
                  )}
                  <PromoChips promo={p} />
                  <button
                    type="button"
                    onClick={() => onToggleStats(p.id)}
                    aria-expanded={openStats.has(p.id)}
                    className="mt-0.5 text-left text-sm text-admin-muted underline decoration-dotted"
                  >
                    {usageNote(stats[p.id])}
                  </button>
                  {openStats.has(p.id) && <PromoStatsBlock promo={p} stats={stats[p.id]} />}
                  {overlapping && (
                    <p className="mt-0.5 text-sm font-medium text-amber-700">
                      {overlapNote(p, overlapWinners, promos)}
                    </p>
                  )}
                </div>
                <StatusPill tone={statusTone(status)} className="shrink-0">
                  {statusLabel(status)}
                </StatusPill>
              </div>

              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-admin-muted">Period</dt>
                <dd className="text-admin-text">
                  {formatDateShort(p.startAt)} - {formatDateShort(endIsoToInclusiveDate(p.endAt))}
                </dd>
                <dt className="text-admin-muted">Type</dt>
                <dd className="text-admin-text">{describeDiscount(p)}</dd>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {p.kind === "automatic" && status === "active" && (
                  <AdminButton
                    variant="outline"
                    busy={emailingId === p.id}
                    disabled={emailingId !== null}
                    onClick={() => onEmail(p)}
                  >
                    Email this promo
                  </AdminButton>
                )}
                {p.kind === "automatic" && status === "active" && (
                  <AdminButton
                    variant="secondary"
                    busy={postingId === p.id}
                    disabled={postingId !== null}
                    onClick={() => onPost(p)}
                  >
                    Post this promo
                  </AdminButton>
                )}
                <AdminButton variant="secondary" onClick={() => onToggleActive(p)}>
                  {p.isActive ? "Disable" : "Enable"}
                </AdminButton>
                <AdminButton variant="secondary" onClick={() => onEdit(p)}>
                  Edit
                </AdminButton>
                <AdminButton variant="secondary" onClick={() => onDuplicate(p)}>
                  Duplicate
                </AdminButton>
                <AdminButton variant="danger" onClick={() => onDelete(p)}>
                  Delete
                </AdminButton>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
