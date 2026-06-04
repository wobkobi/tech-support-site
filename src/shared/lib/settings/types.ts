// src/shared/lib/settings/types.ts
/**
 * @file types.ts
 * @description Shape of the admin-editable settings, one interface per group.
 * Every value here was a hardcoded constant before the settings panel; the
 * matching defaults live in `defaults.ts` and DB overrides merge on top in
 * `get-settings.ts`. Optional rules use `null`/`0` to mean "off" - see the
 * disable-semantics table in the settings plan.
 */

/** One weekday's bookable window. `getUTCDay()` indexing: 0 = Sunday .. 6 = Saturday. */
export interface DayWindow {
  /** When false the whole day is unavailable (no slots offered). */
  enabled: boolean;
  /** Earliest start hour, 0-23 NZ-local. */
  open: number;
  /** Latest end hour, 1-24 NZ-local. Must be greater than `open` when enabled. */
  close: number;
  /** Optional midday break that splits the day into two windows; null = continuous. */
  break: { start: number; end: number } | null;
}

/** Seven-day availability map keyed by `getUTCDay()` (0 = Sunday .. 6 = Saturday). */
export type WeeklySchedule = Record<number, DayWindow>;

export interface AvailabilitySettings {
  /** Master switch - when false the public booking flow is paused. */
  acceptingBookings: boolean;
  /** Shown on /booking when bookings are paused. */
  closedMessage: string;
  schedule: WeeklySchedule;
  /** How many days ahead a customer can book. Required, clamped 1-365. */
  maxAdvanceDays: number;
  /** Minimum hours of notice. 0 = no minimum. */
  minHoursNotice: number;
  /** After this NZ hour same-day booking closes. null = no same-day cutoff. */
  sameDayCutoffHour: number | null;
  /** Buffer applied around existing calendar events (minutes). */
  bufferMin: number;
  /** Buffer blocked after each booking ends (minutes). */
  bookingBufferAfterMin: number;
  /** Sub-slot start offsets within each hour, e.g. [0, 15, 30, 45]. */
  subSlotMinutes: number[];
  /** Selectable job durations in minutes. */
  durations: { short: number; long: number };
  /** Max bookings allowed per day. null/0 = unlimited. */
  maxJobsPerDay: number | null;
  /** Max billable hours bookable per day. null/0 = unlimited. */
  maxBillableHoursPerDay: number | null;
}

export interface CancellationSettings {
  /** Cancellations more than this many hours out are free. */
  freeNoticeHours: number;
  /** Inside this window a cancellation also bills round-trip travel. */
  travelChargeHours: number;
  /** Flat call-out fee inside the free-notice window. */
  callOutFee: number;
}

export interface RescheduleSettings {
  /** Can't reschedule within this many hours of the booking. 0 = no limit. */
  cutoffHours: number;
  /** Max times one booking can be rescheduled. null/0 = no limit. */
  maxReschedules: number | null;
}

export interface PricingSettings {
  /** When true invoices show GST; requires a GST number to be set. */
  gstRegistered: boolean;
  /** Minimum billable time floor (minutes). 0 = no floor. */
  minBillableMins: number;
  /** Round-to-nearest billable step (minutes); shared with the AI parser snap. */
  billingIncrementMins: number;
  /** Public-holiday labour surcharge, fraction (0.25 = +25%). 0 = no surcharge. */
  publicHolidayUplift: number;
  /** Minimum travel charge floor (NZD). 0 = no floor. */
  minTravelCharge: number;
  cancellation: CancellationSettings;
  reschedule: RescheduleSettings;
}

/** Unified business base address - feeds the travel origin, JSON-LD, signatures. */
export interface BaseAddress {
  /** Street line used as the Distance Matrix travel origin. */
  line: string;
  locality: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
}

export interface IdentitySettings {
  name: string;
  company: string;
  email: string;
  phone: string;
  phoneTel: string;
  website: string;
  location: string;
  baseAddress: BaseAddress;
  servedSuburbs: string[];
  paymentTermsDays: number;
  startDateIso: string;
  gstNumber: string;
  bankAccount: string;
  invoicePrefix: string;
  homeRegion: string;
}

export interface TaxSettings {
  /** Income-tax reserve rate (fraction). */
  incomeTax: number;
  /** ACC levy estimate (fraction). */
  acc: number;
  /** KiwiSaver contribution rate (fraction). */
  kiwiSaver: number;
  /** Weekly KiwiSaver transfer (NZD). */
  weeklyKiwiSaver: number;
  /** Weekly tax-account transfer (NZD). */
  weeklyTax: number;
}

export interface CommsSettings {
  notifyConfirmation: boolean;
  notifyReminder: boolean;
  notifyReviewRequest: boolean;
  /** Send the booking reminder this many hours before the appointment. */
  reminderLeadHours: number;
  /** Delay after a job ends before the review-request email fires (minutes). */
  reviewEmailDelayMins: number;
  /** How long price-estimate logs are kept before auto-purge (days). */
  priceEstimateRetentionDays: number;
}

export interface HoldsSettings {
  /** How long a provisional slot hold lasts (minutes). */
  holdExpirationMinutes: number;
}

export interface SchedulingSettings {
  /** Travel-block rounding buffer for overrun + traffic (minutes). */
  travelRoundBufferMin: number;
  /** Minimum home dwell before a travel-back block is suppressed (minutes). */
  minHomeDwellMin: number;
  /** Buffer before departure on a travel-back block for booking events (minutes). */
  travelBackDepartureBufferMin: number;
  /** How far back to look for a preceding event to use as the origin (hours). */
  smartOriginLookaheadHours: number;
}

export interface ReviewsSettings {
  /** How many approved reviews feature on the home page. */
  homepageFeaturedCount: number;
  /** When true, reviews verified via a booking/contact token auto-approve. */
  autoApproveVerified: boolean;
  /** Minimum days between review-request emails to one contact. */
  invoiceReviewCooldownDays: number;
}

export interface Settings {
  availability: AvailabilitySettings;
  pricing: PricingSettings;
  identity: IdentitySettings;
  tax: TaxSettings;
  comms: CommsSettings;
  holds: HoldsSettings;
  scheduling: SchedulingSettings;
  reviews: ReviewsSettings;
}

/** One of the eight top-level settings groups (also the `settings:<group>` key suffix). */
export type SettingsGroup = keyof Settings;
