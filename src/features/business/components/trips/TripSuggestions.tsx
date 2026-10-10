"use client";
// src/features/business/components/trips/TripSuggestions.tsx
// "Jobs without a trip": completed jobs in the FY with no trip logged. Each row takes the
// round-trip km (prefilled from the last trip to the same address when there is one) and
// adds a trip linked to the booking; "Add all" adds every row that has km filled in.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { formatMins } from "@/features/business/lib/business-format";
import { MAX_TRIP_KM, type TripSuggestion } from "@/features/business/lib/trips";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/** Props for {@link TripSuggestions}. */
interface TripSuggestionsProps {
  /** Jobs still waiting for a trip, newest first. */
  suggestions: readonly TripSuggestion[];
  /** Km typed per job, by booking id. */
  kmDrafts: Readonly<Record<string, string>>;
  /** Booking whose Add is in flight, or null. */
  addingId: string | null;
  /** True while "Add all" runs. */
  addingAll: boolean;
  /** Called as km is typed for a job. */
  onDraftChange: (bookingId: string, value: string) => void;
  /** Adds one job's trip. */
  onAdd: (suggestion: TripSuggestion) => void;
  /** Adds every job that has km filled in. */
  onAddAll: () => void;
  /** Which year the jobs are from: "this year" for the current FY, "in FY 2025-26" otherwise. */
  yearPhrase: string;
  className?: string;
}

/**
 * Hint under a job: the booked drive time, where a prefilled km came from, and the
 * no-show reason it is listed at all.
 * @param s - The suggestion.
 * @returns The hint text, or "" when there is nothing to add.
 */
function hintFor(s: TripSuggestion): string {
  const parts: string[] = [];
  if (s.travelMins !== null) {
    parts.push(`Booked drive about ${formatMins(s.travelMins)} there and back`);
  }
  if (s.suggestedKm !== null) parts.push("Km from your last trip to this address");
  if (s.noShow) parts.push("No-show, but you still drove there");
  return parts.join(". ");
}

/**
 * The jobs-without-a-trip card.
 * @param props - Component props.
 * @param props.suggestions - Jobs still waiting for a trip.
 * @param props.kmDrafts - Km typed per job.
 * @param props.addingId - Booking whose Add is in flight.
 * @param props.addingAll - Whether "Add all" is running.
 * @param props.onDraftChange - Km input change handler.
 * @param props.onAdd - Adds one job's trip.
 * @param props.onAddAll - Adds every job with km filled in.
 * @param props.yearPhrase - Which year the jobs are from, worked into the copy.
 * @param props.className - Extra classes on the card.
 * @returns The card element.
 */
export function TripSuggestions({
  suggestions,
  kmDrafts,
  addingId,
  addingAll,
  onDraftChange,
  onAdd,
  onAddAll,
  yearPhrase,
  className,
}: TripSuggestionsProps): React.ReactElement {
  const busy = addingAll || addingId !== null;
  return (
    <Card padding="none" className={className}>
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHeader
          title="Jobs without a trip"
          description={`Completed jobs ${yearPhrase} with no trip logged. Each job is one round trip: enter the km there and back, then add it.`}
          actions={
            suggestions.length > 0 ? (
              <AdminButton
                variant="outline"
                onClick={onAddAll}
                busy={addingAll}
                disabled={addingId !== null}
              >
                Add all
              </AdminButton>
            ) : undefined
          }
        />
      </div>
      {suggestions.length === 0 ? (
        <EmptyState
          title="No jobs waiting"
          body={`Every completed job ${yearPhrase} has a trip logged.`}
        />
      ) : (
        <ul className="divide-y divide-admin-border border-t border-admin-border">
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
                <div className="flex items-end gap-2">
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
                    disabled={busy && addingId !== s.bookingId}
                    aria-label={`Add trip for ${s.name}`}
                  >
                    Add
                  </AdminButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
