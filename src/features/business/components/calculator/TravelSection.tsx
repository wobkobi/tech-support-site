"use client";

import type React from "react";
import type { RefObject } from "react";
import { cn } from "@/shared/lib/cn";

export interface TravelInfo {
  distanceKm: number;
  durationMins: number;
  cost: number;
}

interface Props {
  addressInputRef: RefObject<HTMLInputElement | null>;
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  travelInfo: TravelInfo | null;
  onTravelInfoChange: (info: TravelInfo | null) => void;
  lookingUpTravel: boolean;
  travelOnInvoice: boolean;
  onTravelOnInvoiceChange: (on: boolean) => void;
  onLookup: () => void;
  onAddToInvoice: () => void;
}

/**
 * Travel address input + travel-time lookup card. The text input is wired to
 * Google Places autocomplete via a ref owned by the parent (so the parent's
 * effect can attach the listener and clean up). Once a lookup returns, an
 * info chip shows distance, drive time, and cost with an "Add to invoice"
 * button that flips to "Added" when committed.
 * @param props - Component props.
 * @param props.addressInputRef - Ref forwarded to the address input so the parent can attach the Maps autocomplete.
 * @param props.jobAddress - Current address text.
 * @param props.onJobAddressChange - Setter invoked when the user types in the address input.
 * @param props.travelInfo - Result of the most recent lookup, or null.
 * @param props.onTravelInfoChange - Setter for the lookup result (used when the user edits the address, to clear stale info).
 * @param props.lookingUpTravel - True while a lookup is in flight; disables the button.
 * @param props.travelOnInvoice - True once the operator has clicked "Add to invoice".
 * @param props.onTravelOnInvoiceChange - Setter for the "added" flag (used to reset when the address changes).
 * @param props.onLookup - Click handler for the "Look up" button and Enter key.
 * @param props.onAddToInvoice - Click handler for the "Add to invoice" button.
 * @returns Travel section element.
 */
export function TravelSection({
  addressInputRef,
  jobAddress,
  onJobAddressChange,
  travelInfo,
  onTravelInfoChange,
  lookingUpTravel,
  travelOnInvoice,
  onTravelOnInvoiceChange,
  onLookup,
  onAddToInvoice,
}: Props): React.ReactElement {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet mb-3 text-sm font-semibold")}>Travel</h2>
      <div className={cn("flex gap-2")}>
        <input
          ref={addressInputRef}
          type="text"
          placeholder="Client address or suburb"
          value={jobAddress}
          onChange={(e) => {
            onJobAddressChange(e.target.value);
            onTravelInfoChange(null);
            onTravelOnInvoiceChange(false);
          }}
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
      {travelInfo && (
        <div
          className={cn(
            "mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600",
          )}
        >
          <span>
            {travelInfo.distanceKm} km
            {travelInfo.durationMins > 0
              ? ` - approx ${travelInfo.durationMins} min drive`
              : ""} -{" "}
            <span className="font-medium text-slate-800">${travelInfo.cost.toFixed(2)}</span>
          </span>
          {travelOnInvoice ? (
            <span className={cn("ml-3 text-xs font-medium text-green-600")}>Added</span>
          ) : (
            <button
              type="button"
              onClick={onAddToInvoice}
              className={cn(
                "ml-3 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-300",
              )}
            >
              Add to invoice
            </button>
          )}
        </div>
      )}
    </div>
  );
}
