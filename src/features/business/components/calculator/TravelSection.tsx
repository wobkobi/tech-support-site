"use client";
// src/features/business/components/calculator/TravelSection.tsx
// Travel address input + per-entry cost list. Lookup populates one auto entry; operators
// can add manual entries (parking, ferry), all lumped into a single "Round-trip travel"
// invoice line, and store runs (client > store > back mid-job), each billed on its own
// line. Looked-up entries show a step-by-step breakdownTravelCharge (there/back > raw >
// rounded > final).

import { useToast } from "@/features/admin/components/ui/Toast";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { SectionClearButton } from "@/features/business/components/calculator/SectionClearButton";
import { formatNZD, travelEntriesTotal } from "@/features/business/lib/business";
import { lookupStoreRunEntry } from "@/features/business/lib/calculator-helpers";
import { breakdownTravelCharge } from "@/features/business/lib/pricing-policy";
import type { TravelEntry } from "@/features/business/types/business";
import { parseMoney } from "@/shared/lib/parse-money";
import type React from "react";
import { useState } from "react";

interface Props {
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  /** Fired when a Places suggestion is picked (full formatted address). */
  onAddressSelected: (formattedAddress: string) => void;
  travelEntries: TravelEntry[];
  onTravelEntriesChange: React.Dispatch<React.SetStateAction<TravelEntry[]>>;
  lookingUpTravel: boolean;
  onLookup: () => void;
  /** Travel-rate $/hr from the pricing settings; used for the operator-side breakdown. */
  travelRatePerHour: number;
  /** Travel floor (live pricing setting) applied to the breakdown + minimum note. */
  minTravelCharge: number;
}

/**
 * Travel address input + per-entry travel cost list. Lookup populates a single
 * auto entry; operators can add manual entries (parking, ferry), which lump into
 * one "Round-trip travel" invoice line, and store runs, which bill on their own
 * lines. Looked-up entries also show a step-by-step breakdown (destination >
 * there/back > raw > rounded > final) so the operator can see exactly how the
 * figure was derived.
 * @param props - Component props.
 * @param props.jobAddress - Current address text.
 * @param props.onJobAddressChange - Address change handler.
 * @param props.onAddressSelected - Fired when a Places suggestion is picked.
 * @param props.travelEntries - All travel charges (auto + manual).
 * @param props.onTravelEntriesChange - Replaces the entries array.
 * @param props.lookingUpTravel - True while a lookup is in flight.
 * @param props.onLookup - "Look up" / Enter handler.
 * @param props.travelRatePerHour - Travel $/hr from the pricing settings.
 * @param props.minTravelCharge - Travel floor (live pricing setting).
 * @returns Travel section element.
 */
