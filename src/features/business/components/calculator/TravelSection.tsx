"use client";

import type React from "react";
import type { RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, travelEntriesTotal } from "@/features/business/lib/business";
import type { TravelEntry } from "@/features/business/types/business";

interface Props {
  addressInputRef: RefObject<HTMLInputElement | null>;
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  travelEntries: TravelEntry[];
  onTravelEntriesChange: (entries: TravelEntry[]) => void;
  lookingUpTravel: boolean;
  onLookup: () => void;
}

/**
 * Travel address input + per-entry travel cost list. The address input is
 * wired to Google Places autocomplete via a ref owned by the parent. Each
 * lookup populates (or replaces) a single auto entry; operators can add
 * additional manual entries (parking, ferry, etc.) and the invoice lumps
 * every entry into one "Travel" line.
 * @param props - Component props.
 * @param props.addressInputRef - Ref forwarded to the address input so the parent can attach Maps autocomplete.
 * @param props.jobAddress - Current address text.
 * @param props.onJobAddressChange - Setter invoked when the user types in the address input.
 * @param props.travelEntries - All travel charges (auto + manual); summed for the invoice line.
 * @param props.onTravelEntriesChange - Replaces the entries array.
 * @param props.lookingUpTravel - True while a lookup is in flight; disables the button.
 * @param props.onLookup - Click handler for the "Look up" button and Enter key.
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
          {travelEntries.map((entry, index) => (
            <div key={index} className={cn("flex items-center gap-2")}>
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
          ))}
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
