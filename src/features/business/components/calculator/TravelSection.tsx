"use client";
// src/features/business/components/calculator/TravelSection.tsx
// Travel address input + cost list: one auto entry, manual extras lumped into one line,
// store runs billed separately, and a Drove / Walked toggle (a walk bills and logs no trip).

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { SectionClearButton } from "@/features/business/components/calculator/SectionClearButton";
import { REMOVE_ROW_CLS } from "@/features/business/components/calculator/calculator-classes";
import { formatNZD, travelEntriesTotal } from "@/features/business/lib/business";
import { lookupStoreRunEntry } from "@/features/business/lib/calculator-helpers";
import { breakdownTravelCharge } from "@/features/business/lib/pricing-policy";
import type { TravelEntry } from "@/features/business/types/business";
import { parseMoney, roundCents } from "@/shared/lib/money";
import type React from "react";
import { useState } from "react";

interface Props {
  jobAddress: string;
  onJobAddressChange: (value: string) => void;
  /** Fired when a Places suggestion is picked (full formatted address). */
  onAddressSelected: (formattedAddress: string) => void;
  /** Whether to offer Drove / Walked (hidden for a remote job, which logs no trip). */
  showTripMode: boolean;
  /** True when you walked, so the job bills no travel and saving logs no trip. */
  walked: boolean;
  /** Sets drove (false) or walked (true); walked takes the trip off the bill. */
  onWalkedChange: (walked: boolean) => void;
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
 * Travel address input + per-entry cost list. Looked-up entries show a breakdown
 * (there/back > raw > rounded > final).
 * @param props - Component props.
 * @param props.jobAddress - Current address text.
 * @param props.onJobAddressChange - Address change handler.
 * @param props.onAddressSelected - Fired when a Places suggestion is picked.
 * @param props.showTripMode - Whether to offer the Drove / Walked toggle.
 * @param props.walked - True when you walked, so no travel is billed or logged.
 * @param props.onWalkedChange - Sets drove or walked.
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
  showTripMode,
  walked,
  onWalkedChange,
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
    // Apply to the latest entries (rows may change mid-lookup); drop the result if this
    // row no longer holds the looked-up store.
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
    <Card className="space-y-3">
      <CardHeader
        title="Travel"
        className="mb-0 items-center"
        actions={
          (travelEntries.length > 0 || jobAddress.trim().length > 0) && (
            <SectionClearButton
              onClear={() => {
                onJobAddressChange("");
                onTravelEntriesChange([]);
              }}
              label="travel"
            />
          )
        }
      />
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
            inputClassName={ADMIN_INPUT_CLS}
          />
        </div>
        <AdminButton
          variant="secondary"
          onClick={onLookup}
          suppressHydrationWarning
          disabled={lookingUpTravel || !jobAddress.trim()}
        >
          {lookingUpTravel ? "..." : "Look up"}
        </AdminButton>
      </div>

