// src/features/business/types/business.ts
// Shared business types: rates, line items, invoices, ledger rows and job-calculation shapes.

import type { CancelMeetingType } from "@/features/business/lib/pricing-policy";

export interface RateConfig {
  id: string;
  label: string;
  /** Set on base hourly rates (e.g. Standard $65/hr). Null on modifiers and flat rates. */
  ratePerHour: number | null;
  /** Set on flat per-unit rates. Null on hourly bases and modifiers. */
  flatRate: number | null;
  /** Set on modifier rates (signed $/hr delta, e.g. -10 for At home). Null on bases and flat rates. */
  hourlyDelta: number | null;
  /** Set on percent modifiers (e.g. -0.1 for a 10% Gold Card). Multiplies the post-delta rate. */
  percentDelta: number | null;
  unit: string;
  isDefault: boolean;
  createdAt: string;
}

export interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /**
   * Whole billed minutes, authoritative on hourly lines (`qty` can't hold 10 min = 0.1667h
   * exactly). Absent on flat rows; Prisma reads a missing field as null, so treat both alike.
   */
  minutes?: number | null;
}

/** The one hourly rate pair a promo billed a job's discounted labour at. */
export interface PromoRateSummary {
  /** Billed minutes on the lines the promo discounted. */
  mins: number;
  /** Their hourly rate before the promo. */
  before: number;
  /** Their hourly rate under the promo. */
  after: number;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "VOIDED";

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  /** NZ date the work was done (YYYY-MM-DD), printed as "Work done"; null on older invoices. */
  jobDate?: string | null;
  /** Number of the voided invoice this one replaces, printed under its own number. */
  replacesNumber?: string | null;
  lineItems: LineItem[];
  /** @deprecated Storage shape only; GST mode comes from pricing-policy.ts, renderers gate on `gstAmount > 0`. */
  gst: boolean;
  subtotal: number;
  gstAmount: number;
  total: number;
  /** Snapshot of the promo (if any) that was active when this invoice was created. */
  promoTitle?: string | null;
  /** Dollar discount applied to the labour subtotal at creation time. */
  promoDiscount?: number | null;
  /** The hours and rates the promo discount came from, printed under its row; null when none. */
  promoNote?: string | null;
  /** Unsuccessful work: labour discounted by the policy factor (parts and travel unaffected). */
  unsuccessful?: boolean;
  /** Computed labour-half discount, persisted for audit + PDF rendering. */
  unsuccessfulDiscount?: number | null;
  /** What couldn't be fixed and the labour it came off, printed under its row; null when none. */
  unsuccessfulNote?: string | null;
  /** Gold Card share taken off labour (0.1 = 10%), or null when the client isn't a holder. */
  goldCardPercent?: number | null;
  /** Gold Card dollars off labour, after the promo and before the unsuccessful discount. */
  goldCardDiscount?: number | null;
  status: InvoiceStatus;
  notes: string | null;
  contactId: string | null;
  /** ISO timestamp when the invoice was first sent (DRAFT>SENT). Null on legacy rows. */
  sentAt?: string | null;
  /** ISO timestamp when payment was recorded (status>PAID). Null on legacy PAID rows. */
  paidAt?: string | null;
  /** ISO timestamp when the invoice was voided; null when it never was. */
  voidedAt?: string | null;
  /** Payment method recorded at pay time (an INCOME_METHODS value). */
  paymentMethod?: string | null;
  /** Optional operator reference/note recorded with the payment. */
  paymentReference?: string | null;
  /** Money already handed over before the invoice went out; the invoice asks for total minus this. */
  alreadyPaid?: number | null;
  /** How the already-paid money came in (an INCOME_METHODS value); feeds the income entry only. */
  alreadyPaidMethod?: string | null;
  /** When the most recent overdue reminder was emailed; null = never. */
  reminderLastSentAt?: string | null;
  /** How many overdue reminders have gone out; null reads as 0 (Mongo backfill rule). */
  reminderCount?: number | null;
  /** When the apology for a wrongly-sent reminder was emailed; null = never. */
  apologySentAt?: string | null;
  /** True when this row is a quote (Q- number, no payment until converted). Null reads as false. */
  isQuote?: boolean | null;
  /** ISO date the quote's pricing is honoured until; null = no stated expiry. */
  quoteValidUntil?: string | null;
  driveFileId: string | null;
  driveWebUrl: string | null;
  createdAt: string;
  updatedAt: string;
  /** Linked contact's name, set by the list endpoint so search finds "68 Ltd" under Michael. */
  contactName?: string | null;
  /** Linked contact's company, set by the list endpoint. */
  contactCompany?: string | null;
  /** The person a company invoice is for (see invoiceRecipient); null on a person invoice. */
  attention?: string | null;
}

