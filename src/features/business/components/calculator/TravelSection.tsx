"use client";

import type React from "react";
import type { RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, travelEntriesTotal } from "@/features/business/lib/business";
import { breakdownTravelCharge } from "@/features/business/lib/pricing-policy";
import type { TravelEntry } from "@/features/business/types/business";

interface Props {
  addressInputRef: RefObject<HTMLInputElement | null>;
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  travelEntries: TravelEntry[];
  onTravelEntriesChange: (entries: TravelEntry[]) => void;
  lookingUpTravel: boolean;
  onLookup: () => void;
  /** Travel-rate $/h sourced from the Travel RateConfig; used for the operator-side breakdown. */
  travelRatePerHour: number;
  /** Travel floor (live pricing setting) applied to the breakdown + minimum note. */
  minTravelCharge: number;
}

/**
 * Travel address input + per-entry travel cost list. Lookup populates a single
 * auto entry; operators can add manual entries (parking, ferry). Every entry
 * lumps into one "Travel" invoice line. Auto entries also show a step-by-step
 * breakdown (destination > there/back > raw > rounded > final) so the operator
 * can see exactly how the figure was derived.
 * @param props - Component props.
 * @param props.addressInputRef - Ref the parent attaches Maps autocomplete to.
 * @param props.jobAddress - Current address text.
 * @param props.onJobAddressChange - Address change handler.
 * @param props.travelEntries - All travel charges (auto + manual).
 * @param props.onTravelEntriesChange - Replaces the entries array.
 * @param props.lookingUpTravel - True while a lookup is in flight.
 * @param props.onLookup - "Look up" / Enter handler.
 * @param props.travelRatePerHour - Travel $/h from the Travel RateConfig.
 * @param props.minTravelCharge - Travel floor (live pricing setting).
 * @returns Travel section element.
 */
export function TravelSection({
  addressInputRef,
  jobAddress,
  onJobAddressChange,
  travelEntries,
  onTravelEntriesChange,
  lookingUpTravel,
  onLookup,
  travelRatePerHour,
  minTravelCharge,
}: Props): React.ReactElement {
  const total = travelEntriesTotal(travelEntries);

  /**
   * Updates a single entry by index.
   * @param index - Entry index to patch.
   * @param patch - Partial fields to merge.
   */
  function patchEntry(index: number, patch: Partial<TravelEntry>): void {
    onTravelEntriesChange(travelEntries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  /** Appends a blank manual entry. */
  function addEntry(): void {
    onTravelEntriesChange([...travelEntries, { label: "", cost: 0 }]);
  }

  /**
   * Removes the entry at `index`.
   * @param index - Entry index to drop.
   */
  function removeEntry(index: number): void {
    onTravelEntriesChange(travelEntries.filter((_, i) => i !== index));
  }

  return (
    <div className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet text-sm font-semibold")}>Travel</h2>
      <div className={cn("flex gap-2")}>
        <input
          ref={addressInputRef}
          type="text"
          placeholder="Client address or suburb"
          value={jobAddress}
          onChange={(e) => onJobAddressChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onLookup();
            }
          }}
          className={cn(
            "focus:ring-russian-violet/30 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
          )}
        />
        <button
          type="button"
          onClick={onLookup}
          suppressHydrationWarning
          disabled={lookingUpTravel || !jobAddress.trim()}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
          )}
        >
          {lookingUpTravel ? "..." : "Look up"}
        </button>
      </div>

      {travelEntries.length > 0 && (
        <div className={cn("space-y-2")}>
          {travelEntries.map((entry, index) => {
            const showBreakdown =
              entry.isAuto &&
              entry.destination !== undefined &&
              entry.durationMinsOneWay !== undefined &&
              entry.durationMinsOneWay > 0;
            const oneWayMin = entry.durationMinsOneWay ?? 0;
            const roundTripMin = oneWayMin * 2;
            const breakdown = showBreakdown
              ? breakdownTravelCharge(oneWayMin, travelRatePerHour, minTravelCharge)
              : null;
            return (
              <div key={index} className={cn("space-y-1")}>
                <div className={cn("flex items-center gap-2")}>
                  <input
                    type="text"
                    value={entry.label}
                    placeholder={entry.isAuto ? "Lookup" : "e.g. Parking"}
                    onChange={(e) => patchEntry(index, { label: e.target.value, isAuto: false })}
                    className={cn(
                      "focus:ring-russian-violet/30 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                    )}
                  />
                  <div className={cn("flex items-center")}>
                    <span
                      className={cn(
                        "rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-500",
                      )}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.cost}
                      onChange={(e) =>
                        patchEntry(index, {
                          cost: Math.round((parseFloat(e.target.value) || 0) * 100) / 100,
                          isAuto: false,
                        })
                      }
                      className={cn(
                        "focus:ring-russian-violet/30 w-24 rounded-r-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(index)}
                    aria-label={`Remove travel entry ${index + 1}`}
                    className={cn(
                      "rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50",
                    )}
                  >
                    ×
                  </button>
                </div>
                {breakdown && (
                  <ul
                    className={cn(
                      "ml-1 space-y-0.5 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500",
                    )}
                  >
                    <li>
                      <span className={cn("text-slate-400")}>Destination:</span>{" "}
                      <span className={cn("text-slate-700")}>{entry.destination}</span>
                    </li>
                    <li>
                      <span className={cn("text-slate-400")}>There:</span> {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      <span className={cn("text-slate-400")}>Back:</span> {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      <span className={cn("text-slate-400")}>Raw:</span> {roundTripMin} min round
                      trip @ {formatNZD(travelRatePerHour)}/h ={" "}
                      <span className={cn("text-slate-700")}>{formatNZD(breakdown.rawCost)}</span>
                    </li>
                    {breakdown.roundedCost !== breakdown.rawCost && (
                      <li>
                        <span className={cn("text-slate-400")}>Rounded to nearest $5:</span>{" "}
                        <span className={cn("text-slate-700")}>
                          {formatNZD(breakdown.roundedCost)}
                        </span>
                      </li>
                    )}
                    {breakdown.minimumApplied && (
                      <li>
                        <span className={cn("text-slate-400")}>
                          {formatNZD(minTravelCharge)} minimum applied
                        </span>{" "}
                        (figure was under {formatNZD(minTravelCharge)}).
                      </li>
                    )}
                    <li>
                      <span className={cn("text-slate-400")}>Final:</span>{" "}
                      <span className={cn("font-medium text-slate-700")}>
                        {formatNZD(breakdown.finalCost)}
                      </span>
                    </li>
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={cn("flex items-center justify-between gap-3")}>
        <button
          type="button"
          onClick={addEntry}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
          )}
        >
          + Add travel
        </button>
        {travelEntries.length > 0 && (
          <span className={cn("text-xs text-slate-500")}>
            Total <span className={cn("font-medium text-slate-700")}>{formatNZD(total)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
