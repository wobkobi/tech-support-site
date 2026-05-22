export interface RateConfig {
  id: string;
  label: string;
  /** Set on base hourly rates (e.g. Standard $65/hr). Null on modifiers and flat rates. */
  ratePerHour: number | null;
  /** Set on flat rates (e.g. Travel $1.20/km). Null on hourly bases and modifiers. */
  flatRate: number | null;
  /** Set on modifier rates (signed $/hr delta, e.g. -10 for At home). Null on bases and flat rates. */
  hourlyDelta: number | null;
  unit: string;
  isDefault: boolean;
  createdAt: string;
}

export interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
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
  gst: boolean;
  subtotal: number;
  gstAmount: number;
  total: number;
  /** Snapshot of the promo (if any) that was active when this invoice was created. */
  promoTitle?: string | null;
  /** Dollar discount applied to the labor subtotal at creation time. */
  promoDiscount?: number | null;
  status: InvoiceStatus;
  notes: string | null;
  contactId: string | null;
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
  createdAt: string;
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
  createdAt: string;
}

export interface BusinessSummary {
  totalIncome: number;
  totalExpensesExcl: number;
  totalGstClaimable: number;
  taxReserve: number;
  profit: number;
  currentMonthIncome: number;
  currentMonthExpenses: number;
  incomeCount: number;
  expenseCount: number;
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
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Device tag picked by the operator or returned by the AI. */
  device?: string | null;
  /** Action tag picked by the operator or returned by the AI. */
  action?: string | null;
  /** Optional free-text qualifier appended to the composed description (e.g. "corrupted", "Windows OS"). */
  details?: string | null;
  /** AI-flagged "short" task ("quickly", "briefly", one-shot actions). Pinned at 15 min by the rebalance helper so non-short tasks absorb the correction. */
  isShort?: boolean;
}

export interface PartLine {
  description: string;
  cost: number;
}

/**
 * One work session within a multi-session job. Sessions are time-only
 * containers; tasks/parts stay job-level for v1. When sessions.length === 1
 * the calculator UI and emitted invoice line items look identical to the
 * pre-multi-session behaviour.
 */
export interface JobSession {
  /** Display label like "Session 1"; operator-editable when multi-session. */
  label: string;
  /** Optional ISO YYYY-MM-DD date. Null when the operator hasn't set one (single-day default). */
  date?: string | null;
  /** HH:MM start time. */
  startTime: string;
  /** HH:MM end time. */
  endTime: string;
  /** Manual duration override per session (e.g. when gaps exist inside a single session). */
  durationMins?: number | null;
  /** True when this session was a separate trip and should bill its own travel line. */
  includeTravel: boolean;
}

export interface JobCalculation {
  /** Aggregate first-session start (derived from sessions). */
  startTime: string;
  /** Aggregate last-session end (derived from sessions). */
  endTime: string;
  /** Aggregate total billable minutes summed across all sessions. */
  durationMins: number;
  hourlyRate: RateConfig | null;
  tasks: TaskLine[];
  parts: PartLine[];
  /** Per-trip travel cost (NOT total). Total = travelCost × count(sessions where includeTravel). */
  travelCost: number | null;
  notes: string;
  gst: boolean;
  clientName: string;
  clientEmail: string;
  /** Always at least one session. Single-session jobs keep the legacy invoice shape. */
  sessions: JobSession[];
}

export interface ParseJobRequest {
  input: string;
  answers?: Record<string, string>;
}

export interface ParseJobQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface ParseJobResponse {
  durationMins: number | null;
  startTime: string | null;
  endTime: string | null;
  hourlyRateId: string | null;
  tasks: ParsedTaskLine[];
  parts: ParsedPartLine[];
  notes: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  destination: string | null;
  statedDistanceKm: number | null;
  noTravelCharge: boolean;
  travel?: TravelInfo;
  /** Per-session ranges extracted server-side. Always has at least one entry when start/end could be resolved. */
  sessions?: ParsedSession[];
}

/**
 * One parsed time range from the AI input. Dates are populated only when the
 * server can confidently extract an ISO date from the line - we never invent
 * a year. The hydrator wraps a flat single-range result into one ParsedSession
 * if the route emits sessions: [].
 */
export interface ParsedSession {
  label?: string | null;
  date?: string | null;
  startTime: string;
  endTime: string;
  durationMins?: number | null;
}

export interface ParsedTaskLine {
  rateConfigId: string | null;
  /** Resolved base rate ID (set by the server from baseRateLabel emitted by the AI). */
  baseRateId?: string | null;
  /** Resolved modifier rate IDs (set by the server from modifierLabels emitted by the AI). */
  modifierIds?: string[];
  description: string;
  qty: number;
  unitPrice: number;
  /** Free-text device tag from the AI (e.g. "Laptop", "Phone", "Email account"). */
  device?: string | null;
  /** Free-text action tag from the AI (e.g. "Setup", "Repair", "Recovery"). */
  action?: string | null;
  /** Optional free-text qualifier from the AI when device + action alone aren't specific enough. */
  details?: string | null;
  /** True when the AI placed this task in the SHORT set (one-shot, quickly, briefly, etc.). */
  isShort?: boolean;
}

export interface ParsedPartLine {
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

export interface SheetCounterResponse {
  lastNumber: number;
  nextNumber: number;
  yearCode: string;
  nextFormatted: string;
  prefix: string;
}

export interface TravelInfo {
  distanceKm: number;
  durationMins: number;
  destination?: string;
}
