// src/shared/lib/settings/defaults.ts
/**
 * @file defaults.ts
 * @description Canonical default for every settings group, transcribed from the
 * constants that lived in code before the settings panel. `get-settings.ts`
 * merges DB overrides on top of these, so an empty/missing/unreachable Setting
 * row always falls back to today's behaviour. Kept dependency-free (no Prisma,
 * no next/cache) so the seed script and client code can both import it.
 *
 * Identity secrets default from the existing env vars so the panel self-seeds
 * with the current values until the one-shot seed hands them to the DB.
 */

import type { Settings, WeeklySchedule } from "@/shared/lib/settings/types";

/** Bank-account placeholder shown when neither the DB nor the env var is set. */
export const BANK_ACCOUNT_PLACEHOLDER = "[BANK ACCOUNT NOT SET - configure in admin settings]";

/**
 * Builds the default weekly window: every day open 10:00-20:00, no break
 * (today's behaviour before per-weekday hours).
 * @returns A seven-day schedule with every day enabled.
 */
function defaultSchedule(): WeeklySchedule {
  const schedule: WeeklySchedule = {};
  for (let day = 0; day <= 6; day++) {
    schedule[day] = { enabled: true, open: 10, close: 20, break: null };
  }
  return schedule;
}

export const DEFAULT_SETTINGS: Settings = {
  // Source: BOOKING_CONFIG + DURATION_OPTIONS + SUB_SLOT_MINUTES in booking.ts.
  availability: {
    acceptingBookings: true,
    closedMessage:
      "Online booking is paused right now. Please get in touch and I'll sort a time with you directly.",
    schedule: defaultSchedule(),
    maxAdvanceDays: 14,
    minHoursNotice: 2,
    sameDayCutoffHour: 18,
    bufferMin: 15,
    bookingBufferAfterMin: 30,
    subSlotMinutes: [0, 15, 30, 45],
    durations: { short: 60, long: 120 },
    maxJobsPerDay: null,
    maxBillableHoursPerDay: null,
  },

  // Source: pricing-policy.ts + MIN_TRAVEL_CHARGE in business.ts.
  pricing: {
    gstRegistered: false,
    minBillableMins: 15,
    billingIncrementMins: 5,
    publicHolidayUplift: 0.25,
    minTravelCharge: 10,
    cancellation: { freeNoticeHours: 12, travelChargeHours: 2, callOutFee: 30 },
    reschedule: { cutoffHours: 0, maxReschedules: null },
  },

  // Source: business-identity.ts + layout.tsx JSON-LD + HOME_ADDRESS env.
  identity: {
    name: "Harrison Raynes",
    company: "To The Point",
    email: "harrison@tothepoint.co.nz",
    phone: "021 297 1237",
    phoneTel: "tel:+64212971237",
    website: "tothepoint.co.nz",
    location: "Auckland, New Zealand",
    baseAddress: {
      line: process.env.HOME_ADDRESS ?? "",
      locality: "Point Chevalier",
      postcode: "1022",
      lat: -36.8717,
      lng: 174.7185,
    },
    // Populated from layout.tsx's servedSuburbs when the identity group is wired.
    servedSuburbs: [],
    paymentTermsDays: 7,
    startDateIso: "2025-10-01T00:00:00Z",
    gstNumber: process.env.NEXT_PUBLIC_BUSINESS_GST_NUMBER ?? "",
    bankAccount: process.env.NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT ?? BANK_ACCOUNT_PLACEHOLDER,
    invoicePrefix: "TTP",
    homeRegion: "Auckland",
  },

  // Source: DEFAULT_TAX_RATES in tax-planner.ts (sheet still overrides per-FY).
  tax: {
    incomeTax: 0.2,
    acc: 0.0146,
    kiwiSaver: 0.12,
    weeklyKiwiSaver: 0,
    weeklyTax: 0,
  },

  // Source: cron route literals + contact-review-token.ts.
  comms: {
    notifyConfirmation: true,
    notifyReminder: true,
    notifyReviewRequest: true,
    reminderLeadHours: 24,
    reviewEmailDelayMins: 30,
    priceEstimateRetentionDays: 30,
  },

  // Source: booking/hold route + BOOKING_FIELD_LIMITS in booking.ts.
  holds: {
    holdExpirationMinutes: 15,
    notesMaxLength: 2000,
    notesMinLength: 10,
  },

  // Source: calendar-cache.ts travel-block heuristics.
  scheduling: {
    travelRoundBufferMin: 10,
    minHomeDwellMin: 60,
    travelBackDepartureBufferMin: 30,
    smartOriginLookaheadHours: 4,
  },

  // Source: page.tsx getApprovedReviews (take 20) + reviews POST + contact-review-token.ts.
  reviews: {
    homepageFeaturedCount: 20,
    // false preserves today's behaviour: every review starts as pending.
    autoApproveVerified: false,
    invoiceReviewCooldownDays: 30,
  },
};
