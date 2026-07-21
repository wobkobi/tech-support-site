// src/shared/lib/settings/defaults.ts
/**
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
    // Weekend lie-in: from Friday 18:00, Sat/Sun slots before noon are blocked.
    morningGuards: [
      {
        enabled: true,
        label: "Weekend mornings",
        triggerDay: 5,
        triggerHour: 18,
        protectedDays: [6, 0],
        earliestHour: 12,
      },
    ],
  },

  // Source: pricing-policy.ts + MIN_TRAVEL_CHARGE in business.ts.
  pricing: {
    gstRegistered: false,
    minBillableMins: 15,
    billingIncrementMins: 5,
    publicHolidayUplift: 0.25,
    minTravelCharge: 10,
    unsuccessfulWorkFactor: 0.5,
    cancellation: {
      freeNoticeHours: 12,
      travelChargeHours: 1,
      callOutFee: 35,
      fullCallOutFee: 65,
      remoteFreeNoticeHours: 4,
      remoteFee: 25,
      autoSendCancellationInvoice: true,
    },
    reschedule: { cutoffHours: 0, maxReschedules: null },
  },

  // Source: the STANDALONE benchmarks hardcoded in the estimate-duration prompt.
  // Standalone times in minutes; the prompt's stacking rules combine them per visit.
  estimator: {
    benchmarks: [
      { label: "Quick software fix, settings change", mins: 30 },
      { label: "Virus removal, general tune-up", mins: 60 },
      { label: "Phone setup (contacts, apps, email)", mins: 60 },
      { label: "Printer setup", mins: 45 },
      { label: "Wi-Fi troubleshooting", mins: 45 },
      { label: "New laptop setup (no data transfer)", mins: 60 },
      { label: "New laptop setup + data transfer from old laptop", mins: 120 },
      { label: "Data/file transfer from old device", mins: 120 },
      { label: "Email / software setup", mins: 45 },
      { label: "Hardware upgrade (RAM, SSD)", mins: 60 },
      { label: "Data recovery", mins: 120 },
      { label: "PC build", mins: 180 },
    ],
    // Confidence-scaled range. Asymmetric on purpose: as confidence falls the
    // low end drops faster than the high end rises, so a vague job reads
    // "from $X" without a scary top number. Editable in the estimator tab.
    range: {
      high: { lowFactor: 0.85, highFactor: 1.2 },
      medium: { lowFactor: 0.7, highFactor: 1.35 },
      low: { lowFactor: 0.55, highFactor: 1.6 },
      minSpread: 20,
    },
    maxJobHours: 8,
    stackHandsOnFactor: 0.5,
    stackBackgroundFactor: 0.2,
    lowEndFloorFactor: 0.75,
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
    homeRegion: "Auckland",
    serviceRadiusKm: 25,
  },

  // Source: DEFAULT_TAX_RATES in tax-planner.ts (sheet still overrides per-FY).
  tax: {
    incomeTax: 0.2,
    acc: 0.0146,
    kiwiSaver: 0.12,
  },

  // Source: cron route literals + contact-review-token.ts.
  comms: {
    notifyConfirmation: true,
    notifyReminder: true,
    notifyReviewRequest: true,
    reminderLeadHours: 24,
    reviewEmailDelayMins: 30,
    priceEstimateRetentionDays: 30,
    invoiceRemindersEnabled: true,
    invoiceReminderFirstDays: 3,
    invoiceReminderSecondDays: 10,
    invoiceReminderMaxCount: 2,
  },

  // Source: calendar-cache.ts travel-block heuristics + edit-window.ts + travel-time route.
  scheduling: {
    travelRoundBufferMin: 10,
    minHomeDwellMin: 60,
    travelBackDepartureBufferMin: 30,
    smartOriginLookaheadHours: 4,
    pastEditLockHours: 18,
    travelQuoteHour: 14,
  },

  // Source: page.tsx getApprovedReviews (take 20) + reviews POST + contact-review-token.ts.
  reviews: {
    homepageFeaturedCount: 20,
    // false preserves today's behaviour: every review starts as pending.
    autoApproveVerified: false,
    invoiceReviewCooldownDays: 30,
  },
};
