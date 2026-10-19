"use client";
// src/features/booking/hooks/use-booking-address.ts
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
  // Unit kept separate: NZ "N/" prefixes break Places predictions. Saved as "12/160 Kepa Road".
  const initialSplit = splitUnitFromAddress(initialAddress);
  const [unit, setUnit] = useState(initialSplit.unit);
  const [address, setAddress] = useState(initialSplit.rest);
  // True after picking a suggestion (or edit-mode pre-fill); any keystroke resets it.
  const [addressVerified, setAddressVerified] = useState(Boolean(initialAddress));
  // A failed geocode lets the next click submit as-is; resets on address change.
  const [addressOverrideAcked, setAddressOverrideAcked] = useState(false);
  // Google candidates for a typed address (null = no prompt); never auto-picked.
  const [addressCandidates, setAddressCandidates] = useState<string[] | null>(null);
  // Apt/Unit hidden by default so nobody types their street number into it.
  const [showUnit, setShowUnit] = useState(Boolean(initialSplit.unit));
  // Maps API unavailable: skip the "must pick a suggestion" gate.
  const [mapsFallback, setMapsFallback] = useState(false);

  /**
   * Applies a picked Google candidate: splits out any unit and marks the address verified.
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

  /** Dismisses the prompt; the next submit goes through with the typed text. */
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
