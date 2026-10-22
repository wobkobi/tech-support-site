// src/shared/lib/settings/types.ts
// Admin-editable settings shapes, one interface per group. Defaults in defaults.ts; optional rules
// use `null`/`0` for "off".

import type { IetcConfig, TaxBracket, VehicleFuel } from "@/features/business/lib/tax/types";
import type { Weekday } from "@/shared/lib/timezone-utils";

/** One weekday's bookable window. See {@link Weekday} for the key numbering. */
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

/**
 * Seven-day availability map keyed by {@link Weekday} (0 = Sunday .. 6 = Saturday). Every day is
 * always present via the defaults, so reads need no presence check (except `checkGuardrails` on drafts).
 */
export type WeeklySchedule = Record<Weekday, DayWindow>;

/**
 * Once `now` passes `triggerDay` at `triggerHour`, slots on `protectedDays` before `earliestHour`
 * block, unless booked earlier (e.g. Fri 18:00 > Sat/Sun before noon). Days use `getUTCDay()` indexing.
 */
export interface MorningGuard {
  /** When false the rule is ignored. */
  enabled: boolean;
  /** Operator-friendly name shown in the editor, e.g. "Weekend lie-in". */
  label: string;
  /** The "night before" weekday the guard switches on (0-6). */
  triggerDay: number;
  /** Hour on `triggerDay` after which the guard activates (0-23). */
  triggerHour: number;
  /** Weekdays whose morning is restricted while the guard is active. */
  protectedDays: number[];
  /** Earliest bookable hour on the protected days once active (0-23). */
  earliestHour: number;
}

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
  /** Morning-protection rules (e.g. weekend lie-in). Empty = no guards. */
  morningGuards: MorningGuard[];
}

interface CancellationSettings {
  /** Cancellations more than this many hours out are free. */
  freeNoticeHours: number;
  /** Inside this window a cancellation also bills round-trip travel. */
  travelChargeHours: number;
  /** Flat in-person cancellation fee inside the free-notice window but outside the travel window. */
  callOutFee: number;
  /** Full call-out billed for an in-person cancel inside the travel window, or on a no-show. Replaces callOutFee rather than stacking, and travel is added on top. */
  fullCallOutFee: number;
  /** Remote cancellations more than this many hours out are free. Priced separately - a remote session costs the slot but no drive. */
  remoteFreeNoticeHours: number;
  /** Flat fee for a remote cancel inside its window, or a remote no-show. No call-out tier and no travel. */
  remoteFee: number;
  /** When true, a customer self-cancel via the website auto-sends the fee invoice instead of leaving it as a draft. */
  autoSendCancellationInvoice: boolean;
}

interface RescheduleSettings {
  /** Can't reschedule within this many hours of the booking. 0 = no limit. */
  cutoffHours: number;
  /** Max times one booking can be rescheduled. null/0 = no limit. */
  maxReschedules: number | null;
}

