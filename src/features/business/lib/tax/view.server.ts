// src/features/business/lib/tax/view.server.ts
// Server loaders for the Tax page, CSV export and filed toggle: live figures, the filed
// snapshot and its diff, the result other pages show, and the list of filed years.

import "server-only";

import { fyKeyOf, type FinancialYear } from "@/features/business/lib/financial-year";
import {
  loadAllFys,
  loadTaxInputsWithRecord,
  loadTaxYearRows,
  type TaxYearRow,
} from "@/features/business/lib/tax/load";
import {
  buildTaxYearSnapshot,
  diffSnapshots,
  parseTaxYearSnapshot,
  type FiledYearRef,
  type SnapshotChange,
  type SnapshotTrip,
  type TaxYearSnapshot,
} from "@/features/business/lib/tax/snapshot";
import { computeTaxYear } from "@/features/business/lib/tax/tax-year";
import type { TaxYearInput, TaxYearResult } from "@/features/business/lib/tax/types";
import { prisma } from "@/shared/lib/prisma";

/** FY keys look like "2025-26". */
const FY_KEY_PATTERN = /^\d{4}-\d{2}$/;

/** One year as the Tax page and CSV see it. */
export interface TaxYearView {
  fyKey: string;
  /** Live inputs, with blank rates already filled from IRD's published ones. */
  input: TaxYearInput;
  /** Stored TaxYear row as saved (blank rates stay null), or null; seeds the home office form. */
  record: TaxYearRow | null;
  /** The year computed now. */
  live: TaxYearSnapshot;
  /** ISO instant the year was marked filed, or null. */
  filedAtIso: string | null;
  /** The saved snapshot; null when not filed or when the stored JSON can't be read. */
  filed: TaxYearSnapshot | null;
  /** Filed but the snapshot can't be read; `shown` falls back to live figures with a warning. */
  snapshotUnreadable: boolean;
  /** What the page and CSV show: the snapshot while filed and readable, otherwise the live figures. */
  shown: TaxYearSnapshot;
  /** Differences between the snapshot and the live figures; empty when not filed or unreadable. */
  changes: SnapshotChange[];
}

/**
 * Finds the financial year for an FY key among the years the business has traded in.
 * @param fyKey - Key like "2025-26".
 * @param now - Reference instant.
 * @returns The year, or null for a malformed or out-of-range key.
 */
export async function resolveFinancialYear(
  fyKey: string,
  now: Date,
): Promise<FinancialYear | null> {
  if (!FY_KEY_PATTERN.test(fyKey)) return null;
  const fys = await loadAllFys(now);
  return fys.find((fy) => fyKeyOf(fy.label) === fyKey) ?? null;
}

/**
 * Trips inside a year (half-open window, as the tax maths uses), oldest first.
 * @param fy - The year.
 * @returns The trips.
 */
async function loadFyTrips(fy: FinancialYear): Promise<SnapshotTrip[]> {
  const trips = await prisma.trip.findMany({
    where: { date: { gte: fy.start, lt: fy.end } },
    orderBy: { date: "asc" },
    select: { date: true, km: true, purpose: true },
  });
  return trips.map((trip) => ({
    date: trip.date.toISOString(),
    km: trip.km,
    purpose: trip.purpose,
  }));
}

/**
 * Computes a year now in snapshot shape. Total car km comes from the stored record, never
 * a default, since it sets the Tier 1 split.
 * @param fy - The year.
 * @param now - Reference instant.
 * @param filedAt - ISO filing instant to stamp, or null for a live view.
 * @returns The live inputs, the TaxYear row from the same read (or null), and the snapshot.
 */
export async function buildLiveSnapshot(
  fy: FinancialYear,
  now: Date,
  filedAt: string | null = null,
): Promise<{ input: TaxYearInput; record: TaxYearRow | null; snapshot: TaxYearSnapshot }> {
  const [{ input, record }, trips] = await Promise.all([
    loadTaxInputsWithRecord(fy, now),
    loadFyTrips(fy),
  ]);
  const result = computeTaxYear(input);
  const snapshot = buildTaxYearSnapshot({
    result,
    assets: input.assets,
    trips,
    totalVehicleKm: input.year.totalVehicleKm ?? null,
    yearInputs: input.year,
    filedAt,
  });
  return { input, record, snapshot };
}

