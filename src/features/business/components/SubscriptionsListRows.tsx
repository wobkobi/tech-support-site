"use client";
// src/features/business/components/SubscriptionsListRows.tsx
// The subscriptions list, as cards below lg and a table from lg, with overdue rows tinted
// amber and the Active pill doubling as the pause/activate toggle. SubscriptionsView owns
// the data, the form, the record/toggle/delete handlers and the delete confirm.

import {
  PINNED_CELL_CLS,
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { LEDGER_TD_CLS, LEDGER_TH_CLS } from "@/features/business/components/ledger-classes";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import type { Subscription } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/** Props shared by the card list and the table. */
interface SubscriptionRowsProps {
  subs: Subscription[];
  /** Id of the subscription whose payment is being recorded, or null. */
  recording: string | null;
  /** Id of the subscription being deleted, or null. */
  deleting: string | null;
  onRecord: (sub: Subscription) => void;
  onToggleActive: (sub: Subscription) => void;
  onEdit: (sub: Subscription) => void;
  /** Opens the delete confirm. */
  onDelete: (sub: Subscription) => void;
}

/**
 * Returns true if the subscription's next due date is in the past.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is overdue.
 */
function isOverdue(nextDue: string): boolean {
  return new Date(nextDue) < new Date(todayISO());
}

/**
 * Returns true if the subscription's next due date is today.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is due today.
 */
function isDueToday(nextDue: string): boolean {
  return nextDue.startsWith(todayISO());
}

/**
 * The Active / Paused / Overdue pill, which also pauses or activates the subscription.
 * @param props - Component props.
 * @param props.sub - The subscription.
 * @param props.overdue - Whether it is active and past due.
 * @param props.onToggleActive - Flips its active flag.
 * @param props.className - Extra classes on the button.
 * @returns The toggle button.
 */
function ActiveToggle({
  sub,
  overdue,
  onToggleActive,
  className,
}: {
  sub: Subscription;
  overdue: boolean;
  onToggleActive: (sub: Subscription) => void;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onToggleActive(sub)}
      className={className}
      title={sub.isActive ? "Click to pause" : "Click to activate"}
    >
      <StatusPill tone={!sub.isActive ? "neutral" : overdue ? "critical" : "success"}>
        {!sub.isActive ? "Paused" : overdue ? "Overdue" : "Active"}
      </StatusPill>
    </button>
  );
}

/**
 * Record (the positive action), Edit and Delete for one subscription.
 * @param props - Component props.
 * @param props.sub - The subscription.
 * @param props.recording - Id whose payment is being recorded.
 * @param props.deleting - Id being deleted.
 * @param props.onRecord - Records a payment.
 * @param props.onEdit - Opens the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The three buttons.
 */
function SubscriptionRowActions({
  sub,
  recording,
  deleting,
  onRecord,
  onEdit,
  onDelete,
}: Omit<SubscriptionRowsProps, "subs" | "onToggleActive"> & {
  sub: Subscription;
}): React.ReactElement {
  return (
    <>
      <AdminButton
        size="xs"
        variant="outline"
        onClick={() => onRecord(sub)}
        disabled={recording === sub.id}
      >
        {recording === sub.id ? "Recording..." : "Record"}
      </AdminButton>
      {/* Edit and Delete wrap as a pair, so a wrapped row never splits them. */}
      <span className="flex gap-2">
        <AdminButton size="xs" variant="secondary" onClick={() => onEdit(sub)}>
          Edit
        </AdminButton>
        <AdminButton
          size="xs"
          variant="danger"
          onClick={() => onDelete(sub)}
          disabled={deleting === sub.id}
        >
          Delete
        </AdminButton>
      </span>
    </>
  );
}

/**
 * Phone card list - the desktop table is too wide for phones with seven columns
 * including the action buttons.
 * @param props - Component props.
 * @param props.subs - Subscriptions to list.
 * @param props.recording - Id whose payment is being recorded.
 * @param props.deleting - Id being deleted.
 * @param props.onRecord - Records a payment.
 * @param props.onToggleActive - Pauses or activates a subscription.
 * @param props.onEdit - Opens the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The cards, hidden from lg.
 */
