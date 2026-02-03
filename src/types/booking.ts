// src/types/booking.ts
/**
 * Shared TypeScript types for booking flows and API payloads.
 */

export type BookingStatus = "held" | "confirmed" | "cancelled";

/**
 * Booking configuration values used for slot generation and validation.
 */
export interface BookingConfig {
  /**
   * Length of a single appointment slot in minutes.
   */
  slotDurationMin: number;
  /**
   * Buffer before and after each appointment in minutes.
   */
  bufferMin: number;
  /**
   * Minimum notice required before a slot can be booked online, in hours.
   */
  minNoticeHours: number;
  /**
   * Maximum days into the future that can be booked online.
   */
  maxAdvanceDays: number;
  /**
   * IANA time zone identifier used for labels and calendar events.
   */
  timeZone: string;
  /**
   * Local minute-of-day (0..1440) for the first slot start time.
   */
  dayStartMinuteLocal: number;
  /**
   * Local minute-of-day (0..1440) for the last possible start boundary (exclusive).
   */
  dayEndMinuteLocal: number;
}

/**
 * Slot as exposed to the client for display and selection.
 */
export interface BookingSlot {
  /**
   * ISO start time in UTC.
   */
  startIso: string;
  /**
   * ISO end time in UTC.
   */
  endIso: string;
  /**
   * Date key in YYYY-MM-DD for grouping in the grid.
   */
  dayKey: string;
  /**
   * Short label for the date, formatted in the configured time zone.
   */
  dayLabel: string;
  /**
   * Short label for the time, formatted in the configured time zone.
   */
  timeLabel: string;
}

/**
 * Minimal booking shape for conflict checks.
 */
export interface ExistingBooking {
  /**
   * Appointment start time in UTC.
   */
  startUtc: Date;
  /**
   * Appointment end time in UTC.
   */
  endUtc: Date;
  /**
   * Buffer before this booking in minutes.
   */
  bufferBeforeMin: number;
  /**
   * Buffer after this booking in minutes.
   */
  bufferAfterMin: number;
}

/**
 * Payload expected by the booking creation endpoint.
 */
export interface CreateBookingPayload {
  /**
   * Person booking the appointment.
   */
  name: string;
  /**
   * Contact email address.
   */
  email: string;
  /**
   * Optional description of what they need help with.
   */
  notes?: string;
  /**
   * ISO slot start time in UTC.
   */
  slotStartIso: string;
  /**
   * ISO slot end time in UTC.
   */
  slotEndIso: string;
}

/**
 * Success response from the booking creation endpoint.
 */
export interface CreateBookingResponse {
  /**
   * Indicates the booking was created successfully.
   */
  ok: true;
  /**
   * Database booking ID.
   */
  bookingId: string;
}

/**
 * Payload expected by the cancel endpoint.
 */
export interface CancelBookingPayload {
  /**
   * Secret cancel token stored on the booking.
   */
  cancelToken: string;
}

/**
 * Success response from the cancel endpoint.
 */
export interface CancelBookingResponse {
  /**
   * Indicates the booking was cancelled successfully.
   */
  ok: true;
}
