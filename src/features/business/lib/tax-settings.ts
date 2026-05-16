// src/features/business/lib/tax-settings.ts
/**
 * @file tax-settings.ts
 * @description Reads the planner configuration cells from a per-FY workbook's
 * SETTINGS tab. Some cells are at fixed positions (rates and weekly amounts);
 * the auto-transfer start date is found by scanning column A for its label so
 * the operator can drop it anywhere they like.
 *
 *   B13 - Tax Reserve Rate (income tax %)
 *   B14 - ACC Rate
 *   B15 - KiwiSaver Rate
 *   B22 - Weekly KiwiSaver transfer ($)
 *   B23 - Weekly tax account transfer ($)
 *   B(?) - Auto-transfer start date (located by label match in column A)
 */

import { getSheetsClient } from "@/features/business/lib/google-sheets";
import { DEFAULT_TAX_RATES, type TaxRates } from "@/features/business/lib/tax-planner";

/** Combined planner configuration for one workbook. */
export interface PlannerConfig {
  rates: TaxRates;
  weeklyKiwiSaver: number;
  weeklyTax: number;
  /** ISO date the bank auto-transfers began firing, or null when not set. */
  transferStartDate: Date | null;
}

/** Labels in column A that can identify the auto-transfer start-date cell. */
const START_DATE_LABELS = [
  "auto-transfer start date",
  "auto transfer start date",
  "transfers started",
  "transfers start date",
];

/**
 * Coerces a raw cell value (may be number or string) to a finite number, or
 * null if it can't be parsed.
 * @param raw - Raw cell value.
 * @returns Parsed number or null.
 */
function num(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = parseFloat(String(raw).replace(/[$,\s%]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Parses a date cell. Accepts DD/MM/YYYY (NZ default), YYYY-MM-DD, or anything
 * the JS Date constructor handles. Returns null on failure.
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
 * Reads the planner config from SETTINGS in one workbook. Returns null when
 * the sheet is unreadable so callers can fall back to defaults.
 *
 * Performs two batched reads:
 * 1. Fixed cells: B13-B15 (rates) and B22-B23 (weekly amounts)
 * 2. Whole `A:B` range to scan for the auto-transfer start date label
 * @param spreadsheetId - The Google Sheet file ID.
 * @returns Parsed config, or null on any failure.
 */
export async function readPlannerConfig(spreadsheetId: string): Promise<PlannerConfig | null> {
  const sheets = getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["SETTINGS!B13:B15", "SETTINGS!B22:B23", "SETTINGS!A:B"],
    });
  } catch {
    return null;
  }

  const ratesRange = res.data.valueRanges?.[0]?.values ?? [];
  const weeklyRange = res.data.valueRanges?.[1]?.values ?? [];
  const fullSheet = (res.data.valueRanges?.[2]?.values ?? []) as unknown[][];

  const incomeTax = num(ratesRange[0]?.[0]);
  const acc = num(ratesRange[1]?.[0]);
  const kiwiSaver = num(ratesRange[2]?.[0]);
  const weeklyKiwiSaver = num(weeklyRange[0]?.[0]);
  const weeklyTax = num(weeklyRange[1]?.[0]);

  /**
   * Treat raw rate cells > 1 as percentages (user might enter "20" instead of "0.2").
   * @param n - Raw value from a sheet cell.
   * @returns Fractional rate, or null when unset.
   */
  const toFraction = (n: number | null): number | null => (n === null ? null : n > 1 ? n / 100 : n);

  // Locate the auto-transfer start date by scanning column A for any of the labels.
  let transferStartDate: Date | null = null;
  for (const row of fullSheet) {
    const label = String(row?.[0] ?? "")
      .trim()
      .toLowerCase();
    if (!label) continue;
    if (START_DATE_LABELS.includes(label)) {
      transferStartDate = parseDateCell(row?.[1]);
      break;
    }
  }

  return {
    rates: {
      incomeTax: toFraction(incomeTax) ?? DEFAULT_TAX_RATES.incomeTax,
      acc: toFraction(acc) ?? DEFAULT_TAX_RATES.acc,
      kiwiSaver: toFraction(kiwiSaver) ?? DEFAULT_TAX_RATES.kiwiSaver,
      gstOutOfInclusive: DEFAULT_TAX_RATES.gstOutOfInclusive,
    },
    weeklyKiwiSaver: weeklyKiwiSaver ?? 0,
    weeklyTax: weeklyTax ?? 0,
    transferStartDate,
  };
}
