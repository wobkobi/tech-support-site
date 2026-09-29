"use client";
// src/features/booking/hooks/use-contact-lookup.ts
// Returning-customer lookup for the booking form's email blur, safe against
// out-of-order responses.

import {
  lookupBookingContact,
  type BookingContactLookup,
} from "@/features/booking/lib/booking-form";
import { useRef } from "react";

/**
 * Looks up a returning customer by email. Each call aborts the one before it,
 * and a response that arrives after the customer has blurred a different email
 * is dropped, so a slow first lookup can never overwrite a faster newer one.
 * @returns A lookup function resolving to the contact, or null when there is
 *   nothing current to apply (no match, superseded, or a network failure -
 *   pre-fill is best-effort).
 */
export function useContactLookup(): (email: string) => Promise<BookingContactLookup | null> {
  const abortRef = useRef<AbortController | null>(null);
  const latestEmailRef = useRef("");

  return async (email) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return null;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    latestEmailRef.current = trimmed;

    try {
      const data = await lookupBookingContact(trimmed, controller.signal);
      if (!data?.ok || latestEmailRef.current !== trimmed) return null;
      return data;
    } catch {
      return null;
    }
  };
}
