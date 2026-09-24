"use client";
// In-person address block of the booking form: Places-backed street field,
// optional Apt/Unit box, and the submit-time "did you mean?" candidate prompt.

import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import type { BookingAddressState } from "@/features/booking/hooks/use-booking-address";
import { BOOKING_FIELD_LIMITS, unitMatchesStreetNumber } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCheck } from "react-icons/fa6";

export interface BookingAddressFieldsProps {
  /** Address state from the form's address hook. */
  state: BookingAddressState;
  /** True for in-person visits; reveals the block and mounts the Places field. */
  visible: boolean;
  /** Inline address error, if any. */
  error?: string;
  /** Called on every street-address keystroke so the form can clear its error. */
  onEdited: () => void;
  /** Focus target for the "did you mean?" prompt. */
  promptRef: React.Ref<HTMLDivElement>;
}

/**
 * Address (only for in-person) with an animated reveal.
 * @param props - Component props.
 * @param props.state - Address state from the form's address hook.
 * @param props.visible - True for in-person visits.
 * @param props.error - Inline address error, if any.
 * @param props.onEdited - Called on every street-address keystroke.
 * @param props.promptRef - Focus target for the "did you mean?" prompt.
 * @returns The address block.
 */
export function BookingAddressFields({
  state,
  visible,
  error,
  onEdited,
  promptRef,
}: BookingAddressFieldsProps): React.ReactElement {
  const {
    unit,
    setUnit,
    address,
    setAddress,
    addressVerified,
    setAddressVerified,
    setAddressOverrideAcked,
    addressCandidates,
    setAddressCandidates,
    showUnit,
    setShowUnit,
    mapsFallback,
    setMapsFallback,
    applyAddressCandidate,
    keepTypedAddress,
  } = state;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className={cn(visible ? "overflow-visible" : "overflow-hidden")}>
        <div className="pt-0.5 pb-0.5">
          <div className="mb-2 block text-base font-semibold text-rich-black">
            Address <span className="text-error">*</span>
          </div>
          {/* Only mount when in-person so Google Maps script never loads for remote sessions */}
          {visible && (
            <div className="flex flex-col gap-3">
              {/* Street address takes the full width; the Apt/Unit box is
                  revealed on demand below so nobody types their street
                  number into it by mistake. */}
              <div className="flex flex-col gap-1">
                <label htmlFor="booking-address" className="text-sm font-medium text-rich-black/80">
                  Street address
                </label>
                <AddressAutocomplete
                  id="booking-address"
                  value={address}
                  maxLength={BOOKING_FIELD_LIMITS.address}
                  onChange={(v) => {
                    setAddress(v);
                    onEdited();
                    setAddressCandidates(null);
                    // Any keystroke invalidates the prior pick. onChange
                    // fires before onPlaceSelected, so batching leaves
                    // verified=true on a real pick. Skipped in fallback mode.
                    if (!mapsFallback) {
                      setAddressVerified(false);
                      setAddressOverrideAcked(false);
                    }
                  }}
                  onPlaceSelected={() => setAddressVerified(true)}
                  onFallbackMode={() => {
                    setMapsFallback(true);
                    // No suggestions available > accept the typed address
                    // outright; the submit-time verify (skipped in this
                    // mode) was the only thing that would have gated it.
                    setAddressVerified(true);
                  }}
                  onRecovered={() => {
                    // Autocomplete is back - restore the verify gate.
                    setMapsFallback(false);
                    setAddressVerified(false);
                    setAddressOverrideAcked(false);
                  }}
                  placeholder="Start typing your street address..."
                  required
                  aria-invalid={!!error || undefined}
                  aria-describedby={error ? "booking-address-error" : undefined}
                />
                {error && (
                  <p id="booking-address-error" className="text-sm text-error">
                    {error}
                  </p>
                )}
                {address.trim() &&
                  !mapsFallback &&
                  (addressVerified ? (
                    <p
                      className={cn(
                        "text-sm font-medium text-green-700",
                        "flex items-center gap-1",
                      )}
                    >
                      <FaCheck className="h-4 w-4" aria-hidden /> Address verified
                    </p>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Pick a suggestion from the dropdown to verify your address.
                    </p>
                  ))}
              </div>

              {/* Apt/Unit: hidden until the customer says they have one. */}
              {showUnit ? (
                <div className="flex flex-col gap-1 sm:max-w-56">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="booking-unit"
                      className="truncate text-sm font-medium text-rich-black/80"
                    >
                      Apt / Unit (optional)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        // Collapse and clear so a hidden field never carries a
                        // stale value into combineUnitAndAddress.
                        setShowUnit(false);
                        setUnit("");
                        setAddressCandidates(null);
                        setAddressOverrideAcked(false);
                      }}
                      // Negative margin keeps the label row compact while the
                      // tap target still reaches 44px.
                      className="-my-3 min-h-11 px-1 text-sm text-rich-black/70 underline underline-offset-2 hover:text-rich-black"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    id="booking-unit"
                    type="text"
                    value={unit}
                    onChange={(e) => {
                      setUnit(e.target.value);
                      setAddressCandidates(null);
                      // Unit edits invalidate any prior submit-time verify
                      // override so the new combined address gets re-checked.
                      setAddressOverrideAcked(false);
                    }}
                    placeholder="e.g. 12"
                    inputMode="text"
                    autoComplete="off"
                    maxLength={8}
                    aria-describedby="booking-unit-hint"
                    className={cn(
                      "w-full rounded-md border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
                      "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
                    )}
                  />
                  <p id="booking-unit-hint" className="text-sm text-slate-600">
                    Only for apartments, units or flats - leave blank for a house.
                  </p>
                  {unitMatchesStreetNumber(unit, address) && (
                    <p className="text-sm font-medium text-amber-700">
                      That looks like your street number. If this is a standalone house, leave Apt /
                      Unit blank.
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowUnit(true)}
                  className="min-h-11 self-start text-left text-base font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
                >
                  Live in an apartment, unit or flat? Add your unit number
                </button>
              )}

              {/* Google returned candidates for a typed address - let the
                  customer pick; never assume when there's more than one. */}
              {addressCandidates && addressCandidates.length > 0 && (
                <div
                  ref={promptRef}
                  tabIndex={-1}
                  role="group"
                  aria-labelledby="booking-address-candidates"
                  className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-base"
                >
                  <p id="booking-address-candidates" className="font-medium text-rich-black">
                    {addressCandidates.length === 1
                      ? "Did you mean this address?"
                      : "Which address did you mean?"}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {addressCandidates.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => applyAddressCandidate(candidate)}
                        className={cn(
                          "min-h-11 rounded-md border border-russian-violet/40 bg-white px-3 py-2 text-left text-rich-black",
                          "hover:border-russian-violet hover:bg-russian-violet/5 focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
                        )}
                      >
                        {candidate}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={keepTypedAddress}
                    className="min-h-11 self-start text-left text-rich-black/80 underline underline-offset-2 hover:text-rich-black"
                  >
                    None of these - use what I typed
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