export interface IncomeEntry {
  id: string;
  date: string;
  customer: string;
  description: string;
  amount: number;
  method: string;
  notes: string | null;
  invoiceId: string | null;
  /** Sync ID shared with the matching sheet row (hidden column Z); null until first synced. */
  sheetRowKey?: string | null;
  createdAt: string;
  /** Null on legacy rows created before the field existed. */
  updatedAt?: string | null;
}

export interface ExpenseEntry {
  id: string;
  date: string;
  supplier: string;
  description: string;
  category: string;
  amountIncl: number;
  gstAmount: number;
  amountExcl: number;
  method: string;
  receipt: boolean;
  notes: string | null;
  /** Sync ID shared with the matching sheet row (hidden column Z); null until first synced. */
  sheetRowKey?: string | null;
  createdAt: string;
  /** Null on legacy rows created before the field existed. */
  updatedAt?: string | null;
}

export interface GoogleContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface TaskLine {
  /** For flat-rate tasks (e.g. Travel) - points to the linked flat RateConfig. Null on hourly tasks. */
  rateConfigId: string | null;
  /** For hourly tasks - points to the base RateConfig (with ratePerHour set). Null on flat tasks. */
  baseRateId?: string | null;
  /** For hourly tasks - modifier RateConfig IDs; effective $/hr = base + sum(deltas). */
  modifierIds?: string[];
  description: string;
  /** Decimal hours from {@link TaskLine.minutes}, unrounded so `qty * unitPrice` stays exact. */
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Whole billed minutes - the authoritative duration on hourly tasks; flat-rate rows leave it unset. */
  minutes?: number;
  /** Device tag picked by the operator or returned by the AI. */
  device?: string | null;
  /** Action tag picked by the operator or returned by the AI. */
  action?: string | null;
  /** Optional free-text qualifier appended to the composed description (e.g. "corrupted", "Windows OS"). */
  details?: string | null;
  /** AI-flagged "short" task; the rebalance pins it at 15 min. */
  isShort?: boolean;
  /** AI-flagged task with an operator-stated duration; the rebalance leaves its qty alone. */
  isExplicit?: boolean;
  /** Task not finished: its labour is discounted, unless flat-rate or the whole job is flagged. */
  unsuccessful?: boolean;
  /** Flat charge with no rate row (a cancellation fee): no padding, window fitting, surcharge or promo. */
  isFlatFee?: boolean;
  /** Operator typed this row's $/hr, so a restored draft keeps it; cleared on a rate change. */
  priceOverridden?: boolean;
}

export interface PartLine {
  description: string;
  cost: number;
}

/**
 * One travel charge in the calculator. All but store runs lump into one "Round-trip
 * travel" invoice line; each store run gets its own.
 */
export interface TravelEntry {
  /** Calculator-only label (e.g. "Parking"); the store on a store run. */
  label: string;
  /** Mid-job client > store > client drive: own line, no minimum, not free-travel promo. */
  kind?: "storeRun";
  /** Cost in NZD. */
  cost: number;
  /** True when this entry was created by the address lookup; lets re-lookup replace it. */
  isAuto?: boolean;
  /** From the AI parse's travelCosts; a reparse replaces it, an address re-lookup doesn't. */
  isParsedCost?: boolean;
  /** Destination text shown in the operator-side breakdown (auto entries only). */
  destination?: string;
  /** Outbound drive time in minutes from the address lookup (auto entries only). */
  durationMinsOneWay?: number;
  /** Return-leg drive time in minutes; readers fall back to durationMinsOneWay on legacy drafts. */
  durationMinsBack?: number;
  /** One-way drive distance in km from the address lookup (auto entries only). */
  distanceKmOneWay?: number;
}

export interface JobCalculation {
  /** Total billable minutes, informational; labour bills through the hourly task lines. */
  durationMins: number;
  tasks: TaskLine[];
  parts: PartLine[];
  /** Every travel charge for this job; see {@link TravelEntry} for how they reach the invoice. */
  travelEntries: TravelEntry[];
  notes: string;
  /** Unsuccessful job: calcJobTotal discounts labour only, per the published policy. */
  unsuccessful?: boolean;
  clientName: string;
  clientEmail: string;
}

export interface ParseJobQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface ParseJobResponse {
  durationMins: number | null;
  /** Stated work outside the session ranges (a call after); in durationMins, exempt from the cap. */
  outOfSessionMins?: number;
  startTime: string | null;
  endTime: string | null;
  /** Out-of-pocket travel disbursements stated with a dollar amount (parking, tolls, ferry) - passed through at cost. */
  travelCosts?: { label: string; cost: number }[];
  /** Stores the operator left the client's place to visit mid-job, as the description names them. */
  storeRuns?: string[];
  /** Each store run the route could time, client > store > client. */
  storeRunTravel?: StoreRunTravel[];
  /** True when the description says the client paid in cash. */
  paidCash?: boolean;
  /** Cash amount the description states, or null when it names cash without one. */
  cashPaid?: number | null;
  tasks: ParsedTaskLine[];
  parts: ParsedPartLine[];
  notes: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  destination: string | null;
  statedDistanceKm: number | null;
  noTravelCharge: boolean;
  travel?: TravelInfo;
  /** Operator-stated time ranges (one per HH:MM-HH:MM segment). Empty when no ranges detected. */
  ranges?: ParsedRange[];
}