export function SubscriptionsListCards({
  subs,
  onToggleActive,
  ...actions
}: SubscriptionRowsProps): React.ReactElement {
  return (
    <div className="space-y-2 lg:hidden">
      {subs.map((sub) => {
        const overdue = sub.isActive && isOverdue(sub.nextDue);
        const dueToday = sub.isActive && isDueToday(sub.nextDue);
        return (
          <Card
            key={sub.id}
            padding="sm"
            className={cn(
              overdue ? "border-amber-300 bg-amber-50" : dueToday ? "bg-amber-50/50" : "",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold text-admin-text">
                  {sub.description}
                </p>
                <p className="truncate text-sm text-admin-muted">{sub.supplier}</p>
              </div>
              <p className="shrink-0 text-[0.9375rem] font-semibold text-admin-text">
                {formatNZD(sub.amountIncl)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-admin-muted capitalize">{sub.frequency}</span>
              <span
                className={cn(
                  overdue || dueToday ? "font-semibold text-amber-700" : "text-admin-muted",
                )}
              >
                Due {formatDateShort(sub.nextDue)}
                {overdue && " (overdue)"}
              </span>
              <ActiveToggle
                sub={sub}
                overdue={overdue}
                onToggleActive={onToggleActive}
                className="ml-auto"
              />
            </div>
            {sub.notes && <p className="mt-1 truncate text-sm text-admin-muted">{sub.notes}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <SubscriptionRowActions sub={sub} {...actions} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Desktop table. The Actions column is pinned right so Record, Edit and Delete stay
 * reachable when the table scrolls sideways; its background repeats the row's tint
 * (an amber layer over an opaque surface for the half-tint) so scrolled cells pass under.
 * @param props - Component props.
 * @param props.subs - Subscriptions to list.
 * @param props.recording - Id whose payment is being recorded.
 * @param props.deleting - Id being deleted.
 * @param props.onRecord - Records a payment.
 * @param props.onToggleActive - Pauses or activates a subscription.
 * @param props.onEdit - Opens the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The table, shown from lg.
 */
export function SubscriptionsListTable({
  subs,
  onToggleActive,
  ...actions
}: SubscriptionRowsProps): React.ReactElement {
  return (
    <Card padding="none" className="hidden overflow-x-auto lg:block">
      <table className={TABLE_CLS}>
        <thead className={THEAD_CLS}>
          <tr>
            <th className={LEDGER_TH_CLS}>Description</th>
            <th className={LEDGER_TH_CLS}>Supplier</th>
            <th className={LEDGER_TH_CLS}>Amount</th>
            <th className={LEDGER_TH_CLS}>Frequency</th>
            <th className={LEDGER_TH_CLS}>Next due</th>
            <th className={LEDGER_TH_CLS}>Active</th>
            <th className={cn(LEDGER_TH_CLS, PINNED_CELL_CLS, "bg-admin-bg")}>Actions</th>
          </tr>
        </thead>
        <tbody className={TBODY_CLS}>
          {subs.map((sub) => {
            const overdue = sub.isActive && isOverdue(sub.nextDue);
            const dueToday = sub.isActive && isDueToday(sub.nextDue);
            return (
              <tr
                key={sub.id}
                className={
                  overdue ? "bg-amber-50" : dueToday ? "bg-amber-50/50" : cn(ROW_CLS, "group")
                }
              >
                <td className={cn(LEDGER_TD_CLS, "font-medium text-admin-text")}>
                  {sub.description}
                  {sub.notes && (
                    <span className="ml-1 text-sm font-normal text-admin-muted">({sub.notes})</span>
                  )}
                </td>
                <td className={cn(LEDGER_TD_CLS, "text-admin-text-secondary")}>{sub.supplier}</td>
                <td className={cn(LEDGER_TD_CLS, "whitespace-nowrap text-admin-text")}>
                  {formatNZD(sub.amountIncl)}
                </td>
                <td className={cn(LEDGER_TD_CLS, "text-admin-text-secondary capitalize")}>
                  {sub.frequency}
                </td>
                <td
                  className={cn(
                    LEDGER_TD_CLS,
                    "whitespace-nowrap",
                    overdue || dueToday
                      ? "font-semibold text-amber-700"
                      : "text-admin-text-secondary",
                  )}
                >
                  {formatDateShort(sub.nextDue)}
                  {overdue && <span className="ml-1 text-sm">(overdue)</span>}
                </td>
                <td className={LEDGER_TD_CLS}>
                  <ActiveToggle sub={sub} overdue={overdue} onToggleActive={onToggleActive} />
                </td>
                <td
                  className={cn(
                    LEDGER_TD_CLS,
                    PINNED_CELL_CLS,
                    "max-xl:w-44",
                    overdue
                      ? "bg-amber-50"
                      : dueToday
                        ? "bg-admin-surface bg-linear-to-r from-amber-50/50 to-amber-50/50"
                        : "bg-admin-surface group-hover:bg-admin-bg",
                  )}
                >
                  {/* Below xl the column narrows and the buttons wrap, so every column fits at 1024px. */}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <SubscriptionRowActions sub={sub} {...actions} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
