// src/features/business/lib/tax/export-csv.ts
// The accountant's CSV for one financial year: a summary with the IR3 and IR10 figures,
// the deductions, the asset register with that year's depreciation schedule, the trip log
// and the home office claim. Pure, so the export route and the check-tax fixtures share it.
// Dates are NZ day-first (DD/MM/YYYY); amounts are bare numbers so a spreadsheet can sum them.

import { roundCents, roundKm } from "@/features/business/lib/tax/helpers";
import {
  readFigure,
  type SnapshotAsset,
  type TaxYearSnapshot,
} from "@/features/business/lib/tax/snapshot";
import type { AssetYearRow } from "@/features/business/lib/tax/types";
import { formatDateSlash } from "@/shared/lib/date-format";
import { nzDateParts } from "@/shared/lib/timezone-utils";

/** Line ending spreadsheet apps expect in a CSV. */
const EOL = "\r\n";

/** UTF-8 byte-order mark, so Excel reads the file as UTF-8 rather than the system code page. */
const BOM = "\uFEFF";

/** Summary rows: figure path in the result, label, and the return box it goes in. */
const SUMMARY_ROWS: ReadonlyArray<{ path: string; label: string; box: string }> = [
  { path: "income", label: "Income", box: "" },
  { path: "recoveryIncome", label: "Depreciation recovery income", box: "" },
  { path: "deductions.total", label: "Total deductions", box: "" },
  { path: "profit", label: "Net profit", box: "" },
  { path: "ir.ir3NetIncome", label: "Net income", box: "IR3 question 24" },
  {
    path: "ir.ir10Box52Depreciation",
    label: "Depreciation incl. Investment Boost",
    box: "IR10 box 52",
  },
  { path: "ir.ir10Box54Additions", label: "Additions to fixed assets", box: "IR10 box 54" },
  { path: "ir.ir10Box55Disposals", label: "Disposals of fixed assets", box: "IR10 box 55" },
  { path: "ir.ir10Box59LossOnDisposal", label: "Loss on disposal", box: "IR10 box 59" },
  { path: "ir.ir10Box60BoostValue", label: "Investment Boost asset value", box: "IR10 box 60" },
  { path: "incomeTax", label: "Income tax on the brackets", box: "" },
  { path: "ietc", label: "Independent earner tax credit", box: "" },
  { path: "residualIncomeTax", label: "Residual income tax", box: "" },
  { path: "acc", label: "ACC levy", box: "" },
  { path: "totalToSetAside", label: "Total to set aside", box: "" },
  { path: "kiwiSaver", label: "KiwiSaver (not tax)", box: "" },
];

/** Column headings for the asset register section, in cell order. */
const ASSET_HEADERS = [
  "Asset",
  "Class",
  "Origin",
  "In service",
  "Cost or market value",
  "Method",
  "Rate (%)",
  "Business use (%)",
  "Months",
  "Opening value",
  "Depreciation (100%)",
  "Investment Boost (100%)",
  "Written off",
  "Deductible",
  "Closing value",
  "Disposed",
  "Sale amount",
  "Recovery income",
  "Loss on disposal",
  "Km-rate vehicle",
] as const;

/**
 * Quotes a text cell. A leading =, +, -, @, tab or CR makes a spreadsheet run the cell
 * as a formula, and asset names and trip purposes are typed by hand, so those get a
 * leading apostrophe to stay plain text.
 * @param value - Cell text.
 * @returns The quoted cell.
 */
