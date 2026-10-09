// src/features/business/lib/assets.ts
// Asset register helpers shared by the assets API routes, the Assets page and its client
// view: request-body validation (parseAssetBody), every asset's depreciation schedule
// (assetSchedules), the expense prefill and link list, and the plain shapes handed to
// the browser. Pure: no Prisma, no React, so scripts/check-assets.ts runs it under tsx.

import { formatNZD } from "@/features/business/lib/business-format";
import {
  assetClassByKey,
  assetSchedule,
  expenseTaxBasis,
  lowValueGroupTotals,
  roundCents,
  VEHICLE_CLASS_KEY,
  type AssetInput,
  type AssetOrigin,
  type AssetYearRow,
  type DepreciationMethod,
  type GstStatus,
  type LedgerExpense,
  type TaxFy,
} from "@/features/business/lib/tax";
import {
  parseAmount,
  parseObjectId,
  parseRate,
  parseString,
} from "@/features/business/lib/validation";
import { formatDateShort } from "@/shared/lib/date-format";

/** Longest name, class key or supplier accepted. */
const MAX_SHORT_TEXT = 120;
/** Longest valuation note or notes accepted. */
const MAX_LONG_TEXT = 1000;
/** First in-service day Investment Boost covers (TIB 37/7: first used on or after 22 May 2025). */
const BOOST_FIRST_DAY = new Date(Date.UTC(2025, 4, 22));
/** The only date shape the asset routes accept: YYYY-MM-DD, captured as year, month, day. */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The fields an asset write stores: the Prisma `Asset` columns minus id and timestamps. */
export interface AssetWriteData {
  name: string;
  classKey: string;
  origin: AssetOrigin;
  /** UTC midnight of the NZ day it went into business use (ledger scale). */
  inServiceDate: Date;
  /** Cost (bought) or market value (brought in), rounded to cents. */
  costBase: number;
  /** Bought items only. */
  supplier: string | null;
  /** Brought-in items only: how the market value was worked out. */
  valuationNote: string | null;
  method: DepreciationMethod;
  /** Annual rate as a fraction. */
  rate: number;
  /** 0-100. */
  businessUsePct: number;
  investmentBoost: boolean;
  vehicleMethod: "km" | null;
  expenseId: string | null;
  disposedAt: Date | null;
  disposalAmount: number | null;
  notes: string | null;
}

/** A stored asset row as Prisma returns it (only the columns these helpers read). */
export interface AssetRecord extends Omit<AssetWriteData, "origin" | "method" | "vehicleMethod"> {
  id: string;
  origin: string;
  method: string;
  vehicleMethod: string | null;
}

/** Outcome of {@link parseAssetBody}. */
export type AssetBodyResult = { ok: true; data: AssetWriteData } | { ok: false; error: string };

/** One asset as the Assets page hands it to the browser: dates as YYYY-MM-DD, schedule attached. */
export interface AssetView {
  id: string;
  name: string;
  classKey: string;
  /** IR265 class label, or "Custom rate" for a key the table doesn't list. */
  classLabel: string;
  origin: AssetOrigin;
  inServiceDate: string;
  costBase: number;
  supplier: string | null;
  valuationNote: string | null;
  method: DepreciationMethod;
  rate: number;
  businessUsePct: number;
  investmentBoost: boolean;
  vehicleMethod: "km" | null;
  expenseId: string | null;
  /** Label of the linked expense, or null when unlinked or the expense no longer exists. */
  expenseLabel: string | null;
  disposedAt: string | null;
  disposalAmount: number | null;
  notes: string | null;
  /** One row per FY from the first year in use, oldest first. */
  schedule: AssetYearRow[];
  /** The current FY's row, or null when the asset has none this year. */
  current: AssetYearRow | null;
}

/** An expense the asset form can link to. */
export interface ExpenseOption {
  id: string;
  /** e.g. "26 Aug 2026 - Kevin: Car ($4,500.00)". */
  label: string;
  /** Asset already linked to this expense, or null. */
  linkedAssetId: string | null;
}

/** Form values "Turn into an asset" fills in from an expense. */
export interface AssetPrefill {
  name: string;
  supplier: string;
  /** On the GST basis for the expense's date. */
  costBase: number;
  /** YYYY-MM-DD. */
  inServiceDate: string;
  expenseId: string;
}

