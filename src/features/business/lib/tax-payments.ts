// src/features/business/lib/tax-payments.ts
/**
 * @file tax-payments.ts
 * @description Reads the "Payment log" section of a per-FY workbook's TAX tab
 * (where the operator manually records tax/ACC/KiwiSaver/GST set-aside payments)
 * so the dashboard can show actual-vs-target progress next to each set-aside.
 *
 * The Payment log header is detected dynamically: we look for a row whose
 * column A is "Date" and column B starts with "Type" - this avoids hardcoding
 * a row number that would break if the user reorders the static planner section.
 */

import { getSheetsClient } from "@/features/business/lib/google-sheets";

/** Categories the dashboard renders progress against, derived from the Type column. */
export type TaxPaymentCategory = "incomeTax" | "acc" | "kiwiSaver" | "gst" | "other";

/** A single recorded tax/set-aside payment. */
export interface TaxPayment {
  date: Date;
  category: TaxPaymentCategory;
  /** Original Type cell value (preserved for display/debug). */
  rawType: string;
  amount: number;
  reference: string | null;
  notes: string | null;
}

/** Sums of payments by category. Anything we couldn't classify lands in `other`. */
export interface TaxPaymentTotals {
  incomeTax: number;
  acc: number;
  kiwiSaver: number;
  gst: number;
  other: number;
  /** Sum of all payments, ignoring category. */
  total: number;
}

/**
 * Maps a raw Type cell value to one of the dashboard's known categories.
 * Tolerates spacing/case variations and common synonyms.
 * @param raw - Raw value from the Type column.
 * @returns The matched category (or "other" if unrecognised).
 */
function classifyType(raw: string): TaxPaymentCategory {
  const t = raw.trim().toLowerCase();
  if (t.includes("kiwisaver") || t.includes("kiwi saver")) return "kiwiSaver";
  if (t.includes("acc")) return "acc";
  if (t.includes("gst")) return "gst";
  if (t.includes("income") || t === "tax" || t.includes("ird") || t.includes("provisional")) {
    return "incomeTax";
  }
  return "other";
}

/**
 * Parses a date cell value. Accepts JS-native numbers (rare), DD/MM/YYYY, or
 * YYYY-MM-DD. Returns null if the value is missing or doesn't parse.
 * @param raw - Raw cell value (string or number).
 * @returns Parsed Date or null.
 */
function parseDateCell(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Strips currency symbols and commas, returning a finite positive number or null.
 * @param raw - Raw cell value.
 * @returns Parsed amount or null.
 */
function parseAmountCell(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the Payment log from a workbook's TAX tab. Tolerates a missing TAX
 * tab (returns []), missing Payment log header (returns []), and rows with
 * malformed dates or amounts (skipped silently). Never throws.
 * @param spreadsheetId - The Google Sheet file ID for one FY workbook.
 * @returns Parsed payment rows.
 */
export async function readTaxPayments(spreadsheetId: string): Promise<TaxPayment[]> {
  const sheets = getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "TAX!A:E",
    });
  } catch {
    // TAX tab missing or otherwise unreadable - silently return empty.
    return [];
  }

  const rows = (res.data.values ?? []) as unknown[][];

  // Locate the Payment log header: row where col A == "Date" and col B starts with "Type".
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i]?.[0] ?? "")
      .trim()
      .toLowerCase();
    const b = String(rows[i]?.[1] ?? "")
      .trim()
      .toLowerCase();
    if (a === "date" && b.startsWith("type")) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) return [];

  const payments: TaxPayment[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const date = parseDateCell(row[0]);
    if (!date) continue;
    const rawType = String(row[1] ?? "").trim();
    if (!rawType) continue;
    const amount = parseAmountCell(row[2]);
    if (amount === null || amount <= 0) continue;
    const reference = String(row[3] ?? "").trim() || null;
    const notes = String(row[4] ?? "").trim() || null;
    payments.push({ date, category: classifyType(rawType), rawType, amount, reference, notes });
  }
  return payments;
}

/**
 * Counts how many fires of a weekly schedule occurred inside a half-open
 * date range. Both ends are clamped against the schedule's own start/end so
 * a transfer that began in November doesn't get retroactively credited to
 * earlier months.
 * @param scheduleStart - When the recurring transfer began firing.
 * @param scheduleEnd - When the recurring transfer stopped, or null if still active.
 * @param rangeStart - Inclusive lower bound to count fires within.
 * @param rangeEnd - Exclusive upper bound to count fires within.
 * @returns Number of weekly fires inside the effective overlap.
 */
function weeklyFiresInRange(
  scheduleStart: Date,
  scheduleEnd: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const start = scheduleStart > rangeStart ? scheduleStart : rangeStart;
  const end = scheduleEnd && scheduleEnd < rangeEnd ? scheduleEnd : rangeEnd;
  if (end <= start) return 0;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const firstK = Math.ceil((start.getTime() - scheduleStart.getTime()) / weekMs);
  const lastK = Math.floor((end.getTime() - 1 - scheduleStart.getTime()) / weekMs);
  return Math.max(0, lastK - firstK + 1);
}

