"use client";
// src/features/booking/hooks/use-contact-lookup.ts
// Returning-customer lookup for the booking form's email and phone blur, safe against
// out-of-order responses.

import {
  lookupBookingContact,
  type BookingContactLookup,
} from "@/features/booking/lib/booking-form";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { useRef } from "react";

/**
 * Looks up a returning customer once both email and phone are filled in; each call
 * aborts the previous and stale responses are dropped.
 * @returns A lookup function resolving to the contact, or null (no match, incomplete,
 *   superseded or failed).
 */
export function useContactLookup(): (
  email: string,
  phone: string,
) => Promise<BookingContactLookup | null> {
  const abortRef = useRef<AbortController | null>(null);
  const latestKeyRef = useRef("");

  return async (email, phone) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return null;
    // The server only answers when both match, so a half-typed phone isn't worth a request
    if (validatePhone(phone, { nzOnly: true }).result !== "ok") return null;

    const key = `${trimmed}|${phone.trim()}`;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    latestKeyRef.current = key;

    try {
      const data = await lookupBookingContact(trimmed, phone.trim(), controller.signal);
      if (!data?.ok || latestKeyRef.current !== key) return null;
      return data;
    } catch {
      return null;
    }
  };
}