      {showTripMode && jobAddress.trim() && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div role="group" aria-label="How you got there" className={SEGMENTED_GROUP_CLS}>
            <button
              type="button"
              aria-pressed={!walked}
              className={segmentedButtonClass(!walked)}
              onClick={() => onWalkedChange(false)}
            >
              Drove
            </button>
            <button
              type="button"
              aria-pressed={walked}
              className={segmentedButtonClass(walked)}
              onClick={() => onWalkedChange(true)}
            >
              Walked
            </button>
          </div>
          <p className="text-sm text-admin-muted">
            {walked
              ? "No travel is billed and no trip is logged."
              : "Saving the invoice logs the trip."}
          </p>
        </div>
      )}

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
                  <p className="text-sm font-medium text-admin-muted">
                    Store run - from the client&apos;s place and back
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <AdminInput
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
                    className="min-w-0 flex-1"
                  />
                  {isRun && (
                    <AdminButton
                      variant="secondary"
                      onClick={() => void lookUpStoreRun(index)}
                      disabled={lookingUpRun !== null || !entry.label.trim() || !jobAddress.trim()}
                      title={
                        jobAddress.trim()
                          ? "Time the drive from the client's place to the store and back"
                          : "Add the client's address above first"
                      }
                    >
                      {lookingUpRun === index ? "..." : "Look up"}
                    </AdminButton>
                  )}
                  <div className="flex items-stretch">
                    <span className="flex items-center rounded-l-md border border-r-0 border-admin-border-strong bg-admin-bg px-2 text-sm text-admin-muted">
                      $
                    </span>
                    <AdminInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.cost || ""}
                      onPaste={(e) => {
                        // Intercept only pastes with "$", commas or other junk.
                        const text = e.clipboardData.getData("text");
                        if (!/[^\d.]/.test(text)) return;
                        const value = parseMoney(text);
                        if (value === null) return;
                        e.preventDefault();
                        patchEntry(index, {
                          cost: roundCents(value),
                          isAuto: false,
                          isParsedCost: false,
                        });
                      }}
                      onChange={(e) =>
                        patchEntry(index, {
                          // A typed "-" can't make a negative charge: min="0" isn't enforced.
                          cost: roundCents(Math.max(0, parseFloat(e.target.value) || 0)),
                          isAuto: false,
                          isParsedCost: false,
                        })
                      }
                      className="w-24 rounded-l-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(index)}
                    aria-label={`Remove travel entry ${index + 1}`}
                    className={REMOVE_ROW_CLS}
                  >
                    ×
                  </button>
                </div>
                {breakdown && (
                  <ul className="ml-1 space-y-0.5 rounded-md border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text-secondary">
                    <li>
                      <span className="text-admin-muted">{isRun ? "Store:" : "Destination:"}</span>{" "}
                      <span className="wrap-break-word text-admin-text">{entry.destination}</span>
                    </li>
                    <li>
                      <span className="text-admin-muted">{isRun ? "To the store:" : "There:"}</span>{" "}
                      {oneWayMin} min
                      {entry.distanceKmOneWay !== undefined && ` (${entry.distanceKmOneWay} km)`}
                    </li>
                    <li>
                      {/* Return leg at its own departure time; the lookup gives no back-leg km. */}
                      <span className="text-admin-muted">
                        {isRun ? "Back to the client:" : "Back:"}
                      </span>{" "}
                      {backMin} min
                    </li>
                    <li>
                      <span className="text-admin-muted">Raw:</span> {roundTripMin} min round trip @{" "}
                      {formatNZD(travelRatePerHour)}/hr ={" "}
                      <span className="text-admin-text">{formatNZD(breakdown.rawCost)}</span>
                    </li>
                    {breakdown.roundedCost !== breakdown.rawCost && (
                      <li>
                        <span className="text-admin-muted">Rounded to nearest $5:</span>{" "}
                        <span className="text-admin-text">{formatNZD(breakdown.roundedCost)}</span>
                      </li>
                    )}
                    {breakdown.minimumApplied && (
                      <li>
                        <span className="text-admin-muted">
                          {formatNZD(minTravelCharge)} minimum applied
                        </span>{" "}
                        (figure was under {formatNZD(minTravelCharge)}).
                      </li>
                    )}
                    <li>
                      <span className="text-admin-muted">Final:</span>{" "}
                      <span className="font-medium text-admin-text">
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
          <AdminButton variant="secondary" size="xs" onClick={addEntry}>
            + Add travel
          </AdminButton>
          <AdminButton
            variant="secondary"
            size="xs"
            onClick={addStoreRun}
            title="A drive from the client's place to a store and back during the job"
          >
            + Store run
          </AdminButton>
        </div>
        {travelEntries.length > 0 && (
          <span className="text-sm text-admin-muted">
            Total <span className="font-medium text-admin-text">{formatNZD(total)}</span>
          </span>
        )}
      </div>
    </Card>
  );
}