export function TravelSection({
  jobAddress,
  onJobAddressChange,
  onAddressSelected,
  travelEntries,
  onTravelEntriesChange,
  lookingUpTravel,
  onLookup,
  travelRatePerHour,
  minTravelCharge,
}: Props): React.ReactElement {
  const { toast } = useToast();
  // Index of the store run being looked up, or null.
  const [lookingUpRun, setLookingUpRun] = useState<number | null>(null);
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

  /** Appends a blank store run, ready for the store's name. */
  function addStoreRun(): void {
    onTravelEntriesChange([...travelEntries, { label: "", cost: 0, kind: "storeRun" }]);
  }

  /**
   * Times and prices the store run at `index` from the client's address.
   * @param index - Entry index of the store run.
   */
  async function lookUpStoreRun(index: number): Promise<void> {
    const entry = travelEntries[index];
    if (!entry?.label.trim()) return;
    setLookingUpRun(index);
    const result = await lookupStoreRunEntry(jobAddress, entry.label.trim(), travelRatePerHour);
    setLookingUpRun(null);
    if ("error" in result) {
      // A missed lookup is a retry hint (add the suburb), not a failure to keep on screen.
      toast(result.error, { tone: "error", duration: 8000 });
      return;
    }
    // Apply to the latest entries, not this render's snapshot: the operator may have
    // edited, added or removed rows during the lookup. Drop the result if this row no
    // longer holds the store that was looked up.
    const looked = entry.label;
    onTravelEntriesChange((current) =>
      current[index]?.kind === "storeRun" && current[index].label === looked
        ? current.map((e, i) => (i === index ? { ...e, ...result.entry, isParsedCost: false } : e))
        : current,
    );
  }

  /**
   * Removes the entry at `index`.
   * @param index - Entry index to drop.
   */
  function removeEntry(index: number): void {
    onTravelEntriesChange(travelEntries.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-russian-violet">Travel</h2>
        {(travelEntries.length > 0 || jobAddress.trim().length > 0) && (
          <SectionClearButton
            onClear={() => {
              onJobAddressChange("");
              onTravelEntriesChange([]);
            }}
            label="travel"
          />
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <AddressAutocomplete
            id="calculator-job-address"
            value={jobAddress}
            onChange={onJobAddressChange}
            onPlaceSelected={(p) => onAddressSelected(p.formattedAddress)}
            placeholder="Client address or suburb"
            aria-label="Client address or suburb"
            // Only fires with the dropdown closed (the combobox consumes Enter while open).
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onLookup();
              }
            }}
            inputClassName="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
        </div>
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
            const isRun = entry.kind === "storeRun";
            const showBreakdown =
              (entry.isAuto || isRun) &&
              entry.destination !== undefined &&
              entry.durationMinsOneWay !== undefined &&
              entry.durationMinsOneWay > 0;
            const oneWayMin = entry.durationMinsOneWay ?? 0;
            // Legacy drafts predate the return-leg lookup; mirror the outbound figure.
            const backMin = entry.durationMinsBack ?? oneWayMin;
            const roundTripMin = oneWayMin + backMin;
            // The minimum travel charge covers the trip to the client, never a store run.
            const breakdown = showBreakdown
              ? breakdownTravelCharge(
                  oneWayMin,
                  backMin,
                  travelRatePerHour,
                  isRun ? 0 : minTravelCharge,
                )
              : null;
            return (
              <div key={index} className="space-y-1">
                {isRun && (
                  <p className="text-xs font-medium text-slate-500">
                    Store run - from the client&apos;s place and back
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={entry.label}
                    placeholder={
                      isRun
                        ? "Store, e.g. PB Tech St Lukes"
                        : entry.isAuto
                          ? "Lookup"
                          : "e.g. Parking"
                    }
                    aria-label={isRun ? `Store for travel entry ${index + 1}` : undefined}
                    onChange={(e) =>
                      patchEntry(
                        index,
                        isRun
                          ? {
                              // A renamed store makes the looked-up drive stale.
                              label: e.target.value,
                              isParsedCost: false,
                              destination: undefined,
                              durationMinsOneWay: undefined,
                              durationMinsBack: undefined,
                              distanceKmOneWay: undefined,
                            }
                          : { label: e.target.value, isAuto: false, isParsedCost: false },
                      )
                    }
                    onKeyDown={(e) => {
                      if (isRun && e.key === "Enter") {
                        e.preventDefault();
                        void lookUpStoreRun(index);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                  />
                  {isRun && (
                    <button
                      type="button"
                      onClick={() => void lookUpStoreRun(index)}
                      disabled={lookingUpRun !== null || !entry.label.trim() || !jobAddress.trim()}
                      title={
                        jobAddress.trim()
                          ? "Time the drive from the client's place to the store and back"
                          : "Add the client's address above first"
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {lookingUpRun === index ? "..." : "Look up"}
                    </button>
                  )}
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
                        // Only intercept clipboard text carrying "$", commas
                        // or other junk; a plain numeric paste falls through to
                        // the native number input so decimal entry is unaffected.
                        const text = e.clipboardData.getData("text");
                        if (!/[^\d.]/.test(text)) return;
                        const value = parseMoney(text);
                        if (value === null) return;
                        e.preventDefault();
                        patchEntry(index, {
                          cost: Math.round(value * 100) / 100,
                          isAuto: false,
                          isParsedCost: false,
                        });
                      }}
                      onChange={(e) =>
                        patchEntry(index, {
                          cost: Math.round((parseFloat(e.target.value) || 0) * 100) / 100,
                          isAuto: false,
                          isParsedCost: false,
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
                      <span className="text-slate-400">{isRun ? "Store:" : "Destination:"}</span>{" "}
                      <span className="wrap-break-word text-slate-700">{entry.destination}</span>
                    </li>
                    <li>
                      <span className="text-slate-400">{isRun ? "To the store:" : "There:"}</span>{" "}
                      {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      {/* Return leg quoted at its own departure time; km shown only on
                          There - the back-leg distance is not returned by the lookup. */}
                      <span className="text-slate-400">
                        {isRun ? "Back to the client:" : "Back:"}
                      </span>{" "}
                      {backMin} min
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addEntry}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Add travel
          </button>
          <button
            type="button"
            onClick={addStoreRun}
            title="A drive from the client's place to a store and back during the job"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Store run
          </button>
        </div>
        {travelEntries.length > 0 && (
          <span className="text-xs text-slate-500">
            Total <span className="font-medium text-slate-700">{formatNZD(total)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