/** What {@link assetSchedules} shares across every asset. */
export interface AssetSchedulesOptions {
  /** identity.startDateIso as a Date; nothing is claimed before it. */
  businessStart: Date;
  /** settings.tax.lowValueThreshold. */
  lowValueThreshold: number;
  /** Closing ATV by FY key then asset id, from filed TaxYear snapshots. */
  filed: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/**
 * Whether a body value is one the form leaves empty.
 * @param value - Raw value from a request body.
 * @returns True for undefined, null or "".
 */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Builds a refusal.
 * @param error - Message shown to the operator.
 * @returns The failed result.
 */
function fail(error: string): AssetBodyResult {
  return { ok: false, error };
}

/**
 * Parses a YYYY-MM-DD string to UTC midnight of that day, the scale ledger dates are
 * stored on. Refuses other shapes and impossible days (2026-02-30), which `Date` would
 * otherwise roll into the next month.
 * @param value - Raw value from a request body.
 * @returns The date, or null when the value isn't a real YYYY-MM-DD day.
 */
export function parseLedgerDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = DATE_ONLY_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? date : null;
}

/**
 * Reads an optional free-text field.
 * @param value - Raw value from a request body.
 * @param maxLen - Longest accepted length.
 * @returns The trimmed text, null when blank, or undefined when it isn't text or runs too long.
 */
function optionalText(value: unknown, maxLen: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (t === "") return null;
  return t.length > maxLen ? undefined : t;
}

/**
 * Whether a body value has a type a number field accepts. parseAmount and parseRate run
 * values through Number(), which reads true as 1 and false as 0, so anything other than a
 * number or a string is refused before they see it.
 * @param value - Raw value from a request body.
 * @returns True for a number or a string.
 */
