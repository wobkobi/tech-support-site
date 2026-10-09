// src/features/business/lib/tax/snapshot.ts
// Filed-year snapshots. Marking a year filed stores a TaxYearSnapshot on TaxYear.snapshot:
// the computed figures plus the register and trip details behind them, so the Tax page and
// the CSV keep showing what was filed. Also compares a snapshot with a fresh calculation,
// reads back the closing asset values the next year starts from, and finds which filed
// years an asset or trip edit reaches. Pure: no Prisma, no React.

import { assetClassByKey } from "@/features/business/lib/tax/asset-classes";
import type { AssetInput, TaxYearResult } from "@/features/business/lib/tax/types";

/** Stored shape version; bump it when TaxYearSnapshot changes shape. */
export const SNAPSHOT_VERSION = 1;

/** Smallest difference worth reporting: half a cent. Anything smaller is float noise. */
const CHANGE_TOLERANCE = 0.005;

/** Register details of one asset, frozen with the year so a filed export never changes. */
export interface SnapshotAsset {
  id: string;
  name: string;
  classKey: string;
  /** IR265 class label at filing time; the key itself when the class is unknown. */
  classLabel: string;
  origin: AssetInput["origin"];
  /** ISO ledger date (UTC midnight of the NZ day). */
  inServiceDate: string;
  costBase: number;
  method: AssetInput["method"];
  rate: number;
  businessUsePct: number;
  investmentBoost: boolean;
  vehicleMethod: AssetInput["vehicleMethod"];
  disposedAt: string | null;
  disposalAmount: number | null;
}

/** One logged trip inside the year. */
export interface SnapshotTrip {
  /** ISO ledger date (UTC midnight of the NZ day). */
  date: string;
  km: number;
  purpose: string;
}

/** Everything one year's Tax page and CSV show, saved (filed) or freshly computed (live). */
export interface TaxYearSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** ISO instant the year was marked filed; null for a live view. */
  filedAt: string | null;
  result: TaxYearResult;
  /** Assets with a schedule row in this year, oldest in service first. */
  assets: SnapshotAsset[];
  /** Trips dated inside this year, oldest first. */
  trips: SnapshotTrip[];
  /**
   * Every km the km-rate car travelled in the year (TaxYear.totalVehicleKm), which sets the
   * Tier 1 split; null when it wasn't entered.
   */
  totalVehicleKm: number | null;
  /** Closing adjusted tax value per asset id: the opening value the next year carries forward. */
  closingAtv: Record<string, number>;
}

/** One figure that differs between a filed snapshot and a fresh calculation. */
export interface SnapshotChange {
  /** Stable React key: the figure path, `totalVehicleKm`, or `asset:<id>`. */
  key: string;
  label: string;
  unit: "money" | "km";
  filed: number;
  live: number;
}

/** A filed financial year, in the shape the asset and trip forms check edits against. */
export interface FiledYearRef {
  fyKey: string;
  /** Display label, e.g. "FY 2025-26 (partial)". */
  label: string;
  /** Inclusive start, ISO (UTC midnight 1 April). */
  startIso: string;
  /** Exclusive end, ISO (UTC midnight 1 April the following year). */
  endIso: string;
  filedAtIso: string;
}

/** Ledger dates an edited record covers; `to` null means it is still running (an asset not yet disposed of). */
export interface DateSpan {
  /** ISO instant or "YYYY-MM-DD"; an empty string means "not set" and touches nothing. */
  from: string;
  to: string | null;
}

