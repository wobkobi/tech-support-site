// src/features/booking/lib/availability-config.server.ts
// Server-only: builds every booking surface's AvailabilityConfig from the saved settings.

import { BOOKING_CONFIG, type AvailabilityConfig } from "@/features/booking/lib/booking";
import { getSettings } from "@/shared/lib/settings/get-settings";
import "server-only";

/** Resolved availability plus the master "accepting bookings" switch + message. */
export interface ResolvedAvailability {
  config: AvailabilityConfig;
  acceptingBookings: boolean;
  closedMessage: string;
}

/**
 * Resolves the live availability config (settings + timezone) for the slot engine.
 * @returns The engine config plus the accepting-bookings switch and its message.
 */
export async function getAvailabilityConfig(): Promise<ResolvedAvailability> {
  const { availability } = await getSettings();
  return {
    config: { ...availability, timeZone: BOOKING_CONFIG.timeZone },
    acceptingBookings: availability.acceptingBookings,
    closedMessage: availability.closedMessage,
  };
}
