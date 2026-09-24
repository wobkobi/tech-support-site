"use client";
// Address state for the public booking form: street + unit, the Places
// verification flags, and the submit-time "did you mean?" candidates.

import { splitUnitFromAddress } from "@/features/booking/lib/booking";
import { useState } from "react";

/** Address state and handlers returned by {@link useBookingAddress}. */
export interface BookingAddressState {
  unit: string;
  setUnit: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  addressVerified: boolean;
  setAddressVerified: (value: boolean) => void;
  addressOverrideAcked: boolean;
  setAddressOverrideAcked: (value: boolean) => void;
  addressCandidates: string[] | null;
  setAddressCandidates: (value: string[] | null) => void;
  showUnit: boolean;
  setShowUnit: (value: boolean) => void;
  mapsFallback: boolean;
  setMapsFallback: (value: boolean) => void;
  /** Applies a Google candidate picked from the "did you mean?" prompt. */
  applyAddressCandidate: (candidate: string) => void;
  /** Dismisses the prompt and keeps the typed text. */
  keepTypedAddress: () => void;
}

/**
 * Holds the booking form's address fields and verification state.
 * @param initialAddress - Pre-filled address (edit mode), possibly with a "unit/" prefix.
 * @returns Address state, setters and candidate-prompt handlers.
 */
export function useBookingAddress(initialAddress: string): BookingAddressState {
  // Unit kept separate so Places autocomplete can predict the street part
  // (NZ "N/" prefixes break predictions). Re-combined on submit, split on
  // pre-fill, so saved addresses stay in "12/160 Kepa Road Orakei" shape.
  const initialSplit = splitUnitFromAddress(initialAddress);
  const [unit, setUnit] = useState(initialSplit.unit);
  const [address, setAddress] = useState(initialSplit.rest);
  // True after picking an autocomplete suggestion (or pre-filled in edit mode);
  // any keystroke resets it. Drives the green-tick hint + submit-time geocode.
  const [addressVerified, setAddressVerified] = useState(Boolean(initialAddress));
  // True after a failed submit-time geocode so a second click submits as-is.
  // Resets on any address change to re-check different mistypes.
  const [addressOverrideAcked, setAddressOverrideAcked] = useState(false);
  // Google candidates for a typed-but-not-picked address. null = no prompt, one
  // entry = "did you mean?", several = "which did you mean?" - never auto-picked.
  const [addressCandidates, setAddressCandidates] = useState<string[] | null>(null);
  // Apt/Unit is hidden by default (most customers are in a house) so nobody types
  // their street number into it; revealed on request, pre-revealed in edit mode.
  const [showUnit, setShowUnit] = useState(Boolean(initialSplit.unit));
  // True once AddressAutocomplete reports the Maps API is unavailable. The
  // form then skips the "must pick a suggestion" gate.
  const [mapsFallback, setMapsFallback] = useState(false);

  /**
   * Applies a Google address candidate the customer picked from the "did you
   * mean?" prompt: splits any unit prefix back into its own field, marks the
   * address verified so it won't re-prompt, and dismisses the prompt.
   * @param candidate - The chosen canonical address (may carry a "unit/" prefix).
   */
  function applyAddressCandidate(candidate: string): void {
    const split = splitUnitFromAddress(candidate);
    if (split.unit) setShowUnit(true);
    setUnit(split.unit);
    setAddress(split.rest);
    setAddressVerified(true);
    setAddressCandidates(null);
    setAddressOverrideAcked(false);
  }

  /**
   * Dismisses the address prompt and keeps the customer's typed text, letting the
   * next submit go through as-is (some genuine new addresses don't geocode).
   */
  function keepTypedAddress(): void {
    setAddressCandidates(null);
    setAddressOverrideAcked(true);
  }

  return {
    unit,
    setUnit,
    address,
    setAddress,
    addressVerified,
    setAddressVerified,
    addressOverrideAcked,
    setAddressOverrideAcked,
    addressCandidates,
    setAddressCandidates,
    showUnit,
    setShowUnit,
    mapsFallback,
    setMapsFallback,
    applyAddressCandidate,
    keepTypedAddress,
  };
}