/** Figures compared between a snapshot and a recompute, in the order the Notice lists them. */
const COMPARED_FIGURES: ReadonlyArray<{
  path: string;
  label: string;
  unit: SnapshotChange["unit"];
}> = [
  { path: "income", label: "Income", unit: "money" },
  { path: "recoveryIncome", label: "Depreciation recovery income", unit: "money" },
  { path: "deductions.expenses", label: "Expense deductions", unit: "money" },
  { path: "deductions.depreciation", label: "Depreciation", unit: "money" },
  { path: "deductions.lowValueWriteOffs", label: "Low-value write-offs", unit: "money" },
  { path: "deductions.investmentBoost", label: "Investment Boost", unit: "money" },
  { path: "deductions.km", label: "Vehicle km claim", unit: "money" },
  { path: "deductions.homeOffice", label: "Home office", unit: "money" },
  { path: "deductions.lossOnDisposal", label: "Loss on disposal", unit: "money" },
  { path: "deductions.total", label: "Total deductions", unit: "money" },
  { path: "profit", label: "Net profit", unit: "money" },
  { path: "incomeTax", label: "Income tax", unit: "money" },
  { path: "ietc", label: "Independent earner tax credit", unit: "money" },
  { path: "residualIncomeTax", label: "Residual income tax", unit: "money" },
  { path: "acc", label: "ACC levy", unit: "money" },
  { path: "totalToSetAside", label: "Total to set aside", unit: "money" },
  { path: "ir.ir3NetIncome", label: "Net income (IR3 question 24)", unit: "money" },
  { path: "ir.ir10Box52Depreciation", label: "Depreciation (IR10 box 52)", unit: "money" },
  { path: "ir.ir10Box54Additions", label: "Assets added (IR10 box 54)", unit: "money" },
  { path: "ir.ir10Box55Disposals", label: "Disposals (IR10 box 55)", unit: "money" },
  { path: "ir.ir10Box59LossOnDisposal", label: "Loss on disposal (IR10 box 59)", unit: "money" },
  {
    path: "ir.ir10Box60BoostValue",
    label: "Investment Boost asset value (IR10 box 60)",
    unit: "money",
  },
  { path: "km.businessKm", label: "Business km", unit: "km" },
  { path: "deductions.unclaimedKm", label: "Km not claimed (no km-rate vehicle)", unit: "km" },
];

/**
 * Narrows an unknown value to a plain object.
 * @param value - Anything.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a number from a result by dotted path ("deductions.total"). A missing or
 * non-numeric value reads as 0, so a snapshot saved before a field existed still compares.
 * @param result - Computed year.
 * @param path - Dotted property path.
 * @returns The number at that path, or 0.
 */
export function readFigure(result: TaxYearResult, path: string): number {
  let node: unknown = result;
  for (const part of path.split(".")) {
    node = isRecord(node) ? node[part] : undefined;
  }
  return typeof node === "number" && Number.isFinite(node) ? node : 0;
}

/**
 * Freezes one register entry, resolving the class label now so a later edit to the
 * class table doesn't change a filed export.
 * @param asset - Register entry.
 * @returns The frozen copy.
 */
function toSnapshotAsset(asset: AssetInput): SnapshotAsset {
  return {
    id: asset.id,
    name: asset.name,
    classKey: asset.classKey,
    classLabel: assetClassByKey(asset.classKey)?.label ?? asset.classKey,
    origin: asset.origin,
    inServiceDate: asset.inServiceDate,
    costBase: asset.costBase,
    method: asset.method,
    rate: asset.rate,
    businessUsePct: asset.businessUsePct,
    investmentBoost: asset.investmentBoost,
    vehicleMethod: asset.vehicleMethod,
    disposedAt: asset.disposedAt,
    disposalAmount: asset.disposalAmount,
  };
}

/**
 * Assembles a snapshot from a computed year. Only assets with a schedule row in that
 * year are kept, so the register section lists exactly the assets the figures cover.
 * @param args - Snapshot parts.
 * @param args.result - Computed figures for the year.
 * @param args.assets - Every asset on the register.
 * @param args.trips - Trips dated inside the year.
 * @param args.totalVehicleKm - The year's TaxYear.totalVehicleKm, or null when not entered.
 * @param args.filedAt - ISO filing instant, or null for a live view.
 * @returns The snapshot.
 */
export function buildTaxYearSnapshot(args: {
  result: TaxYearResult;
  assets: readonly AssetInput[];
  trips: readonly SnapshotTrip[];
  totalVehicleKm: number | null;
  filedAt: string | null;
}): TaxYearSnapshot {
  const { result, assets, trips, totalVehicleKm, filedAt } = args;
  const inYear = new Set(result.assets.map((row) => row.assetId));
  const closingAtv: Record<string, number> = {};
  for (const row of result.assets) closingAtv[row.assetId] = row.closingAtv;
  return {
    version: SNAPSHOT_VERSION,
    filedAt,
    result,
    assets: assets
      .filter((asset) => inYear.has(asset.id))
      .sort((a, b) => a.inServiceDate.localeCompare(b.inServiceDate) || a.id.localeCompare(b.id))
      .map(toSnapshotAsset),
    trips: [...trips].sort(
      (a, b) => a.date.localeCompare(b.date) || a.purpose.localeCompare(b.purpose),
    ),
    totalVehicleKm,
    closingAtv,
  };
}