/** A store run timed by the parse route: the client's place > the store > back. */
export interface StoreRunTravel {
  /** The store as the description named it. */
  store: string;
  /** Drive minutes from the client to the store. */
  durationMinsThere: number;
  /** Drive minutes from the store back to the client. */
  durationMinsBack: number;
  /** One-way km, client to store. */
  distanceKm: number;
}

/** One time range pulled out of the operator's free-text input. */
export interface ParsedRange {
  startTime: string;
  endTime: string;
}

/** One merged calendar event's contribution to a prefilled job. */
export interface EventPrefillSlot {
  /** Google Calendar event id this slot came from. */
  calendarEventId: string;
  /** Matching Booking row id, or null for a bare calendar entry. */
  bookingId: string | null;
  /** NZ-local yyyy-mm-dd. Separates a merged job's days so their windows cannot merge. */
  date: string;
  /** NZ-local HH:MM event start (actual on-site start). */
  startTime: string;
  /** NZ-local HH:MM event end (actual on-site end). */
  endTime: string;
  /** Event title, for the merged-job banner. */
  summary: string;
}

/**
 * Job prefill built server-side from one or more calendar events (times are actual on-site)
 * and their Booking rows. Its date and times win over a job draft saved against other times.
 */
export interface EventPrefill {
  /** Earliest event's id, saved on the invoice; the rest live in {@link EventPrefill.slots}. */
  calendarEventId: string;
  /** Matching Booking row id, or null for manual calendar events. */
  bookingId: string | null;
  /** NZ-local YYYY-MM-DD of the earliest event's start. */
  jobDate: string;
  /** One per event in start order; each is its own slot, so gaps between never bill. */
  slots: EventPrefillSlot[];
  clientName: string;
  clientEmail: string;
  jobAddress: string;
  /** How the booking was met (cancel mode bills no trip for remote); null with no Booking row. */
  meetingType: CancelMeetingType | null;
  /**
   * One round trip for the whole job, from the frozen TravelBlock (raw minutes) or the
   * booking snapshot; null when neither exists.
   */
  travelMinsThere: number | null;
  travelMinsBack: number | null;
  /** The schedule has the trip on foot, by bike or by bus, so it isn't logged as a drive. */
  walked: boolean;
  /**
   * When the job was booked (ISO): the booking's creation, else when its calendar event was
   * made. Promo dates are judged here, so a phone-made job keeps the rates of the day it was
   * put in. Null when neither is known.
   */
  bookedAt: string | null;
}

interface ParsedTaskLine {
  rateConfigId: string | null;
  /** Resolved base rate ID (set by the server from baseRateLabel emitted by the AI). */
  baseRateId?: string | null;
  /** Resolved modifier rate IDs (set by the server from modifierLabels emitted by the AI). */
  modifierIds?: string[];
  description: string;
  /** Decimal hours; the server rewrites it from {@link ParsedTaskLine.minutes} once the grid snap has run. */
  qty: number;
  /** Whole billed minutes on the billing-increment grid, set by the server after parsing. */
  minutes?: number;
  unitPrice: number;
  /** Free-text device tag from the AI (e.g. "Laptop", "Phone", "Email account"). */
  device?: string | null;
  /** Free-text action tag from the AI (e.g. "Setup", "Repair", "Recovery"). */
  action?: string | null;
  /** Optional free-text qualifier from the AI when device + action alone aren't specific enough. */
  details?: string | null;
  /** True when the AI placed this task in the SHORT set (one-shot, quickly, briefly, etc.). */
  isShort?: boolean;
  /** True when the AI pinned this task to a stated duration; the rebalance skips it. */
  isExplicit?: boolean;
  /** True when the AI read the problem as unresolved; the calculator discounts that line. */
  unsuccessful?: boolean;
}

interface ParsedPartLine {
  description: string;
  cost: number;
}

export interface TaskTemplate {
  id: string;
  description: string;
  defaultPrice: number;
  usageCount: number;
  device?: string | null;
  action?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  description: string;
  supplier: string;
  category: string;
  amountIncl: number;
  gstRate: number;
  method: string;
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually";
  nextDue: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TravelInfo {
  /** One-way drive distance in km from the address lookup (outbound leg). */
  distanceKmOneWay: number;
  /** Outbound drive time in minutes; summed with durationMinsBack by calcTravelCharge. */
  durationMins: number;
  /** Return-leg drive time in minutes; mirrors durationMins when the back-leg lookup degrades. */
  durationMinsBack: number;
  destination?: string;
}
