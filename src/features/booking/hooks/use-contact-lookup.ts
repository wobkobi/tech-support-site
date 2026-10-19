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
 * Looks up a returning customer by email; each call aborts the previous and stale
 * responses are dropped.
 * @returns A lookup function resolving to the contact, or null (no match, superseded or failed).
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