/** Number fields at the top of a stored result. */
const RESULT_NUMBERS: ReadonlyArray<keyof TaxYearResult> = [
  "income",
  "recoveryIncome",
  "profit",
  "taxable",
  "incomeTax",
  "ietc",
  "residualIncomeTax",
  "acc",
  "kiwiSaver",
  "totalToSetAside",
];

/** Number fields of a stored result's deductions. */
const DEDUCTION_NUMBERS: ReadonlyArray<keyof TaxYearResult["deductions"]> = [
  "expenses",
  "excludedFuel",
  "excludedAssetLinked",
  "unclaimedKm",
  "depreciation",
  "lowValueWriteOffs",
  "investmentBoost",
  "km",
  "homeOffice",
  "lossOnDisposal",
  "total",
];

/** Number fields of one stored asset schedule row. */
const ASSET_ROW_NUMBERS: ReadonlyArray<keyof TaxYearResult["assets"][number]> = [
  "months",
  "openingAtv",
  "depreciation",
  "investmentBoost",
  "deductible",
  "closingAtv",
  "recoveryIncome",
  "lossOnDisposal",
];

/** Number fields of a stored km claim. */
const KM_NUMBERS: ReadonlyArray<keyof TaxYearResult["km"]> = [
  "businessKm",
  "tier1Km",
  "tier2Km",
  "amount",
];

/** Number fields of a stored home office claim. */
const HOME_OFFICE_NUMBERS: ReadonlyArray<keyof TaxYearResult["homeOffice"]> = [
  "officePct",
  "sqmPart",
  "proportionalPart",
  "amount",
];

/** Number fields of the stored IR3 and IR10 figures. */
const IR_NUMBERS: ReadonlyArray<keyof TaxYearResult["ir"]> = [
  "ir3NetIncome",
  "ir10Box52Depreciation",
  "ir10Box54Additions",
  "ir10Box55Disposals",
  "ir10Box59LossOnDisposal",
  "ir10Box60BoostValue",
];

/**
 * Narrows to a finite number (not NaN or Infinity).
 * @param value - Anything.
 * @returns True for a finite number.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Narrows to a date string that parses to a real date, so formatting it can't throw.
 * @param value - Anything.
 * @returns True for a parseable date string.
 */
function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/**
 * Whether every named field of a record is a finite number.
 * @param record - The object to check.
 * @param keys - Field names that must hold numbers.
 * @returns True when all of them do.
 */
function allFinite(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => isFiniteNumber(record[key]));
}

/**
 * Whether a value is an object whose named fields are all finite numbers.
 * @param value - Anything.
 * @param keys - Field names that must hold numbers.
 * @returns True for such an object.
 */
function isNumberRecord(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && allFinite(value, keys);
}

/**
 * Checks one stored deductions breakdown line.
 * @param value - Anything.
 * @returns True when it has a string key and label, a finite amount and an optional string note.
 */
function isDeductionLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    isFiniteNumber(value.amount) &&
    (value.note === undefined || typeof value.note === "string")
  );
}

/**
 * Checks one stored asset schedule row.
 * @param value - Anything.
 * @returns True when every field has its schedule-row type.
 */
function isAssetYearRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.assetId === "string" &&
    typeof value.fyKey === "string" &&
    typeof value.writtenOff === "boolean" &&
    typeof value.disposed === "boolean" &&
    allFinite(value, ASSET_ROW_NUMBERS)
  );
}

/**
 * Checks a stored result deeply enough that the Tax page and the CSV can read every
 * figure, line and schedule row without hitting a missing object or a non-number.
 * @param value - Anything.
 * @returns True for a usable result.
 */
function isStoredResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.fyKey !== "string") return false;
  if (typeof value.provisionalWarning !== "boolean" || !allFinite(value, RESULT_NUMBERS)) {
    return false;
  }
  const { deductions, assets, km, homeOffice, ir } = value;
  return (
    isRecord(deductions) &&
    allFinite(deductions, DEDUCTION_NUMBERS) &&
    Array.isArray(deductions.lines) &&
    deductions.lines.every(isDeductionLine) &&
    Array.isArray(assets) &&
    assets.every(isAssetYearRow) &&
    isNumberRecord(km, KM_NUMBERS) &&
    isNumberRecord(homeOffice, HOME_OFFICE_NUMBERS) &&
    isNumberRecord(ir, IR_NUMBERS)
  );
}