function isNumberish(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

/**
 * Parses a 0-100 percentage from a number or numeric string.
 * @param value - Raw value from a request body.
 * @returns The percentage, or null when it isn't a number in range.
 */
function parsePercent(value: unknown): number | null {
  if (!isNumberish(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * The IR265 rate for a class and method.
 * @param classKey - Asset class key.
 * @param method - DV or SL.
 * @returns The rate as a fraction, or null when the class isn't in the table.
 */
export function defaultRate(classKey: string, method: DepreciationMethod): number | null {
  const cls = assetClassByKey(classKey);
  if (!cls) return null;
  return method === "SL" ? cls.sl : cls.dv;
}

/**
 * Whether a class key names the motor vehicle class, the only class that can be claimed
 * on IRD kilometre rates instead of depreciation. Compares against
 * {@link VEHICLE_CLASS_KEY}, the key the tax maths uses.
 * @param classKey - Asset class key.
 * @returns True for the motor vehicle class.
 */
export function isVehicleClass(classKey: string): boolean {
  return classKey === VEHICLE_CLASS_KEY;
}

/**
 * Validates an asset create or full-replace body. The rules:
 * - name, class, origin and in-service date are required; dates are YYYY-MM-DD.
 * - number fields (cost, rate, business use, sale amount) are numbers or numeric strings;
 *   a boolean or object is refused, not read as 1 or 0.
 * - cost or market value is more than $0 after rounding to cents.
 * - a blank rate takes the IR265 rate for the class and method; an unlisted class must
 *   bring its own rate (0-100%, more than 0).
 * - business use is 0-100 (blank = 100).
 * - km rates only on the motor vehicle class; Investment Boost only on bought items not
 *   on km rates, first used on or after 22 May 2025.
 * - an expense link is a valid ObjectId on a bought item (existence and uniqueness are
 *   database checks, done by the route).
 * - a sale price needs a disposal date; a disposal date with no price is a $0 sale; a
 *   disposal can't predate the in-service date.
 * Each origin keeps only its own detail (supplier for bought, valuation note for brought
 * in), so switching origin can't leave stale text behind.
 * @param body - Parsed JSON request body.
 * @returns The data to store, or the first problem found.
 */
export function parseAssetBody(body: unknown): AssetBodyResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("Expected a JSON object");
  }
  const b = body as Record<string, unknown>;

  const name = parseString(b.name, MAX_SHORT_TEXT);
  if (name === null) return fail("Name is required (up to 120 characters)");

  const classKey = parseString(b.classKey, MAX_SHORT_TEXT);
  if (classKey === null) return fail("Asset class is required");

  const originRaw = b.origin;
  if (originRaw !== "introduced" && originRaw !== "purchased") {
    return fail("Origin must be introduced or purchased");
  }
  const origin: AssetOrigin = originRaw;

  const methodRaw = isBlank(b.method) ? "DV" : b.method;
  if (methodRaw !== "DV" && methodRaw !== "SL") return fail("Method must be DV or SL");
  const method: DepreciationMethod = methodRaw;

  const inServiceDate = parseLedgerDay(b.inServiceDate);
  if (inServiceDate === null) return fail("In-service date must be a real date (YYYY-MM-DD)");

  const cost = isNumberish(b.costBase) ? parseAmount(b.costBase) : null;
  const costBase = cost === null ? 0 : roundCents(cost);
  if (costBase <= 0) return fail("Cost or market value must be more than $0");

  let rate: number;
  if (isBlank(b.rate)) {
    const fallback = defaultRate(classKey, method);
    if (fallback === null) return fail("Pick an asset class from the list, or enter a rate");
    rate = fallback;
  } else {
    const parsed = isNumberish(b.rate) ? parseRate(b.rate) : null;
    if (parsed === null || parsed <= 0) return fail("Rate must be more than 0% and at most 100%");
    rate = Math.round(parsed * 10000) / 10000;
  }

  const businessUsePct = isBlank(b.businessUsePct) ? 100 : parsePercent(b.businessUsePct);
  if (businessUsePct === null) return fail("Business use must be between 0% and 100%");

  const vehicleRaw = isBlank(b.vehicleMethod) ? null : b.vehicleMethod;
  if (vehicleRaw !== null && vehicleRaw !== "km") return fail("Vehicle method must be km or blank");
  const vehicleMethod: "km" | null = vehicleRaw;
  if (vehicleMethod === "km" && !isVehicleClass(classKey)) {
    return fail("Kilometre rates only apply to the motor vehicle class");
  }

  if (b.investmentBoost !== undefined && typeof b.investmentBoost !== "boolean") {
    return fail("Investment Boost must be true or false");
  }
  const investmentBoost = b.investmentBoost === true;
  if (investmentBoost && origin !== "purchased") {
    return fail("Investment Boost only applies to brand-new items you bought");
  }
  if (investmentBoost && vehicleMethod === "km") {
    return fail(
      "A vehicle on kilometre rates isn't depreciated, so Investment Boost doesn't apply",
    );
  }
  if (investmentBoost && inServiceDate < BOOST_FIRST_DAY) {
    return fail("Investment Boost only covers items first used on or after 22 May 2025");
  }

  const supplier = optionalText(b.supplier, MAX_SHORT_TEXT);
  if (supplier === undefined) return fail("Supplier must be text up to 120 characters");
  const valuationNote = optionalText(b.valuationNote, MAX_LONG_TEXT);
  if (valuationNote === undefined) return fail("Valuation note must be text up to 1000 characters");
  const notes = optionalText(b.notes, MAX_LONG_TEXT);
  if (notes === undefined) return fail("Notes must be text up to 1000 characters");

  let expenseId: string | null = null;
  if (!isBlank(b.expenseId)) {
    expenseId = parseObjectId(b.expenseId);
    if (expenseId === null) return fail("Linked expense id isn't valid");
    if (origin !== "purchased") return fail("Only a bought asset can be linked to an expense");
  }

  let disposedAt: Date | null = null;
  if (!isBlank(b.disposedAt)) {
    disposedAt = parseLedgerDay(b.disposedAt);
    if (disposedAt === null) return fail("Disposal date must be a real date (YYYY-MM-DD)");
    if (disposedAt < inServiceDate)
      return fail("Disposal date can't be before the in-service date");
  }
  let disposalAmount: number | null = null;
  if (!isBlank(b.disposalAmount)) {
    if (disposedAt === null) return fail("A sale amount needs a disposal date");
    const amount = isNumberish(b.disposalAmount) ? parseAmount(b.disposalAmount) : null;
    if (amount === null) return fail("Sale amount must be $0 or more");
    disposalAmount = roundCents(amount);
  } else if (disposedAt !== null) {
    // Thrown out or given away: a $0 sale.
    disposalAmount = 0;
  }

  return {
    ok: true,
    data: {
      name,
      classKey,
      origin,
      inServiceDate,
      costBase,
      supplier: origin === "purchased" ? supplier : null,
      valuationNote: origin === "introduced" ? valuationNote : null,
      method,
      rate,
      businessUsePct,
      investmentBoost,
      vehicleMethod,
      expenseId,
      disposedAt,
      disposalAmount,
      notes,
    },
  };
}

/**
 * One asset's filed closing values out of the all-assets snapshot map.
 * @param assetId - Asset id.
 * @param filed - Closing ATV by FY key then asset id, from filed TaxYear snapshots.
 * @returns Closing ATV by FY key for this asset (empty when no filed year lists it).
 */
export function filedAtvFor(
  assetId: string,
  filed: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [fyKey, byAsset] of filed) {
    const atv = byAsset.get(assetId);
    if (atv !== undefined) out.set(fyKey, atv);
  }
  return out;
}

/**
 * Depreciation schedule for every asset. The low-value grouping (same supplier, same day,
 * same rate tested together) is worked out across the whole register first, so a lone
 * asset's schedule depends on its neighbours; never call assetSchedule on one asset in
 * isolation. Filed closing values replace the computed opening value of the next year.
 * @param assets - Every asset on the register.
 * @param fys - Financial years, oldest first.
 * @param opts - Business start, write-off threshold and filed closing values.
 * @returns Schedule rows by asset id, in the order the assets came in.
 */
export function assetSchedules(
  assets: readonly AssetInput[],
  fys: readonly TaxFy[],
  opts: AssetSchedulesOptions,
): Map<string, AssetYearRow[]> {
  const groups = lowValueGroupTotals(assets);
  const out = new Map<string, AssetYearRow[]>();
  for (const asset of assets) {
    out.set(
      asset.id,
      assetSchedule(asset, fys, {
        businessStart: opts.businessStart,
        lowValueThreshold: opts.lowValueThreshold,
        groupTotal: groups.get(asset.id) ?? asset.costBase,
        filedClosingAtv: filedAtvFor(asset.id, opts.filed),
      }),
    );
  }
  return out;
}

/**
 * A rate fraction as a short percentage.
 * @param rate - Fraction, e.g. 0.105.
 * @returns Percentage text, e.g. "10.5%".
 */
export function formatRatePct(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`;
}

/**
 * A dollar threshold for copy: whole dollars lose the ".00".
 * @param amount - Threshold in dollars.
 * @returns e.g. "$1,000" or "$999.50".
 */
export function formatThreshold(amount: number): string {
  return formatNZD(amount).replace(/\.00$/, "");
}

/**
 * The picker label for an expense.
 * @param e - The expense.
 * @returns e.g. "26 Aug 2026 - Kevin: Car ($4,500.00)".
 */
export function expenseOptionLabel(e: LedgerExpense): string {
  return `${formatDateShort(e.date)} - ${e.supplier}: ${e.description} (${formatNZD(e.amountIncl)})`;
}

/**
 * Every expense as a link option, newest first, noting any asset already linked to it.
 * @param expenses - Every expense row.
 * @param assets - Every asset's id and expense link.
 * @returns The options.
 */
export function expenseOptions(
  expenses: readonly LedgerExpense[],
  assets: readonly { id: string; expenseId: string | null }[],
): ExpenseOption[] {
  const linkedBy = new Map<string, string>();
  for (const a of assets) {
    if (a.expenseId) linkedBy.set(a.expenseId, a.id);
  }
  return [...expenses]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      id: e.id,
      label: expenseOptionLabel(e),
      linkedAssetId: linkedBy.get(e.id) ?? null,
    }));
}

/**
 * Form values for turning an expense into an asset. The cost follows the GST basis on
 * the expense's date: GST-inclusive while unregistered, exclusive once registered.
 * @param e - The expense.
 * @param gst - GST registration status.
 * @returns The prefill.
 */
export function assetPrefillFromExpense(e: LedgerExpense, gst: GstStatus): AssetPrefill {
  return {
    name: e.description,
    supplier: e.supplier,
    costBase: roundCents(expenseTaxBasis(e, gst)),
    inServiceDate: e.date.slice(0, 10),
    expenseId: e.id,
  };
}

/**
 * A stored asset as the browser gets it. Dates are UTC midnight of the NZ day, so the
 * first ten characters of the ISO string are that day.
 * @param row - The stored asset.
 * @param schedule - Its schedule from {@link assetSchedules}.
 * @param currentFyKey - Current FY key, e.g. "2026-27".
 * @param expenseLabels - Expense option labels by expense id.
 * @returns The view.
 */
export function toAssetView(
  row: AssetRecord,
  schedule: AssetYearRow[],
  currentFyKey: string,
  expenseLabels: ReadonlyMap<string, string>,
): AssetView {
  return {
    id: row.id,
    name: row.name,
    classKey: row.classKey,
    classLabel: assetClassByKey(row.classKey)?.label ?? "Custom rate",
    origin: row.origin === "introduced" ? "introduced" : "purchased",
    inServiceDate: row.inServiceDate.toISOString().slice(0, 10),
    costBase: row.costBase,
    supplier: row.supplier,
    valuationNote: row.valuationNote,
    method: row.method === "SL" ? "SL" : "DV",
    rate: row.rate,
    businessUsePct: row.businessUsePct,
    investmentBoost: row.investmentBoost,
    vehicleMethod: row.vehicleMethod === "km" ? "km" : null,
    expenseId: row.expenseId,
    expenseLabel: row.expenseId ? (expenseLabels.get(row.expenseId) ?? null) : null,
    disposedAt: row.disposedAt ? row.disposedAt.toISOString().slice(0, 10) : null,
    disposalAmount: row.disposalAmount,
    notes: row.notes,
    schedule,
    current: schedule.find((r) => r.fyKey === currentFyKey) ?? null,
  };
}