export interface PricingSettings {
  /** When true invoices show GST; requires a GST number to be set. */
  gstRegistered: boolean;
  /**
   * Date GST registration took effect ("YYYY-MM-DD"); "" = from the business start.
   * Expenses dated before it count GST-inclusive for profit and tax.
   */
  gstRegisteredFrom: string;
  /** Minimum billable time floor (minutes). 0 = no floor. */
  minBillableMins: number;
  /** Round-to-nearest billable step (minutes); shared with the AI parser snap. */
  billingIncrementMins: number;
  /**
   * Minutes a quick one-shot task is billed at (the AI parser's SHORT set), so trivial work
   * can't take an even share of a long session.
   */
  shortTaskMins: number;
  /** Minutes a task can shrink to before it's dropped from the invoice as descriptive noise. */
  minTaskMins: number;
  /** Hard ceiling on one job's billable time (minutes); clamps AI-parsed durations. */
  maxJobMins: number;
  /** Public-holiday labour surcharge, fraction (0.25 = +25%). 0 = no surcharge. */
  publicHolidayUplift: number;
  /**
   * Weekend labour surcharge fraction (0.1 = +10%); a weekend holiday takes the holiday surcharge
   * instead, never both. 0 = none.
   */
  weekendUplift: number;
  /** Minimum travel charge floor (NZD). 0 = no floor. */
  minTravelCharge: number;
  /** Hourly rate for drive time (NZD/hr); prices every round trip. */
  travelRatePerHour: number;
  /** Fraction charged when a visit is unsuccessful (0.5 = half price, 0 = free). */
  unsuccessfulWorkFactor: number;
  /** Minutes covered free at the start of a return visit, when the previous one ended without a fix. 0 = no stated grace. */
  noFixFreeMins: number;
  /** Days after a visit during which fallout from that visit's changes is fixed free. 0 = no stated guarantee. */
  workmanshipWindowDays: number;
  /**
   * Largest same-day gap (minutes) for the calculator to suggest billing two events as one job.
   */
  mergeSuggestGapMins: number;
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

/** Search-engine opening hours when they differ from the bookable schedule; one window for every enabled day. */
export interface PublishedHours {
  /** Advertised opening hour, 0-23 NZ-local. */
  open: number;
  /** Advertised closing hour, 1-24 NZ-local. Must be greater than `open`. */
  close: number;
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
  homeRegion: string;
  /** Advertised service-area radius in km (drives the SEO GeoCircle). */
  serviceRadiusKm: number;
  /**
   * Overrides the schema.org hours, so Google's listing can be narrower than bookable hours.
   * null = publish each day's real window.
   */
  publishedHours: PublishedHours | null;
  /**
   * Email signature under the logo, one line per row. Takes `{name}`/`{company}`/`{phone}`/
   * `{email}`/`{website}`/`{location}` and `**bold**`; blank rows become spacing.
   */
  emailSignature: string;
}

/** One task-duration benchmark: a short label and its standalone minutes. */
export interface Benchmark {
  label: string;
  /** How long this task takes on its own, in minutes. */
  mins: number;
}

/** How confident the estimator is in a quote; drives how wide the price range is. */
export type EstimateConfidence = "high" | "medium" | "low";

/** Low/high multipliers applied to the point estimate for one confidence level. */
interface EstimatorRangeBand {
  /** Multiplier for the LOW end of the range (e.g. 0.85 = 85% of the point estimate). */
  lowFactor: number;
  /** Multiplier for the HIGH end of the range (e.g. 1.2 = 120%). */
  highFactor: number;
}

/**
 * Confidence-scaled estimator range widths. The low end drops faster than the high end rises,
 * so vague jobs read "from $X" without inflating the top.
 */
export interface EstimatorRange {
  high: EstimatorRangeBand;
  medium: EstimatorRangeBand;
  low: EstimatorRangeBand;
  /** Minimum dollar gap between low and high so tiny jobs don't look falsely precise. */
  minSpread: number;
}

export interface EstimatorSettings {
  /** Task-duration baselines the estimator starts from before stacking rules combine tasks. */
  benchmarks: Benchmark[];
  /** Confidence-scaled width of the customer-facing price range. */
  range: EstimatorRange;
  /** Hard ceiling on any single-visit estimate (hours). */
  maxJobHours: number;
  /** Fraction an additional hands-on task adds vs its standalone time (0.5 = 50%). */
  stackHandsOnFactor: number;
  /** Fraction a background task (transfer, scan, update) adds vs standalone (0.2 = 20%). */
  stackBackgroundFactor: number;
  /** The advertised low end never drops below this fraction of straight-time cost. */
  lowEndFloorFactor: number;
}

export interface TaxSettings {
  /** ACC levy estimate (fraction). */
  acc: number;
  /** KiwiSaver contribution rate (fraction). */
  kiwiSaver: number;
  /** Income-tax bands, lowest first; the last band has `upTo: null`. */
  brackets: TaxBracket[];
  /** Independent earner tax credit. */
  ietc: IetcConfig;
  /** Bought items at or under this (NZD, on the GST basis) are written off in full. */
  lowValueThreshold: number;
  /** Residual income tax above this (NZD) means provisional tax the next year. */
  provisionalThreshold: number;
  /** Fuel type that picks the IRD kilometre rates. */
  vehicleFuel: VehicleFuel;
  /** Business-use percent (0-100) per expense category; a missing category counts as 100. */
  categoryBusinessUse: Record<string, number>;
}

export interface CommsSettings {
  notifyConfirmation: boolean;
  notifyReminder: boolean;
  /** Push to the operator's devices when a booking is made or rescheduled. */
  pushOnBooking: boolean;
  /** Push to the operator's devices when a customer cancels. */
  pushOnCancellation: boolean;
  /** Push to the operator's devices when a review is submitted. */
  pushOnReview: boolean;
  /** Send the booking reminder this many hours before the appointment. */
  reminderLeadHours: number;
  /** How long price-estimate logs are kept before auto-purge (days). */
  priceEstimateRetentionDays: number;
  /** Master switch for the overdue-invoice reminder emails. */
  invoiceRemindersEnabled: boolean;
  /** Days past due before the first overdue nudge. */
  invoiceReminderFirstDays: number;
  /** Days past due before the second (and final) nudge. */
  invoiceReminderSecondDays: number;
  /** Maximum number of automatic overdue reminders per invoice. */
  invoiceReminderMaxCount: number;
  /** Master switch for the apology sent when a reminder chased an already-paid invoice. */
  invoiceApologyEnabled: boolean;
  /** Hold customer email overnight; Resend does the waiting, so the action completes now. */
  quietHoursEnabled: boolean;
  /** NZ hour the quiet window opens (0-23). */
  quietHoursStart: number;
  /** NZ hour it closes again next morning (0-23). */
  quietHoursEnd: number;
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
  /** Hours after a job ends before it locks from further edits/status changes. */
  pastEditLockHours: number;
  /** NZ hour a no-slot travel quote is priced against (realistic-traffic proxy). */
  travelQuoteHour: number;
}

export interface ReviewsSettings {
  /** How many approved reviews feature on the home page. */
  homepageFeaturedCount: number;
  /** When true, reviews verified via a booking/contact token auto-approve. */
  autoApproveVerified: boolean;
  /**
   * Google "write a review" link: the main button of every review ask and /review, shown to
   * everyone (Google bans asking only happy customers). Empty falls back to the site form.
   */
  googleReviewUrl: string;
  /** When true, the daily job emails a review ask a few days after each invoice. */
  reviewAskEnabled: boolean;
  /** Whole days after the invoice is sent before its review ask goes out. */
  reviewAskDelayDays: number;
  /** Minimum days between two review asks to the same person. */
  reviewAskGapDays: number;
}

/** Which apps Write with AI adds hashtags for unless the post says otherwise. */
export type HashtagsDefault = "never" | "instagram" | "always";

/** What every AI writer should know about the business, and Write with AI's starting choices. */
export interface BrandProfile {
  /**
   * Anything about the business the website doesn't already say. Hours, area, rates and
   * services reach every AI writer from the live settings, so they don't belong here.
   */
  notes: string;
  /** Who the posts and emails are written for. */
  audience: string;
  /** How the writing should sound, on top of the house voice. */
  tone: string;
  /** Words or topics the AI writers must never use. */
  avoid: string;
  /** Brand hashtags as typed; `parseHashtags` reads them. */
  hashtags: string;
  /** When Write with AI's Hashtags tickbox starts ticked. */
  hashtagsOn: HashtagsDefault;
  /** Whether Write with AI's Emoji tickbox starts ticked. */
  emojiOn: boolean;
}

/** Logo artwork "Add my logo" can put on a photo: the Post maker's logo choices. */
export type WatermarkLogo = "mark" | "profile" | "wordmark" | "full";

/** The corner of a photo the logo sits in. */
export type WatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** "Add my logo" for photos uploaded in the post composer. */
export interface WatermarkSettings {
  /** Whether a new photo gets the logo as it uploads. Each photo's toggle can still change it. */
  on: boolean;
  logo: WatermarkLogo;
  corner: WatermarkCorner;
  /** Logo size as a percentage of the photo's shorter edge. */
  size: number;
  /** How solid the logo and its white backing are, as a percentage. */
  opacity: number;
}

/** How far ahead schedules line up postings, and where a new time slot starts. */
export interface ScheduleSettings {
  /** Days ahead each schedule lines up its postings. */
  fillDays: number;
  /** Minutes after NZ midnight a new time slot starts at, in 15-minute steps. */
  defaultMinute: number;
}

export interface SocialSettings {
  brand: BrandProfile;
  watermark: WatermarkSettings;
  schedules: ScheduleSettings;
}

export interface Settings {
  availability: AvailabilitySettings;
  pricing: PricingSettings;
  estimator: EstimatorSettings;
  identity: IdentitySettings;
  tax: TaxSettings;
  comms: CommsSettings;
  scheduling: SchedulingSettings;
  reviews: ReviewsSettings;
  social: SocialSettings;
}

/** One of the top-level settings groups (also the `settings:<group>` key suffix). */
export type SettingsGroup = keyof Settings;