/**
 * Checks one stored register entry.
 * @param value - Anything.
 * @returns True when every field has its {@link SnapshotAsset} type and the dates parse.
 */
function isStoredAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.classKey === "string" &&
    typeof value.classLabel === "string" &&
    (value.origin === "introduced" || value.origin === "purchased") &&
    isDateString(value.inServiceDate) &&
    allFinite(value, ["costBase", "rate", "businessUsePct"]) &&
    (value.method === "DV" || value.method === "SL") &&
    typeof value.investmentBoost === "boolean" &&
    (value.vehicleMethod === "km" || value.vehicleMethod === null) &&
    (value.disposedAt === null || isDateString(value.disposedAt)) &&
    (value.disposalAmount === null || isFiniteNumber(value.disposalAmount))
  );
}

/**
 * Checks one stored trip.
 * @param value - Anything.
 * @returns True for a parseable date, a finite km and a string purpose.
 */
function isStoredTrip(value: unknown): boolean {
  return (
    isRecord(value) &&
    isDateString(value.date) &&
    isFiniteNumber(value.km) &&
    typeof value.purpose === "string"
  );
}

/**
 * Reads a stored snapshot back. Returns null for anything that isn't a current-version
 * snapshot, so a corrupt or foreign value never reaches the maths as a filed year. The
 * check goes down to every field the Tax page and the CSV read (numbers finite, dates
 * parseable, nested objects present), so anything that parses is safe to render and
 * export; it never throws. A missing total km reads as null (not entered).
 * @param json - The TaxYear.snapshot value.
 * @returns The snapshot, or null.
 */
export function parseTaxYearSnapshot(json: unknown): TaxYearSnapshot | null {
  if (!isRecord(json) || json.version !== SNAPSHOT_VERSION) return null;
  const { result, assets, trips, closingAtv, filedAt, totalVehicleKm } = json;
  if (!isStoredResult(result)) return null;
  if (!Array.isArray(assets) || !assets.every(isStoredAsset)) return null;
  if (!Array.isArray(trips) || !trips.every(isStoredTrip)) return null;
  if (!isRecord(closingAtv) || !Object.values(closingAtv).every(isFiniteNumber)) return null;
  if (filedAt !== null && !isDateString(filedAt)) return null;
  if (totalVehicleKm === undefined) {
    return { ...(json as unknown as TaxYearSnapshot), totalVehicleKm: null };
  }
  if (totalVehicleKm !== null && !isFiniteNumber(totalVehicleKm)) return null;
  return json as unknown as TaxYearSnapshot;
}

/**
 * Closing adjusted tax value per asset id from a snapshot.
 * @param snapshot - A filed snapshot.
 * @returns Asset id > closing value.
 */
export function closingAtvFromSnapshot(snapshot: TaxYearSnapshot): Map<string, number> {
  const map = new Map<string, number>();
  for (const [id, value] of Object.entries(snapshot.closingAtv)) {
    if (typeof value === "number" && Number.isFinite(value)) map.set(id, value);
  }
  return map;
}

/**
 * The `filedClosingAtv` input for the tax maths: closing values by FY key, then asset id,
 * from every filed TaxYear row. Unfiled rows and unreadable snapshots are skipped.
 * @param rows - TaxYear rows with fyKey, filedAt and snapshot.
 * @returns FY key > (asset id > closing value).
 */
export function filedClosingAtvByFy(
  rows: ReadonlyArray<{ fyKey: string; filedAt: Date | null; snapshot: unknown }>,
): Map<string, Map<string, number>> {
  const byFy = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.filedAt) continue;
    const snapshot = parseTaxYearSnapshot(row.snapshot);
    if (snapshot) byFy.set(row.fyKey, closingAtvFromSnapshot(snapshot));
  }
  return byFy;
}

/**
 * Compares the car's total km for the year. It isn't part of the result, but it sets the
 * Tier 1 split, so entering, changing or clearing it after filing is listed. Null (not
 * entered) shows as 0 with a label that says which side was missing.
 * @param filed - Total km in the saved snapshot.
 * @param live - Total km now.
 * @returns The change, or null when both match (or both are unset).
 */
