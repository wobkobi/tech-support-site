"use client";
// src/features/booking/hooks/use-travel-slots.ts
// Asks the server which grid starts the drive rules out once the booking form has an address,
// so the picker can drop them.

import type { TravelBlockedSlot } from "@/features/booking/lib/booking-travel";
import { useEffect, useState } from "react";

/** Wait after the address settles before asking, so fallback-mode typing doesn't fire per key. */
const DEBOUNCE_MS = 600;

/**
 * Drive-blocked starts for an address. A failed or rate-limited check leaves every time open
 * (the submit re-check still applies), and the answer for an old address is never applied to a
 * new one.
 * @param address - The customer's address, or null when there's nothing to check (remote, not
 *   picked yet, editing).
 * @returns The blocked starts for this address, or null until known.
 */
export function useTravelSlots(address: string | null): TravelBlockedSlot[] | null {
  const [result, setResult] = useState<{ address: string; blocked: TravelBlockedSlot[] } | null>(
    null,
  );

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/booking/travel-slots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
            signal: controller.signal,
          });
          if (!res.ok) return;
          const data = (await res.json()) as { blocked?: TravelBlockedSlot[] };
          if (Array.isArray(data.blocked)) setResult({ address, blocked: data.blocked });
        } catch {
          // Aborted or offline: keep every time open.
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  return address && result?.address === address ? result.blocked : null;
}
