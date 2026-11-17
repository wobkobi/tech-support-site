"use client";
// src/features/business/components/trips/TripSuggestions.tsx
// "Jobs without a trip": completed jobs in the FY with no trip logged. Each row takes
// round-trip km (prefilled or fetched from Google) and adds a trip linked to the booking, or
// is marked "Not a trip" (walked there) and listed apart, where it can be put back.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { formatMins } from "@/features/business/lib/business-format";
import { MAX_TRIP_KM, type TripSuggestion } from "@/features/business/lib/trips";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

/** Props for {@link TripSuggestions}. */
interface TripSuggestionsProps {
  /** Jobs still waiting for a trip, newest first. */
  suggestions: readonly TripSuggestion[];
  /** Jobs marked "Not a trip", newest first. */
  dismissed: readonly TripSuggestion[];
  /** Booking whose "Not a trip" or "Put back" is in flight, or null. */
  togglingId: string | null;
  /** Marks a job "Not a trip" (true) or puts it back on the list (false). */
  onNotATrip: (suggestion: TripSuggestion, notATrip: boolean) => void;
  /** First day of the first km-rate car (ISO); earlier jobs aren't listed. Null when none. */
  listedFrom: string | null;
  /** Km typed per job, by booking id. */
  kmDrafts: Readonly<Record<string, string>>;
  /** Booking whose Add is in flight, or null. */
  addingId: string | null;
  /** True while "Add all" runs. */
  addingAll: boolean;
  /** Booking whose Google km lookup is in flight, or null. */
  lookingUpId: string | null;
  /** Called as km is typed for a job. */
  onDraftChange: (bookingId: string, value: string) => void;
  /** Fills one job's km from Google Maps. */
  onLookUp: (suggestion: TripSuggestion) => void;
  /** Adds one job's trip. */
  onAdd: (suggestion: TripSuggestion) => void;
  /** Adds every job that has km filled in. */
  onAddAll: () => void;
  /** Which year the jobs are from: "this year" for the current FY, "in FY 2025-26" otherwise. */
  yearPhrase: string;
  className?: string;
}

/**
 * Hint under a job: booked drive time, where a prefilled km came from, and any no-show reason.
 * @param s - The suggestion.
 * @returns The hint text, or "" when there is nothing to add.
 */
function hintFor(s: TripSuggestion): string {
  const parts: string[] = [];
  if (s.travelMins !== null) {
    parts.push(`Booked drive about ${formatMins(s.travelMins)} there and back`);
  }
  if (s.addressFromContact) parts.push("Address from their contact");
  if (s.suggestedKm !== null) parts.push("Km from your last trip to this address");
  if (s.noShow) parts.push("No-show, but you still drove there");
  return parts.join(". ");
}

/**
 * The jobs-without-a-trip card.
 * @param props - Component props.
 * @param props.suggestions - Jobs still waiting for a trip.
 * @param props.dismissed - Jobs marked "Not a trip".
 * @param props.togglingId - Booking whose "Not a trip" or "Put back" is in flight.
 * @param props.onNotATrip - Marks a job "Not a trip", or puts it back.
 * @param props.listedFrom - First day of the first km-rate car, or null.
 * @param props.kmDrafts - Km typed per job.
 * @param props.addingId - Booking whose Add is in flight.
 * @param props.addingAll - Whether "Add all" is running.
 * @param props.lookingUpId - Booking whose Google km lookup is in flight.
 * @param props.onDraftChange - Km input change handler.
 * @param props.onLookUp - Fills one job's km from Google Maps.
 * @param props.onAdd - Adds one job's trip.
 * @param props.onAddAll - Adds every job with km filled in.
 * @param props.yearPhrase - Which year the jobs are from, worked into the copy.
 * @param props.className - Extra classes on the card.
 * @returns The card element.
 */