function totalKmChange(filed: number | null, live: number | null): SnapshotChange | null {
  const key = "totalVehicleKm";
  if (filed !== null && live !== null) {
    if (Math.abs(filed - live) < CHANGE_TOLERANCE) return null;
    return { key, label: "Total km the car travelled (odometer)", unit: "km", filed, live };
  }
  if (filed !== null) {
    return { key, label: "Total km the car travelled (now cleared)", unit: "km", filed, live: 0 };
  }
  if (live !== null) {
    const label = "Total km the car travelled (not entered when filed)";
    return { key, label, unit: "km", filed: 0, live };
  }
  return null;
}

/**
 * Lists every figure where a fresh calculation differs from the filed snapshot: what an
 * amended return would change. The car's total km and the asset closing values are
 * compared too: the km sets the Tier 1 split, and the closing values carry into the next
 * year's opening values.
 * @param filed - The saved snapshot.
 * @param live - The same year computed now.
 * @returns Changes in display order; empty when nothing moved by half a cent or more.
 */
export function diffSnapshots(filed: TaxYearSnapshot, live: TaxYearSnapshot): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  for (const figure of COMPARED_FIGURES) {
    const filedValue = readFigure(filed.result, figure.path);
    const liveValue = readFigure(live.result, figure.path);
    if (Math.abs(filedValue - liveValue) >= CHANGE_TOLERANCE) {
      changes.push({
        key: figure.path,
        label: figure.label,
        unit: figure.unit,
        filed: filedValue,
        live: liveValue,
      });
    }
  }
  const kmChange = totalKmChange(filed.totalVehicleKm, live.totalVehicleKm);
  if (kmChange) changes.push(kmChange);

  // Live names first, so a renamed asset shows its current name.
  const names = new Map<string, string>();
  for (const asset of [...live.assets, ...filed.assets]) {
    if (!names.has(asset.id)) names.set(asset.id, asset.name);
  }
  const ids = [
    ...Object.keys(filed.closingAtv),
    ...Object.keys(live.closingAtv).filter((id) => !(id in filed.closingAtv)),
  ];
  for (const id of ids) {
    const filedAtv = filed.closingAtv[id];
    const liveAtv = live.closingAtv[id];
    const name = names.get(id) ?? id;
    if (filedAtv !== undefined && liveAtv !== undefined) {
      if (Math.abs(filedAtv - liveAtv) >= CHANGE_TOLERANCE) {
        const label = `${name} closing value`;
        changes.push({ key: `asset:${id}`, label, unit: "money", filed: filedAtv, live: liveAtv });
      }
    } else if (filedAtv !== undefined) {
      const label = `${name} closing value (no longer in this year)`;
      changes.push({ key: `asset:${id}`, label, unit: "money", filed: filedAtv, live: 0 });
    } else if (liveAtv !== undefined) {
      const label = `${name} closing value (not in the filed year)`;
      changes.push({ key: `asset:${id}`, label, unit: "money", filed: 0, live: liveAtv });
    }
  }
  return changes;
}

/**
 * Normalises a form or stored date to an ISO instant on the ledger scale. A bare
 * "YYYY-MM-DD" from a date input is UTC midnight of that NZ day, the same scale the
 * FY bounds use, so plain string comparison works.
 * @param value - "YYYY-MM-DD", a full ISO string, or "".
 * @returns ISO string, or null when empty or unparseable.
 */
function toLedgerIso(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Whether a span reaches a filed year. The FY window is half-open [start, end), so the
 * span reaches it when it starts before the FY ends and hasn't ended before the FY starts.
 * @param span - Dates the record covers.
 * @param fy - A filed year.
 * @returns True when the record's figures fall in that year.
 */
function spanTouches(span: DateSpan, fy: FiledYearRef): boolean {
  const from = toLedgerIso(span.from);
  if (from === null) return false;
  const to = span.to === null ? null : toLedgerIso(span.to);
  return from < fy.endIso && (to === null || to >= fy.startIso);
}

/**
 * Filed years an asset or trip edit reaches. Pass both the record's saved dates and the
 * edited ones, so moving a record out of a filed year still warns.
 * @param spans - Date spans of the record (saved and edited).
 * @param filed - Filed years, oldest first.
 * @returns The filed years reached, in the order given.
 */
export function filedYearsTouched(
  spans: readonly DateSpan[],
  filed: readonly FiledYearRef[],
): FiledYearRef[] {
  return filed.filter((fy) => spans.some((span) => spanTouches(span, fy)));
}
