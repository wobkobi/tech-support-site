// src/shared/lib/settings/field-meta.ts
/**
 * @file field-meta.ts
 * @description UI metadata for the settings panel - the plain-English title,
 * description, unit, and (for optional rules) the "what happens when it's off"
 * note shown above each field. Kept here, beside the defaults and validators,
 * so the help text and the rules never drift apart. Authored per group as each
 * tab is built; {@link GROUP_META} covers all groups so the tab bar can render.
 */

import type { SettingsGroup } from "@/shared/lib/settings/types";

/** Display metadata for one editable field, keyed by its dotted path in a group. */
export interface FieldMeta {
  /** Short human title shown as the field label. */
  title: string;
  /** One-line plain-English explanation of what the field controls. */
  description: string;
  /** Unit suffix shown next to the input (e.g. "hours", "$", "minutes"). */
  unit?: string;
  /** What happens when the field is blank/0 (only for optional "off"-able rules). */
  off?: string;
}

/** Title + section blurb for each settings group (drives the tab bar + headers). */
export const GROUP_META: Record<SettingsGroup, { title: string; blurb: string }> = {
  availability: {
    title: "Availability & booking",
    blurb: "Weekly hours, booking window, buffers, and the master booking switch.",
  },
  pricing: {
    title: "Pricing & cancellation",
    blurb: "Cancellation policy, minimum charges, public-holiday surcharge, and GST status.",
  },
  estimator: {
    title: "Price estimator",
    blurb:
      "Task-duration benchmarks the public price estimator uses to gauge how long a job takes.",
  },
  identity: {
    title: "Business identity",
    blurb: "Contact details, base address, payment terms, GST number, and bank account.",
  },
  tax: {
    title: "Tax planner",
    blurb: "Income-tax, ACC and KiwiSaver reserve rates plus weekly transfer amounts.",
  },
  comms: {
    title: "Comms & automation",
    blurb: "Which emails send, when reminders fire, and how long logs are kept.",
  },
  holds: {
    title: "Booking form & holds",
    blurb: "Hold expiry and the job-description length limits.",
  },
  scheduling: {
    title: "Scheduling & travel buffers",
    blurb: "Advanced travel-block heuristics. Leave these unless you know you need them.",
  },
  reviews: {
    title: "Reviews & reputation",
    blurb: "Homepage review count, auto-approval, the review link, and request pacing.",
  },
};

/** Field metadata for the availability group's scalar fields, keyed by dotted path. */
export const AVAILABILITY_FIELD_META: Record<string, FieldMeta> = {
  acceptingBookings: {
    title: "Accepting online bookings",
    description:
      "Master switch. Turn off to pause the public booking page (e.g. when you're away).",
  },
  closedMessage: {
    title: "Paused message",
    description: "Shown on the booking page while online booking is paused.",
  },
  maxAdvanceDays: {
    title: "Booking window",
    description: "How many days ahead a customer can book.",
    unit: "days",
  },
  minHoursNotice: {
    title: "Minimum notice",
    description: "How far in advance a customer must book.",
    unit: "hours",
    off: "Set 0 to allow booking right up to the current time.",
  },
  sameDayCutoffHour: {
    title: "Same-day cutoff",
    description: "After this hour (24-hour clock) same-day booking closes for the rest of the day.",
    unit: "hour 0-23",
    off: "Leave blank for no same-day cutoff.",
  },
  bufferMin: {
    title: "Calendar buffer",
    description: "Gap kept clear around your existing calendar events when offering slots.",
    unit: "minutes",
  },
  bookingBufferAfterMin: {
    title: "After-booking buffer",
    description: "Time blocked after each booking ends, in case a job runs long.",
    unit: "minutes",
  },
  "durations.short": {
    title: "Standard job length",
    description: "Length of a standard (short) appointment.",
    unit: "minutes",
  },
  "durations.long": {
    title: "Extended job length",
    description: "Length of an extended (long) appointment.",
    unit: "minutes",
  },
  maxJobsPerDay: {
    title: "Max jobs per day",
    description: "Stop offering slots on a day once this many bookings already exist.",
    unit: "jobs",
    off: "Set 0 or leave blank for no daily limit.",
  },
  maxBillableHoursPerDay: {
    title: "Max hours per day",
    description: "Stop offering slots on a day once this many booked hours already exist.",
    unit: "hours",
    off: "Set 0 or leave blank for no daily limit.",
  },
};