/**
 * Weekly bank auto-transfer amounts read from each FY workbook's SETTINGS tab.
 */
export interface WeeklyTransferAmounts {
  /** Weekly KiwiSaver transfer in NZD (SETTINGS!B22). */
  kiwiSaver: number;
  /** Weekly tax-account transfer in NZD (SETTINGS!B23) - mapped to the incomeTax bucket. */
  incomeTax: number;
}

/**
 * Targets the weekly tax-account transfer is reserved against. The transfer
 * goes into one bank account that eventually pays IRD, ACC, and (once
 * registered) GST - so the dashboard splits each fire across these targets
 * proportionally rather than crediting the whole amount to income tax.
 */
export interface TaxBucketTargets {
  incomeTax: number;
  acc: number;
  gst: number;
}

/**
 * Computes how much each recurring auto-transfer has paid into the dashboard's
 * scope window, capped at "now" so future weeks aren't double-credited. Both
 * the weekly amounts and the schedule start date come from the per-FY
 * workbook's SETTINGS tab; pass null for `scheduleStart` to skip the recurring
 * derivation entirely (returns all zeroes).
 *
 * The KiwiSaver weekly transfer credits the kiwiSaver line directly. The tax
 * weekly transfer (one bank account holding income tax + ACC + GST reserves)
 * is split across those three lines proportionally to their targets. When all
 * targets are zero (e.g. profit is zero or negative), the tax weekly is
 * attributed entirely to income tax as a sensible fallback.
 * @param amounts - Weekly transfer amounts from SETTINGS.
 * @param scheduleStart - When the bank auto-transfers began firing, or null to skip.
 * @param rangeStart - Inclusive lower bound of the scope.
 * @param rangeEnd - Exclusive upper bound of the scope.
 * @param now - "Today" used to clamp future fires.
 * @param taxBucketTargets - Per-category targets used to split the tax weekly transfer.
 * @returns Per-category totals derived from the recurring schedule.
 */
export function computeRecurringTotals(
  amounts: WeeklyTransferAmounts,
  scheduleStart: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
  taxBucketTargets: TaxBucketTargets,
): TaxPaymentTotals {
  const totals: TaxPaymentTotals = {
    incomeTax: 0,
    acc: 0,
    kiwiSaver: 0,
    gst: 0,
    other: 0,
    total: 0,
  };
  if (!scheduleStart) return totals;
  const cappedEnd = rangeEnd < now ? rangeEnd : now;
  const fires = weeklyFiresInRange(scheduleStart, null, rangeStart, cappedEnd);
  if (fires > 0) {
    if (amounts.kiwiSaver > 0) totals.kiwiSaver += fires * amounts.kiwiSaver;
    if (amounts.incomeTax > 0) {
      const taxBucketTotal =
        taxBucketTargets.incomeTax + taxBucketTargets.acc + taxBucketTargets.gst;
      const cumulative = fires * amounts.incomeTax;
      if (taxBucketTotal > 0) {
        totals.incomeTax += cumulative * (taxBucketTargets.incomeTax / taxBucketTotal);
        totals.acc += cumulative * (taxBucketTargets.acc / taxBucketTotal);
        totals.gst += cumulative * (taxBucketTargets.gst / taxBucketTotal);
      } else {
        totals.incomeTax += cumulative;
      }
    }
  }
  return roundCents(totals);
}

/**
 * Sums the per-category fields and rounds everything to cents. Re-used by
 * recurring totals and Payment log totals.
 * @param totals - Totals object to round in place.
 * @returns The same totals object with rounded values and a recomputed `total`.
 */
function roundCents(totals: TaxPaymentTotals): TaxPaymentTotals {
  totals.total = totals.incomeTax + totals.acc + totals.kiwiSaver + totals.gst + totals.other;
  for (const k of Object.keys(totals) as Array<keyof TaxPaymentTotals>) {
    totals[k] = Math.round(totals[k] * 100) / 100;
  }
  return totals;
}

/**
 * Adds two totals objects together (e.g. logged Payment log totals plus the
 * derived recurring totals).
 * @param a - First totals.
 * @param b - Second totals.
 * @returns Combined totals, rounded to cents.
 */
export function combineTotals(a: TaxPaymentTotals, b: TaxPaymentTotals): TaxPaymentTotals {
  return roundCents({
    incomeTax: a.incomeTax + b.incomeTax,
    acc: a.acc + b.acc,
    kiwiSaver: a.kiwiSaver + b.kiwiSaver,
    gst: a.gst + b.gst,
    other: a.other + b.other,
    total: 0, // will be recomputed by roundCents
  });
}

/**
 * Reduces a list of payments into per-category totals.
 * @param payments - Payments to aggregate.
 * @returns Per-category sums plus an overall total.
 */
export function sumPaymentsByType(payments: ReadonlyArray<TaxPayment>): TaxPaymentTotals {
  const totals: TaxPaymentTotals = {
    incomeTax: 0,
    acc: 0,
    kiwiSaver: 0,
    gst: 0,
    other: 0,
    total: 0,
  };
  for (const p of payments) {
    totals[p.category] += p.amount;
  }
  return roundCents(totals);
}
