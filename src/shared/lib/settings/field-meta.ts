// src/shared/lib/settings/field-meta.ts
/**
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
    blurb: "Income-tax, ACC and KiwiSaver reserve rates.",
  },
  comms: {
    title: "Comms & automation",
    blurb: "Which emails send, when reminders fire, and how long logs are kept.",
  },
  scheduling: {
    title: "Scheduling & travel buffers",
    blurb: "Advanced travel-block heuristics. Leave these unless you know you need them.",
  },
  reviews: {
    title: "Reviews & reputation",
    blurb: "Homepage review count, auto-approval, and request pacing.",
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
  morningGuards: {
    title: "Morning guards",
    description:
      "Protect early slots once the night-before arrives (e.g. from Friday evening, block Sat/Sun before noon). Slots stay bookable if reserved earlier in the week.",
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
  invoiceRemindersEnabled: {
    title: "Overdue invoice reminders",
    description:
      "Email a polite nudge (invoice attached) when a sent invoice goes past its due date, up to the reminder cap.",
    off: "When off, overdue invoices are never chased automatically - the manual Send reminder button still works.",
  },
  invoiceReminderFirstDays: {
    title: "First reminder",
    description: "Days past the due date before the first nudge.",
    unit: "days overdue",
  },
  invoiceReminderSecondDays: {
    title: "Second reminder",
    description: "Days past the due date before the second nudge.",
    unit: "days overdue",
  },
  invoiceReminderMaxCount: {
    title: "Maximum reminders",
    description: "Stop automatically chasing an invoice after this many reminders have been sent.",
    unit: "reminders",
    off: "Set 0 to never send an automatic reminder.",
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
  homeRegion: {
    title: "Home region",
    description: "Your region for the regional anniversary public holiday (e.g. Auckland).",
  },
  serviceRadiusKm: {
    title: "Service-area radius",
    description: "How far you travel for on-site jobs; advertised in the site's map data for SEO.",
    unit: "km",
  },
  servedSuburbs: {
    title: "Served suburbs",
    description: "Suburbs you cover, listed in the site's map data for local SEO.",
  },
};

/** Field metadata for the tax-planner group, keyed by dotted path. */
export const TAX_FIELD_META: Record<string, FieldMeta> = {
  incomeTax: {
    title: "Income-tax reserve rate",
    description:
      "Percent of profit set aside for income tax. Used by the dashboard planner; a per-FY workbook rate, when present, still takes precedence.",
    unit: "%",
  },
  acc: {
    title: "ACC levy rate",
    description: "Percent of profit reserved for the ACC levy (e.g. 1.46%).",
    unit: "%",
  },
  kiwiSaver: {
    title: "KiwiSaver rate",
    description: "Voluntary KiwiSaver contribution as a percent of profit.",
    unit: "%",
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
  pastEditLockHours: {
    title: "Past-edit lock window",
    description:
      "How long after a job ends you can still edit it, change its status, or block the day. After this, past history locks to prevent accidental changes.",
    unit: "hours",
    off: "Set 0 to lock a job the moment it ends.",
  },
  travelQuoteHour: {
    title: "Travel-quote time",
    description:
      "When a customer hasn't picked a slot yet, drive time is quoted against this hour of the day (a realistic-traffic proxy rather than whenever they opened the page).",
    unit: "hour 0-23",
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
  unsuccessfulWorkFactor: {
    title: "Unsuccessful-visit charge",
    description:
      "Fraction of the labour billed when a visit is unsuccessful - neither fixed nor diagnosed (50 = half price).",
    unit: "%",
    off: "Set 0 to charge nothing for an unsuccessful visit.",
  },
  "cancellation.freeNoticeHours": {
    title: "Free-cancellation window (in-person)",
    description:
      "In-person cancellations made more than this many hours before the appointment are free. Remote sessions have their own, shorter window below.",
    unit: "hours",
  },
  "cancellation.travelChargeHours": {
    title: "Full call-out window",
    description:
      "Cancelling within this many hours bills the full call-out plus round-trip travel, instead of the flat cancellation fee (you'd already be on the way).",
    unit: "hours",
  },
  "cancellation.callOutFee": {
    title: "Cancellation fee",
    description:
      "Flat fee charged when a cancellation lands inside the free-cancellation window but outside the full call-out window.",
    unit: "$",
  },
  "cancellation.fullCallOutFee": {
    title: "Full call-out fee",
    description:
      "Charged instead of the cancellation fee when they cancel inside the full call-out window, or don't show at all. Round-trip travel is added on top.",
    unit: "$",
  },
  "cancellation.remoteFreeNoticeHours": {
    title: "Remote free-cancellation window",
    description:
      "Remote sessions can be cancelled free up to this many hours before. Shorter than the in-person window because there's no drive to plan around.",
    unit: "hours",
  },
  "cancellation.remoteFee": {
    title: "Remote cancellation fee",
    description:
      "Flat fee for a remote session cancelled inside its window, or a remote no-show. No call-out tier and no travel - a remote cancel only costs you the slot.",
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
  maxJobHours: {
    title: "Max job length",
    description:
      "Hard ceiling on any single-visit estimate, so a runaway estimate can't quote days.",
    unit: "hours",
  },
  stackHandsOnFactor: {
    title: "Extra hands-on task",
    description:
      "How much an additional hands-on task adds vs doing it alone (50 = half), since you're already on-site and set up.",
    unit: "%",
  },
  stackBackgroundFactor: {
    title: "Background task",
    description:
      "How much a background task (data transfer, virus scan, updates) adds vs alone (20 = a fifth), since it runs unattended while you work.",
    unit: "%",
  },
  lowEndFloorFactor: {
    title: "Low-end floor",
    description:
      "The advertised low price never drops below this share of straight-time cost (75 = 75%), so a vague job still quotes a fair minimum.",
    unit: "%",
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
  scheduling: SCHEDULING_FIELD_META,
  reviews: REVIEWS_FIELD_META,
};