export function TripSuggestions({
  suggestions,
  dismissed,
  togglingId,
  onNotATrip,
  listedFrom,
  kmDrafts,
  addingId,
  addingAll,
  lookingUpId,
  onDraftChange,
  onLookUp,
  onAdd,
  onAddAll,
  yearPhrase,
  className,
}: TripSuggestionsProps): React.ReactElement {
  const busy = addingAll || addingId !== null;
  const [showDismissed, setShowDismissed] = useState(false);
  const fromNote = listedFrom
    ? ` Jobs before ${formatDateShort(listedFrom)} aren't listed: the car then wasn't on km rates.`
    : "";
  return (
    <Card padding="none" className={className}>
      {/* No bottom margin: the header's rule doubles as the first row's top edge. */}
      <CardHeader
        title="Jobs without a trip"
        description={`Completed jobs ${yearPhrase} with no trip logged. Each job is one round trip: get the km from Google or type it, then add it. Walked there? Mark it Not a trip.${fromNote}`}
        actions={
          suggestions.length > 0 ? (
            <AdminButton
              variant="outline"
              onClick={onAddAll}
              busy={addingAll}
              disabled={addingId !== null || togglingId !== null}
            >
              Add all
            </AdminButton>
          ) : undefined
        }
        className="mb-0"
      />
      {suggestions.length === 0 ? (
        <EmptyState
          title="No jobs waiting"
          body={
            dismissed.length > 0
              ? `Every other completed job ${yearPhrase} has a trip logged.`
              : `Every completed job ${yearPhrase} has a trip logged.`
          }
        />
      ) : (
        <ul className="divide-y divide-admin-border">
          {suggestions.map((s) => {
            const inputId = `trip-km-${s.bookingId}`;
            const hint = hintFor(s);
            return (
              <li
                key={s.bookingId}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-admin-text">{s.name}</p>
                  <p className="text-sm text-admin-text-secondary">
                    {formatDateShort(s.date)}
                    {s.address ? `, ${s.address}` : ""}
                  </p>
                  {hint && <p className="mt-0.5 text-sm text-admin-muted">{hint}</p>}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {s.address && (
                    <AdminButton
                      variant="outline"
                      onClick={() => onLookUp(s)}
                      busy={lookingUpId === s.bookingId}
                      disabled={lookingUpId !== null && lookingUpId !== s.bookingId}
                      aria-label={`Get km from Google for ${s.name}`}
                    >
                      Get km
                    </AdminButton>
                  )}
                  <AdminField label="Km (round trip)" htmlFor={inputId} className="w-36">
                    <AdminInput
                      id={inputId}
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={MAX_TRIP_KM}
                      step={0.1}
                      // Every row shares the visible label, so the name carries the job.
                      aria-label={`Km (round trip) for ${s.name}`}
                      value={kmDrafts[s.bookingId] ?? ""}
                      onChange={(e) => onDraftChange(s.bookingId, e.target.value)}
                      className="h-10"
                    />
                  </AdminField>
                  <AdminButton
                    variant="secondary"
                    onClick={() => onAdd(s)}
                    busy={addingId === s.bookingId}
                    disabled={(busy && addingId !== s.bookingId) || togglingId === s.bookingId}
                    aria-label={`Add trip for ${s.name}`}
                  >
                    Add
                  </AdminButton>
                  <AdminButton
                    variant="ghost"
                    onClick={() => onNotATrip(s, true)}
                    busy={togglingId === s.bookingId}
                    disabled={busy || (togglingId !== null && togglingId !== s.bookingId)}
                    aria-label={`Not a trip: ${s.name}`}
                  >
                    Not a trip
                  </AdminButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dismissed.length > 0 && (
        <div className="border-t border-admin-border px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            aria-expanded={showDismissed}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-admin-text-secondary hover:text-admin-text"
          >
            {showDismissed ? "Hide" : "Show"} {dismissed.length} marked not a trip
            <span className="text-admin-muted">{showDismissed ? "▲" : "▼"}</span>
          </button>
          {showDismissed && (
            <ul className="mt-2 divide-y divide-admin-border">
              {dismissed.map((s) => (
                <li key={s.bookingId} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-admin-text">{s.name}</p>
                    <p className="text-sm text-admin-text-secondary">
                      {formatDateShort(s.date)}
                      {s.address ? `, ${s.address}` : ""}
                    </p>
                  </div>
                  <AdminButton
                    variant="secondary"
                    size="xs"
                    onClick={() => onNotATrip(s, false)}
                    busy={togglingId === s.bookingId}
                    disabled={togglingId !== null && togglingId !== s.bookingId}
                    aria-label={`Put ${s.name} back on the list`}
                  >
                    Put back
                  </AdminButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