/** Field metadata for the comms group, keyed by field name. */
export const COMMS_FIELD_META: Record<string, FieldMeta> = {
  notifyConfirmation: {
    title: "Booking confirmation email",
    description: "Send the customer a confirmation email when they book.",
  },
  notifyReminder: {
    title: "Appointment reminder email",
    description: "Send the customer a reminder the day before their appointment.",
  },
  notifyReviewRequest: {
    title: "Review-request email",
    description: "Email the customer a review request a little after the job finishes.",
  },
  reminderLeadHours: {
    title: "Reminder lead time",
    description: "Send the reminder once the appointment is within this many hours.",
    unit: "hours",
  },
  reviewEmailDelayMins: {
    title: "Review-request delay",
    description: "Wait this long after a job ends before sending the review request.",
    unit: "minutes",
  },
  priceEstimateRetentionDays: {
    title: "Estimate-log retention",
    description: "Delete public price-estimate logs older than this many days.",
    unit: "days",
  },
};

/** Field metadata for the reviews group, keyed by field name. */
export const REVIEWS_FIELD_META: Record<string, FieldMeta> = {
  homepageFeaturedCount: {
    title: "Featured reviews on homepage",
    description: "How many approved reviews show on the home page.",
    unit: "reviews",
  },
  autoApproveVerified: {
    title: "Auto-approve verified reviews",
    description:
      "When on, a review left through a genuine booking/contact link is published immediately instead of waiting for your approval. Unverified reviews always wait.",
  },
  invoiceReviewCooldownDays: {
    title: "Review-request cooldown",
    description: "Minimum days before the same customer is asked for a review again.",
    unit: "days",
  },
};

/** Field metadata for the business identity group, keyed by dotted path. */
export const IDENTITY_FIELD_META: Record<string, FieldMeta> = {
  name: { title: "Operator name", description: "Your name, shown in emails and on invoices." },
  company: {
    title: "Business name",
    description: "Trading name shown across the site and invoices.",
  },
  email: { title: "Contact email", description: "Customer-facing email address." },
  phone: {
    title: "Phone (display)",
    description: "Phone number as shown to customers, e.g. 021 297 1237.",
  },
  phoneTel: {
    title: "Phone (tel: link)",
    description: "Phone for click-to-call links, e.g. tel:+64212971237.",
  },
  website: { title: "Website", description: "Public website, no scheme (e.g. tothepoint.co.nz)." },
  location: {
    title: "Location",
    description: "Locality shown in email signatures (e.g. Auckland, New Zealand).",
  },
  "baseAddress.line": {
    title: "Base address",
    description: "Your home/base street address - the origin every travel charge is measured from.",
  },
  "baseAddress.locality": {
    title: "Suburb / locality",
    description: "Suburb used in the business address.",
  },
  "baseAddress.postcode": {
    title: "Postcode",
    description: "Postcode used in the business address.",
  },
  "baseAddress.lat": {
    title: "Latitude",
    description: "Map latitude for the business location (SEO).",
  },
  "baseAddress.lng": {
    title: "Longitude",
    description: "Map longitude for the business location (SEO).",
  },
  paymentTermsDays: {
    title: "Payment terms",
    description: "Days from issue until an invoice is due.",
    unit: "days",
  },
  startDateIso: {
    title: "Business start date",
    description:
      "When the business started operating; used to label the first (partial) financial year.",
  },
  gstNumber: {
    title: "GST number",
    description:
      "Your IRD GST number. Shown on tax invoices once GST-registered. Leave blank if not registered.",
  },
  bankAccount: {
    title: "Bank account",
    description: "Account number shown on invoices for payment.",
  },
  invoicePrefix: {
    title: "Invoice prefix",
    description: "Prefix for invoice numbers (e.g. TTP in TTP-2627-0001).",
  },
  homeRegion: {
    title: "Home region",
    description: "Your region for the regional anniversary public holiday (e.g. Auckland).",
  },
};

