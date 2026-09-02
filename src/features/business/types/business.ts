// src/features/business/types/business.ts
/**
 * @description Shared type definitions for the business feature - rate config,
 * line items, invoices and their status, plus the ledger and job-calculation
 * shapes consumed by the calculator, invoice, and importer code.
 */

import type { CancelMeetingType } from "@/features/business/lib/pricing-policy";

export interface RateConfig {
  id: string;
  label: string;
  /** Set on base hourly rates (e.g. Standard $65/hr). Null on modifiers and flat rates. */
  ratePerHour: number | null;
  /** Set on flat per-unit rates (e.g. legacy Travel $1.20/km row before the time-based switch). Null on hourly bases and modifiers. */
  flatRate: number | null;
  /** Set on modifier rates (signed $/hr delta, e.g. -10 for At home). Null on bases and flat rates. */
  hourlyDelta: number | null;
  /** Set on percent modifiers (e.g. 0.25 for Public Holiday +25%). Multiplies the post-delta rate. */
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
   * Whole billed minutes, authoritative for hourly labour lines: `qty` is those
   * minutes in hours and cannot hold a 5-minute grid exactly (10 min = 0.1667h),
   * so renderers show this as h:mm and money is derived from it. Absent on
   * flat rows (travel, parts, surcharges) and on invoices issued before the
   * switch, which keep rendering their decimal `qty`. Null as well as undefined
   * because Prisma reads a missing optional composite field back as null;
   * readers must treat the two the same.
   */
  minutes?: number | null;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "VOIDED";

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  /** @deprecated Legacy boolean kept for storage shape. The engine derives GST mode from GST_REGISTERED in pricing-policy.ts; renderers gate on `gstAmount > 0`. */
  gst: boolean;
  subtotal: number;
  gstAmount: number;
  total: number;
  /** Snapshot of the promo (if any) that was active when this invoice was created. */
  promoTitle?: string | null;
  /** Dollar discount applied to the labour subtotal at creation time. */
  promoDiscount?: number | null;
  /** Operator ticked the unsuccessful-work checkbox: half off labour (parts + travel unaffected). */
  unsuccessful?: boolean;
  /** Computed labour-half discount, persisted for audit + PDF rendering. */
  unsuccessfulDiscount?: number | null;
  status: InvoiceStatus;
  notes: string | null;
  contactId: string | null;
  /** ISO timestamp when the invoice was first sent (DRAFT>SENT). Null on legacy rows. */
  sentAt?: string | null;
  /** ISO timestamp when payment was recorded (status>PAID). Null on legacy PAID rows. */
  paidAt?: string | null;
  /** Payment method recorded at pay time (an INCOME_METHODS value). */
  paymentMethod?: string | null;
  /** Optional operator reference/note recorded with the payment. */
  paymentReference?: string | null;
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
  /** For hourly tasks - applied modifier RateConfig IDs (each with hourlyDelta set). Effective $/hr = base + sum(deltas). */
  modifierIds?: string[];
  description: string;
  /** Decimal hours, derived from {@link TaskLine.minutes} on hourly tasks. Carried unrounded so `qty * unitPrice` stays exact. */
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
  /** AI-flagged "short" task ("quickly", "briefly", one-shot actions). Pinned at 15 min by the rebalance helper so non-short tasks absorb the correction. */
  isShort?: boolean;
  /** AI-flagged task with an operator-stated explicit duration. Pinned at the parser-emitted qty by the rebalance helper, so only floating tasks absorb any window mismatch. */
  isExplicit?: boolean;
  /** Operator-set: this task wasn't finished, so calcJobTotal halves its line per the unsuccessful-work policy. Ignored on flat-rate rows and when the whole-job `unsuccessful` flag is set (which already covers it). */
  unsuccessful?: boolean;
}

export interface PartLine {
  description: string;
  cost: number;
}

/**
 * One travel charge in the calculator. The invoice always lumps every entry
 * into a single "Travel" line; the per-entry label only appears in the
 * calculator UI to help the operator track what each amount represents.
 */
export interface TravelEntry {
  /** Operator-facing label (e.g. "Parking", "76 Riversdale Rd"). Not shown on the invoice. */
  label: string;
  /** Cost in NZD. */
  cost: number;
  /** True when this entry was created by the address lookup; lets re-lookup replace it. */
  isAuto?: boolean;
  /** True when this entry came from the AI parse's travelCosts (parking, tolls); a reparse replaces it, a manual address re-lookup leaves it alone. */
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
  /** Total billable minutes (time-slot sum + out-of-session follow-up); informational - labour bills through the hourly task lines. */
  durationMins: number;
  tasks: TaskLine[];
  parts: PartLine[];
  /** Every travel charge for this job; summed into a single "Travel" invoice line. */
  travelEntries: TravelEntry[];
  notes: string;
  /**
   * Operator-set flag: when true, calcJobTotal halves the labour portion
   * (time charge + hourly tasks) per the published unsuccessful-work
   * policy. Travel and parts are not discounted. Auditable on the saved
   * invoice via Invoice.unsuccessful + Invoice.unsuccessfulDiscount.
   */
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
  /** Minutes of explicitly-stated work done OUTSIDE the stated session ranges (e.g. a call after the visit); included in durationMins and exempt from the wall-clock cap. */
  outOfSessionMins?: number;
  startTime: string | null;
  endTime: string | null;
  /** Out-of-pocket travel disbursements stated with a dollar amount (parking, tolls, ferry) - passed through at cost. */
  travelCosts?: { label: string; cost: number }[];
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
 * Job prefill built server-side from one or more booking-calendar events
 * (whose times the operator corrects to actual on-site time) plus their
 * Booking rows. Wins over any saved draft - billing a specific event is a
 * fresh task.
 */
export interface EventPrefill {
  /**
   * Earliest merged event's id; stored on the saved invoice. Invoice.
   * calendarEventId is singular, so a merged job links back through its first
   * event only - the rest are recoverable from {@link EventPrefill.slots}.
   */
  calendarEventId: string;
  /** Matching Booking row id, or null for manual calendar events. */
  bookingId: string | null;
  /** NZ-local YYYY-MM-DD of the earliest event's start. */
  jobDate: string;
  /**
   * One entry per merged event, in start order; a single-event prefill has
   * exactly one. Each becomes its own time slot, so the gaps between merged
   * events never reach the billable total.
   */
  slots: EventPrefillSlot[];
  clientName: string;
  clientEmail: string;
  jobAddress: string;
  /**
   * How the booking was to be met. Cancel mode bills no round trip on a remote
   * session. Null when no Booking row backs the event, in which case the
   * calculator infers it from whether there is an address or a drive.
   */
  meetingType: CancelMeetingType | null;
  /**
   * Drive prediction made for the events' actual windows, from the frozen
   * TravelBlock (raw minutes, no scheduling buffer) or the booking snapshot.
   * One round trip for the whole job: out to the first event, home from the
   * last. Null when neither exists - the operator looks up manually.
   */
  travelMinsThere: number | null;
  travelMinsBack: number | null;
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
  /** True when the AI pinned this task to an operator-stated explicit duration. Pinned tasks are skipped by the post-parse safety-net rebalance. */
  isExplicit?: boolean;
  /** True when the AI read the task's problem as not resolved ("couldn't fix it"); the calculator halves that line's labour per the unsuccessful-work policy. */
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