export function csvText(value: string | null | undefined): string {
  let str = value ?? "";
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Money cell: cents, unquoted, so the spreadsheet reads a number.
 * @param amount - Dollar amount.
 * @returns The amount with two decimals.
 */
export function csvMoney(amount: number): string {
  return roundCents(amount).toFixed(2);
}

/**
 * Kilometre cell, to one decimal place.
 * @param km - Distance.
 * @returns The number as text.
 */
function csvKm(km: number): string {
  return String(roundKm(km));
}

/**
 * Plain number cell (a percentage on the 0-100 scale, or a floor area), to two decimal
 * places.
 * @param value - The number.
 * @returns The number as text.
 */
function csvNumber(value: number): string {
  return String(roundCents(value));
}

/**
 * Rate cell ($/km or $/m²), unrounded: the Tax page takes a rate to any precision, and
 * the cell must show the exact rate the claim was worked from. A finite number never
 * starts with a formula character, so it needs no guard beyond staying a bare number.
 * @param rate - The rate.
 * @returns The number as text.
 */
function csvRate(rate: number): string {
  return String(rate);
}

/**
 * Cell for an input that may not have been entered: the formatted number, or a
 * "Not entered" text cell.
 * @param value - The input, or null.
 * @param format - Cell formatter for a number.
 * @returns The cell.
 */
function csvOptional(value: number | null, format: (n: number) => string): string {
  return value === null ? csvText("Not entered") : format(value);
}

/**
 * DD/MM/YYYY for a ledger date. Ledger dates are UTC midnight of the NZ day, so their
 * UTC parts are the NZ date.
 * @param iso - ISO ledger date.
 * @returns The quoted date cell.
 */
function ledgerDate(iso: string): string {
  return csvText(formatDateSlash(iso, { utc: true }));
}

/**
 * DD/MM/YYYY for a real instant, read on the NZ calendar.
 * @param instant - The instant.
 * @returns Day-first NZ date.
 */
function nzSlashDate(instant: Date): string {
  const [year, month, day] = nzDateParts(instant);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Joins cells into one CSV line.
 * @param cells - Already-formatted cells.
 * @returns The line.
 */
function line(...cells: string[]): string {
  return cells.join(",");
}

/**
 * Plain-English origin for the register.
 * @param origin - Asset origin.
 * @returns "Brought in" or "Bought".
 */
function originLabel(origin: SnapshotAsset["origin"]): string {
  return origin === "introduced" ? "Brought in" : "Bought";
}

/**
 * One asset's register and schedule line for the year.
 * @param row - The asset's schedule row for this year.
 * @param asset - Its register details; undefined only for a malformed snapshot.
 * @returns The CSV line.
 */
function assetLine(row: AssetYearRow, asset: SnapshotAsset | undefined): string {
  const sold = row.disposed && asset?.disposedAt;
  return line(
    csvText(asset?.name ?? row.assetId),
    csvText(asset?.classLabel ?? ""),
    csvText(asset ? originLabel(asset.origin) : ""),
    asset ? ledgerDate(asset.inServiceDate) : csvText(""),
    csvMoney(asset?.costBase ?? 0),
    csvText(asset?.method ?? ""),
    csvNumber((asset?.rate ?? 0) * 100),
    csvNumber(asset?.businessUsePct ?? 0),
    String(row.months),
    csvMoney(row.openingAtv),
    csvMoney(row.depreciation),
    csvMoney(row.investmentBoost),
    csvText(row.writtenOff ? "Yes" : "No"),
    csvMoney(row.deductible),
    csvMoney(row.closingAtv),
    sold && asset?.disposedAt ? ledgerDate(asset.disposedAt) : csvText(""),
    sold && asset?.disposalAmount != null ? csvMoney(asset.disposalAmount) : csvText(""),
    csvMoney(row.recoveryIncome),
    csvMoney(row.lossOnDisposal),
    csvText(asset?.vehicleMethod === "km" ? "Yes" : "No"),
  );
}

/**
 * Builds the accountant CSV for one year from a snapshot (filed or live).
 * @param view - The year's snapshot.
 * @param meta - Labels for the header block.
 * @param meta.fyLabel - FY display label, e.g. "FY 2025-26 (partial)".
 * @param meta.generatedAt - When the file was produced.
 * @param meta.unreadableFiledAt - ISO filing instant when the year is filed but its saved
 * snapshot couldn't be read, so `view` holds fresh figures; null or absent otherwise.
 * @returns The CSV text, BOM first, CRLF line endings.
 */
export function buildTaxCsv(
  view: TaxYearSnapshot,
  meta: { fyLabel: string; generatedAt: Date; unreadableFiledAt?: string | null },
): string {
  const { result } = view;
  const lines: string[] = [];

  // Header block. A filed year with an unreadable snapshot exports fresh figures, and
  // the status says so rather than claiming the year isn't filed.
  lines.push(line(csvText("Tax summary"), csvText(meta.fyLabel)));
  const status = view.filedAt
    ? `Filed ${nzSlashDate(new Date(view.filedAt))}`
    : meta.unreadableFiledAt
      ? `Filed ${nzSlashDate(new Date(meta.unreadableFiledAt))} - saved figures couldn't be read, these are fresh figures`
      : "Not filed - live figures";
  lines.push(line(csvText("Status"), csvText(status)));
  lines.push(line(csvText("Generated"), csvText(nzSlashDate(meta.generatedAt))));
  lines.push("");

  // Summary with the return boxes
  lines.push(csvText("Summary"));
  lines.push(line(csvText("Figure"), csvText("Amount"), csvText("Return")));
  for (const row of SUMMARY_ROWS) {
    lines.push(line(csvText(row.label), csvMoney(readFigure(result, row.path)), csvText(row.box)));
  }
  lines.push("");

  // Deductions, plus the rows the maths left out and why
  lines.push(csvText("Deductions"));
  lines.push(line(csvText("Deduction"), csvText("Amount"), csvText("Note")));
  for (const deduction of result.deductions.lines) {
    lines.push(
      line(csvText(deduction.label), csvMoney(deduction.amount), csvText(deduction.note ?? "")),
    );
  }
  lines.push(line(csvText("Total deductions"), csvMoney(result.deductions.total), csvText("")));
  lines.push(
    line(
      csvText("Not deducted: Fuel"),
      csvMoney(result.deductions.excludedFuel),
      csvText("Dated while a vehicle was on km rates, which cover fuel"),
    ),
  );
  lines.push(
    line(
      csvText("Not deducted: expenses linked to an asset"),
      csvMoney(result.deductions.excludedAssetLinked),
      csvText("Depreciated on the register instead"),
    ),
  );
  lines.push("");

  // Asset register joined to this year's schedule rows
  lines.push(csvText("Asset register and depreciation schedule"));
  lines.push(line(...ASSET_HEADERS.map((header) => csvText(header))));
  const assetsById = new Map(view.assets.map((asset) => [asset.id, asset] as const));
  if (result.assets.length === 0) lines.push(csvText("No assets in use this year"));
  for (const row of result.assets) lines.push(assetLine(row, assetsById.get(row.assetId)));
  lines.push("");

  // Trip log and the tier split. The car's total km sets the Tier 1 share, so it sits
  // just above the tier rows; "Not entered" means the first 14,000 business km were Tier 1.
  // Each tier's rate follows its km so the claim can be worked by hand.
  const year = view.yearInputs;
  lines.push(csvText("Vehicle trips"));
  lines.push(line(csvText("Date"), csvText("Km"), csvText("Purpose")));
  for (const trip of view.trips) {
    lines.push(line(ledgerDate(trip.date), csvKm(trip.km), csvText(trip.purpose)));
  }
  lines.push(line(csvText("Business km"), csvKm(result.km.businessKm)));
  lines.push(
    line(csvText("Km not claimed (no km-rate vehicle)"), csvKm(result.deductions.unclaimedKm)),
  );
  lines.push(
    line(csvText("Total km the car travelled (odometer)"), csvOptional(view.totalVehicleKm, csvKm)),
  );
  lines.push(line(csvText("Tier 1 km"), csvKm(result.km.tier1Km)));
  lines.push(line(csvText("Tier 1 rate ($/km)"), csvRate(year.kmTier1)));
  lines.push(line(csvText("Tier 2 km"), csvKm(result.km.tier2Km)));
  lines.push(line(csvText("Tier 2 rate ($/km)"), csvRate(year.kmTier2)));
  lines.push(line(csvText("Km claim"), csvMoney(result.km.amount)));
  lines.push("");

  // Home office: the inputs first, then the two parts worked from them
  lines.push(csvText("Home office"));
  lines.push(line(csvText("Office floor area (m²)"), csvOptional(year.officeSqm, csvNumber)));
  lines.push(line(csvText("Whole house floor area (m²)"), csvOptional(year.houseSqm, csvNumber)));
  lines.push(line(csvText("Square-metre rate ($/m²)"), csvRate(year.sqmRate)));
  lines.push(
    line(
      csvText("Mortgage interest or rent (whole house)"),
      csvOptional(year.mortgageInterestOrRent, csvMoney),
    ),
  );
  lines.push(line(csvText("Council rates (whole house)"), csvOptional(year.rates, csvMoney)));
  lines.push(
    line(csvText("Office share of house (%)"), csvNumber(result.homeOffice.officePct * 100)),
  );
  lines.push(line(csvText("Square-metre part"), csvMoney(result.homeOffice.sqmPart)));
  lines.push(line(csvText("Proportional part"), csvMoney(result.homeOffice.proportionalPart)));
  lines.push(line(csvText("Home office claim"), csvMoney(result.homeOffice.amount)));

  return BOM + lines.join(EOL) + EOL;
}