/** Field metadata for the booking form & holds group, keyed by field name. */
export const HOLDS_FIELD_META: Record<string, FieldMeta> = {
  holdExpirationMinutes: {
    title: "Hold expiry",
    description:
      "How long a slot stays reserved while a customer finishes booking, before it's released for others.",
    unit: "minutes",
  },
};

/** Field metadata for the tax-planner group, keyed by dotted path. */
export const TAX_FIELD_META: Record<string, FieldMeta> = {
  incomeTax: {
    title: "Income-tax reserve rate",
    description:
      "Fraction of profit set aside for income tax (0.2 = 20%). Used by the dashboard planner; a per-FY workbook rate, when present, still takes precedence.",
  },
  acc: {
    title: "ACC levy rate",
    description: "Fraction of profit reserved for the ACC levy (0.0146 = 1.46%).",
  },
  kiwiSaver: {
    title: "KiwiSaver rate",
    description: "Voluntary KiwiSaver contribution as a fraction of profit (0.12 = 12%).",
  },
  weeklyKiwiSaver: {
    title: "Weekly KiwiSaver transfer",
    description: "The amount moved to KiwiSaver each week, shown on the planner's savings target.",
    unit: "$",
  },
  weeklyTax: {
    title: "Weekly tax transfer",
    description: "The amount moved to the tax account each week, shown on the planner.",
    unit: "$",
  },
};

/** Field metadata for the advanced scheduling group, keyed by dotted path. */
export const SCHEDULING_FIELD_META: Record<string, FieldMeta> = {
  travelRoundBufferMin: {
    title: "Travel rounding buffer",
    description:
      "Extra minutes added to each travel block before rounding up, to absorb job overrun and traffic.",
    unit: "minutes",
    off: "Set 0 to block only the raw estimated travel time.",
  },
  minHomeDwellMin: {
    title: "Minimum home dwell",
    description:
      "If returning home then leaving again leaves less than this gap, the travel-back block is skipped (you'd stay out).",
    unit: "minutes",
    off: "Set 0 to always create a travel-back block.",
  },
  travelBackDepartureBufferMin: {
    title: "Travel-back departure buffer",
    description:
      "Wind-down time after a booking ends before the travel-back block starts, so you're not rushed out the door.",
    unit: "minutes",
    off: "Set 0 to depart immediately when the booking ends.",
  },
  smartOriginLookaheadHours: {
    title: "Smart-origin lookahead",
    description:
      "How far back to look for a preceding event to measure travel from, instead of always from home base.",
    unit: "hours",
    off: "Set 0 to always measure travel from the home base.",
  },
};

