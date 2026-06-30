"use client";
// src/features/business/components/calculator/TravelSection.tsx
/**
 * @description Travel address input + per-entry cost list. Lookup populates one
 * auto entry; operators can add manual entries (parking, ferry), all lumped
 * into a single "Travel" invoice line. Auto entries show a step-by-step
 * {@link breakdownTravelCharge} (there/back > raw > rounded > final).
 */
import { formatNZD, travelEntriesTotal } from "@/features/business/lib/business";
import { breakdownTravelCharge } from "@/features/business/lib/pricing-policy";
import type { TravelEntry } from "@/features/business/types/business";
import { parseMoney } from "@/shared/lib/parse-money";
import type React from "react";
import type { RefObject } from "react";

interface Props {
  addressInputRef: RefObject<HTMLInputElement | null>;
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  travelEntries: TravelEntry[];
  onTravelEntriesChange: (entries: TravelEntry[]) => void;
  lookingUpTravel: boolean;
  onLookup: () => void;
  /** Travel-rate $/hr sourced from the Travel RateConfig; used for the operator-side breakdown. */
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
 * @param props.travelRatePerHour - Travel $/hr from the Travel RateConfig.
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
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-russian-violet">Travel</h2>
      <div className="flex gap-2">
        <input
          ref={addressInputRef}
          type="text"
          placeholder="Client address or suburb"
          value={jobAddress}
          autoComplete="off"
          onChange={(e) => onJobAddressChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onLookup();
            }
          }}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
        />
        <button
          type="button"
          onClick={onLookup}
          suppressHydrationWarning
          disabled={lookingUpTravel || !jobAddress.trim()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {lookingUpTravel ? "..." : "Look up"}
        </button>
      </div>

      {travelEntries.length > 0 && (
        <div className="space-y-2">
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
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={entry.label}
                    placeholder={entry.isAuto ? "Lookup" : "e.g. Parking"}
                    onChange={(e) => patchEntry(index, { label: e.target.value, isAuto: false })}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                  />
                  <div className="flex items-center">
                    <span className="rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.cost || ""}
                      onPaste={(e) => {
                        // Only intercept when the clipboard carries a "$",
                        // commas, or other junk; plain numeric pastes fall
                        // through to the native number input so decimal entry
                        // stays unaffected.
                        const text = e.clipboardData.getData("text");
                        if (!/[^\d.]/.test(text)) return;
                        const value = parseMoney(text);
                        if (value === null) return;
                        e.preventDefault();
                        patchEntry(index, {
                          cost: Math.round(value * 100) / 100,
                          isAuto: false,
                        });
                      }}
                      onChange={(e) =>
                        patchEntry(index, {
                          cost: Math.round((parseFloat(e.target.value) || 0) * 100) / 100,
                          isAuto: false,
                        })
                      }
                      className="w-24 rounded-r-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(index)}
                    aria-label={`Remove travel entry ${index + 1}`}
                    className="rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    ×
                  </button>
                </div>
                {breakdown && (
                  <ul className="ml-1 space-y-0.5 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <li>
                      <span className="text-slate-400">Destination:</span>{" "}
                      <span className="text-slate-700">{entry.destination}</span>
                    </li>
                    <li>
                      <span className="text-slate-400">There:</span> {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      <span className="text-slate-400">Back:</span> {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      <span className="text-slate-400">Raw:</span> {roundTripMin} min round trip @{" "}
                      {formatNZD(travelRatePerHour)}/hr ={" "}
                      <span className="text-slate-700">{formatNZD(breakdown.rawCost)}</span>
                    </li>
                    {breakdown.roundedCost !== breakdown.rawCost && (
                      <li>
                        <span className="text-slate-400">Rounded to nearest $5:</span>{" "}
                        <span className="text-slate-700">{formatNZD(breakdown.roundedCost)}</span>
                      </li>
                    )}
                    {breakdown.minimumApplied && (
                      <li>
                        <span className="text-slate-400">
                          {formatNZD(minTravelCharge)} minimum applied
                        </span>{" "}
                        (figure was under {formatNZD(minTravelCharge)}).
                      </li>
                    )}
                    <li>
                      <span className="text-slate-400">Final:</span>{" "}
                      <span className="font-medium text-slate-700">
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

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addEntry}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          + Add travel
        </button>
        {travelEntries.length > 0 && (
          <span className="text-xs text-slate-500">
            Total <span className="font-medium text-slate-700">{formatNZD(total)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
