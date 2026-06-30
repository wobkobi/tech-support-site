// src/features/booking/lib/availability-config.server.ts
/**
 * @description Server-only bridge that resolves the booking slot engine's config
 * from the settings panel. Every booking surface (days/hold/request/edit routes
 * + the booking pages) builds its {@link AvailabilityConfig} here so they share one
 * source - the operator's saved availability plus the structural timezone.
 */

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