/** Field metadata for the pricing group, keyed by dotted path. */
export const PRICING_FIELD_META: Record<string, FieldMeta> = {
  gstRegistered: {
    title: "GST registered",
    description:
      "Turn on once you cross the $60k GST threshold. Invoices then show a GST breakdown. Requires a GST number to be set.",
  },
  minBillableMins: {
    title: "Minimum billable time",
    description: "The smallest amount of time any billable work is charged at.",
    unit: "minutes",
    off: "Set 0 for no minimum - bill the exact time worked.",
  },
  billingIncrementMins: {
    title: "Billing increment",
    description:
      "Billable time is rounded to the nearest step of this size. Shared with the job calculator.",
    unit: "minutes",
  },
  publicHolidayUplift: {
    title: "Public-holiday surcharge",
    description:
      "Extra added to labour on NZ public holidays (25 = +25%). Travel and parts are unchanged.",
    unit: "%",
    off: "Set 0 to charge normal rates on public holidays.",
  },
  minTravelCharge: {
    title: "Minimum travel charge",
    description:
      "The floor applied whenever there is any travel, so short trips don't bill an awkward few dollars.",
    unit: "$",
    off: "Set 0 for no floor - bill the exact travel time.",
  },
  "cancellation.freeNoticeHours": {
    title: "Free-cancellation window",
    description: "Cancellations made more than this many hours before the appointment are free.",
    unit: "hours",
  },
  "cancellation.travelChargeHours": {
    title: "Travel-charge window",
    description:
      "Cancelling within this many hours also bills round-trip travel (you'd already be on the way).",
    unit: "hours",
  },
  "cancellation.callOutFee": {
    title: "Call-out fee",
    description: "Flat fee charged when a cancellation lands inside the free-cancellation window.",
    unit: "$",
  },
  "cancellation.autoSendCancellationInvoice": {
    title: "Auto-send fee invoice",
    description:
      "When a customer cancels their own booking on the website inside the fee window, email the fee invoice straight away instead of leaving it as a draft. No-show and operator cancels always stay drafts for you to review.",
  },
  "reschedule.cutoffHours": {
    title: "Reschedule cutoff",
    description: "Customers can't reschedule within this many hours of the appointment.",
    unit: "hours",
    off: "Set 0 to allow rescheduling right up to the appointment.",
  },
  "reschedule.maxReschedules": {
    title: "Max reschedules",
    description:
      "How many times one booking may be moved before it has to be cancelled and rebooked.",
    unit: "times",
    off: "Leave blank for no limit.",
  },
};

/** Metadata for the estimator group's editable fields (benchmark list + range widths). */
export const ESTIMATOR_FIELD_META: Record<string, FieldMeta> = {
  benchmarks: {
    title: "Task-duration benchmarks",
    description:
      "How long each task takes on its own. The estimator combines these for multi-task visits. Edit a time, add a task, or remove one.",
    unit: "minutes",
  },
  "range.high.lowFactor": {
    title: "Detailed job - low end",
    description: "Low price as a % of the estimate when the description is clear.",
    unit: "%",
  },
  "range.high.highFactor": {
    title: "Detailed job - high end",
    description: "High price as a % of the estimate when the description is clear.",
    unit: "%",
  },
  "range.medium.lowFactor": {
    title: "Some detail - low end",
    description: "Low price % for a partly-specified job.",
    unit: "%",
  },
  "range.medium.highFactor": {
    title: "Some detail - high end",
    description: "High price % for a partly-specified job.",
    unit: "%",
  },
  "range.low.lowFactor": {
    title: "Vague job - low end",
    description: "Low price % when the description is thin (drop this to read 'from $X').",
    unit: "%",
  },
  "range.low.highFactor": {
    title: "Vague job - high end",
    description: "High price % when the description is thin (keep modest so it doesn't deter).",
    unit: "%",
  },
  "range.minSpread": {
    title: "Minimum range spread",
    description:
      "Smallest dollar gap between low and high so tiny jobs don't look falsely precise.",
    unit: "$",
  },
};

/** Per-group field metadata, keyed by group - powers the settings search. */
export const FIELD_META_BY_GROUP: Record<SettingsGroup, Record<string, FieldMeta>> = {
  availability: AVAILABILITY_FIELD_META,
  pricing: PRICING_FIELD_META,
  estimator: ESTIMATOR_FIELD_META,
  identity: IDENTITY_FIELD_META,
  tax: TAX_FIELD_META,
  comms: COMMS_FIELD_META,
  holds: HOLDS_FIELD_META,
  scheduling: SCHEDULING_FIELD_META,
  reviews: REVIEWS_FIELD_META,
};
