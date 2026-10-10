"use client";
// src/features/business/components/trips/TripLog.tsx
// The FY's trip log: a table from md up with a km total, stacked cards on phones. Rows
// logged from a job carry a "From a job" tag, and rows that earn no km claim carry a tag
// saying why (before the km-rate car, or no km-rate vehicle that day); edit and delete
// hand the row to TripsView.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { formatKm, sumTripKm, type TripRow } from "@/features/business/lib/trips";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { FaPlus } from "react-icons/fa6";

/**
 * Why a trip earns no km claim: dated before the first km-rate vehicle went into service
 * (a borrowed or shared car, expected), or on a day with no km-rate vehicle after that.
 */
export type UnclaimedReason = "beforeVehicle" | "noVehicle";

/** Props for {@link TripLog}. */
interface TripLogProps {
  /** Trips in the FY, newest first. */
  trips: readonly TripRow[];
  /** Trips that earn no km claim, by id, with the reason each one shows. */
  unclaimed: ReadonlyMap<string, UnclaimedReason>;
  /** FY display label for the empty state. */
  fyLabel: string;
  /** Opens the add dialog. */
  onAdd: () => void;
  /** Opens the edit dialog for a trip. */
  onEdit: (trip: TripRow) => void;
  /** Asks to delete a trip. */
  onDelete: (trip: TripRow) => void;
}

/**
 * Status pills for one trip: "From a job" when it was logged from a booking, and a "Not
 * claimed" pill when its km earn nothing. A trip before the km-rate car is expected, so
 * it gets a neutral pill; a gap after it is a warning. The words carry the meaning; the
 * colour only backs them up.
 * @param props - Component props.
 * @param props.trip - The trip.
 * @param props.unclaimed - Why the trip earns no km claim, or undefined when it does.
 * @param props.className - Extra classes (spacing differs between table and card).
 * @returns The pills, or null when the trip has neither.
 */
function TripTags({
  trip,
  unclaimed,
  className,
}: {
  trip: TripRow;
  unclaimed: UnclaimedReason | undefined;
  className?: string;
}): React.ReactElement | null {
  if (!trip.bookingId && !unclaimed) return null;
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {trip.bookingId && <StatusPill tone="info">From a job</StatusPill>}
      {unclaimed === "beforeVehicle" && (
        <StatusPill tone="neutral">Not claimed: before your km-rate car</StatusPill>
      )}
      {unclaimed === "noVehicle" && (
        <StatusPill tone="warning">Not claimed: no km-rate vehicle</StatusPill>
      )}
    </span>
  );
}

/**
 * Edit and Delete for one trip.
 * @param props - Component props.
 * @param props.trip - The trip.
 * @param props.onEdit - Opens the edit dialog.
 * @param props.onDelete - Asks to delete.
 * @returns The button pair.
 */
function RowActions({
  trip,
  onEdit,
  onDelete,
}: {
  trip: TripRow;
  onEdit: (trip: TripRow) => void;
  onDelete: (trip: TripRow) => void;
}): React.ReactElement {
  const when = formatDateShort(trip.date);
  return (
    <div className="flex justify-end gap-2">
      <AdminButton
        variant="secondary"
        onClick={() => onEdit(trip)}
        aria-label={`Edit trip on ${when}`}
      >
        Edit
      </AdminButton>
      <AdminButton
        variant="danger"
        onClick={() => onDelete(trip)}
        aria-label={`Delete trip on ${when}`}
      >
        Delete
      </AdminButton>
    </div>
  );
}

/**
 * The trip log card.
 * @param props - Component props.
 * @param props.trips - Trips in the FY.
 * @param props.unclaimed - Trips that earn no km claim, with the reason.
 * @param props.fyLabel - FY display label.
 * @param props.onAdd - Opens the add dialog.
 * @param props.onEdit - Opens the edit dialog.
 * @param props.onDelete - Asks to delete a trip.
 * @returns The card element.
 */
export function TripLog({
  trips,
  unclaimed,
  fyLabel,
  onAdd,
  onEdit,
  onDelete,
}: TripLogProps): React.ReactElement {
  return (
    <Card padding="none">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHeader
          title="Trip log"
          description="Business trips this year. Km is the whole round trip."
          actions={
            <AdminButton onClick={onAdd}>
              <FaPlus aria-hidden />
              Add trip
            </AdminButton>
          }
        />
      </div>
      {trips.length === 0 ? (
        <EmptyState
          title={`No trips logged for ${fyLabel}`}
          body="Add a trip, or add one from the jobs list above."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto border-t border-admin-border md:block">
            <table className={TABLE_CLS}>
              <caption className="sr-only">Trips in {fyLabel}</caption>
              <thead className={THEAD_CLS}>
                <tr>
                  <th scope="col" className={TH_CLS}>
                    Date
                  </th>
                  <th scope="col" className={TH_CLS}>
                    Purpose
                  </th>
                  <th scope="col" className={cn(TH_CLS, "text-right")}>
                    Km
                  </th>
                  <th scope="col" className={cn(TH_CLS, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {trips.map((t) => (
                  <tr key={t.id} className={ROW_CLS}>
                    <td className={cn(TD_CLS, "whitespace-nowrap")}>{formatDateShort(t.date)}</td>
                    <td className={TD_CLS}>
                      <p className="font-semibold text-admin-text">{t.purpose}</p>
                      <TripTags trip={t} unclaimed={unclaimed.get(t.id)} className="mt-1.5" />
                      {t.notes && <p className="mt-0.5 text-sm text-admin-muted">{t.notes}</p>}
                    </td>
                    <td className={cn(TD_CLS, "text-right whitespace-nowrap tabular-nums")}>
                      {formatKm(t.km)}
                    </td>
                    <td className={TD_CLS}>
                      <RowActions trip={t} onEdit={onEdit} onDelete={onDelete} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-admin-border">
                <tr>
                  <td colSpan={2} className={cn(TD_CLS, "font-bold")}>
                    Total
                  </td>
                  <td className={cn(TD_CLS, "text-right font-bold whitespace-nowrap tabular-nums")}>
                    {formatKm(sumTripKm(trips))}
                  </td>
                  <td className={TD_CLS} />
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="divide-y divide-admin-border border-t border-admin-border md:hidden">
            {trips.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-admin-text">{t.purpose}</p>
                    <p className="text-sm text-admin-text-secondary">{formatDateShort(t.date)}</p>
                  </div>
                  <p className="shrink-0 font-bold text-admin-text tabular-nums">
                    {formatKm(t.km)}
                  </p>
                </div>
                <TripTags trip={t} unclaimed={unclaimed.get(t.id)} className="mt-1.5" />
                {t.notes && <p className="mt-1 text-sm text-admin-muted">{t.notes}</p>}
                <div className="mt-2">
                  <RowActions trip={t} onEdit={onEdit} onDelete={onDelete} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