/**
 * Loads one year for the Tax page or CSV: the filed snapshot plus its diff from live, or
 * live figures when unfiled or the snapshot is unreadable (`snapshotUnreadable` set).
 * @param fy - The year.
 * @param now - Reference instant.
 * @returns The year's view.
 */
export async function loadTaxYearView(fy: FinancialYear, now: Date): Promise<TaxYearView> {
  const fyKey = fyKeyOf(fy.label);
  // Same read as the inputs: the CSV route handler has no React cache to dedupe a second.
  const { input, record, snapshot: live } = await buildLiveSnapshot(fy, now);
  const filedAtIso = record?.filedAt ? record.filedAt.toISOString() : null;
  const filed = filedAtIso ? parseTaxYearSnapshot(record?.snapshot) : null;
  return {
    fyKey,
    input,
    record,
    live,
    filedAtIso,
    filed,
    snapshotUnreadable: filedAtIso !== null && filed === null,
    shown: filed ?? live,
    changes: filed ? diffSnapshots(filed, live) : [],
  };
}

/**
 * A filed year's saved result.
 * @param record - The year's TaxYear row, or undefined when none exists.
 * @returns The snapshot's result, or null when unfiled or unreadable.
 */
function filedResultOf(
  record: Pick<TaxYearRow, "filedAt" | "snapshot"> | undefined,
): TaxYearResult | null {
  if (!record?.filedAt) return null;
  return parseTaxYearSnapshot(record.snapshot)?.result ?? null;
}

/**
 * The figures a year shows outside the Tax page: the filed result while filed (so the
 * overview matches the Tax page), else live, with the Tax page's unreadable fallback.
 * @param input - The year's live inputs.
 * @param record - The year's TaxYear row, or undefined when none exists.
 * @returns The result to show.
 */
export function shownResultFor(
  input: TaxYearInput,
  record: Pick<TaxYearRow, "filedAt" | "snapshot"> | undefined,
): TaxYearResult {
  return filedResultOf(record) ?? computeTaxYear(input);
}

/**
 * One year's filed result, shown beside live figures (the Trips page's km claim).
 * @param fyKey - FY key, e.g. "2025-26".
 * @returns The snapshot's result, or null when unfiled or unreadable.
 */
export async function loadFiledResult(fyKey: string): Promise<TaxYearResult | null> {
  const rows = await loadTaxYearRows();
  return filedResultOf(rows.find((row) => row.fyKey === fyKey));
}

/**
 * {@link shownResultFor} for several years from one TaxYear read.
 * @param inputs - Each year's live inputs.
 * @returns One result per input, in the same order.
 */
export async function loadShownResults(inputs: readonly TaxYearInput[]): Promise<TaxYearResult[]> {
  const rows = await loadTaxYearRows();
  return inputs.map((input) =>
    shownResultFor(
      input,
      rows.find((row) => row.fyKey === input.fy.key),
    ),
  );
}

/**
 * Every filed year, oldest first, for the asset and trip forms' warning.
 * @param now - Reference instant (bounds the FY list).
 * @returns Filed years with their date windows.
 */
export async function loadFiledYears(now: Date): Promise<FiledYearRef[]> {
  const [fys, rows] = await Promise.all([
    loadAllFys(now),
    prisma.taxYear.findMany({ select: { fyKey: true, filedAt: true } }),
  ]);
  const filedAt = new Map<string, Date>();
  for (const row of rows) if (row.filedAt) filedAt.set(row.fyKey, row.filedAt);
  const refs: FiledYearRef[] = [];
  for (const fy of fys) {
    const fyKey = fyKeyOf(fy.label);
    const at = filedAt.get(fyKey);
    if (!at) continue;
    refs.push({
      fyKey,
      label: fy.label,
      startIso: fy.start.toISOString(),
      endIso: fy.end.toISOString(),
      filedAtIso: at.toISOString(),
    });
  }
  return refs.sort((a, b) => a.startIso.localeCompare(b.startIso));
}
