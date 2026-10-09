// src/features/business/lib/tax/view.server.ts
// Server loaders behind the Tax page, the CSV export and the filed toggle: one financial
// year's live figures in snapshot shape, the saved snapshot when the year is filed (and how
// a fresh calculation differs from it), and the filed years the asset and trip forms warn about.

import "server-only";

import { fyKeyOf, type FinancialYear } from "@/features/business/lib/financial-year";
import { loadAllFys, loadTaxInputs } from "@/features/business/lib/tax/load";
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
import type { TaxYearInput } from "@/features/business/lib/tax/types";
import { prisma } from "@/shared/lib/prisma";

/** FY keys look like "2025-26". */
const FY_KEY_PATTERN = /^\d{4}-\d{2}$/;

/** One year as the Tax page and CSV see it. */
export interface TaxYearView {
  fyKey: string;
  /** Live inputs: the home office form reads its saved values from `input.year`. */
  input: TaxYearInput;
  /** The year computed now. */
  live: TaxYearSnapshot;
  /** ISO instant the year was marked filed, or null. */
  filedAtIso: string | null;
  /** The saved snapshot; null when not filed or when the stored JSON can't be read. */
  filed: TaxYearSnapshot | null;
  /**
   * True when the year is filed but its saved snapshot can't be read (damaged or an older
   * version). `shown` is then the live figures, and the page warns that they are fresh.
   */
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
 * Trips dated inside a year, with purpose, oldest first. Half-open window, the same
 * bounds the tax maths uses.
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
 * Computes a year now and wraps it in snapshot shape. The car's total km comes from the
 * year's TaxYear record as loaded, never a default, since it sets the Tier 1 split.
 * @param fy - The year.
 * @param now - Reference instant.
 * @param filedAt - ISO filing instant to stamp, or null for a live view.
 * @returns The live inputs and the snapshot built from them.
 */
export async function buildLiveSnapshot(
  fy: FinancialYear,
  now: Date,
  filedAt: string | null = null,
): Promise<{ input: TaxYearInput; snapshot: TaxYearSnapshot }> {
  const [input, trips] = await Promise.all([loadTaxInputs(fy, now), loadFyTrips(fy)]);
  const result = computeTaxYear(input);
  const snapshot = buildTaxYearSnapshot({
    result,
    assets: input.assets,
    trips,
    totalVehicleKm: input.year.totalVehicleKm ?? null,
    filedAt,
  });
  return { input, snapshot };
}

/**
 * Loads one year for the Tax page or the CSV. A filed year shows its saved snapshot and
 * lists how a fresh calculation now differs; an unfiled year shows live figures. A filed
 * year whose snapshot can't be read falls back to the live figures with
 * `snapshotUnreadable` set, so the page still renders and the CSV still downloads.
 * @param fy - The year.
 * @param now - Reference instant.
 * @returns The year's view.
 */
export async function loadTaxYearView(fy: FinancialYear, now: Date): Promise<TaxYearView> {
  const fyKey = fyKeyOf(fy.label);
  const [{ input, snapshot: live }, record] = await Promise.all([
    buildLiveSnapshot(fy, now),
    prisma.taxYear.findUnique({ where: { fyKey }, select: { filedAt: true, snapshot: true } }),
  ]);
  const filedAtIso = record?.filedAt ? record.filedAt.toISOString() : null;
  const filed = filedAtIso ? parseTaxYearSnapshot(record?.snapshot) : null;
  return {
    fyKey,
    input,
    live,
    filedAtIso,
    filed,
    snapshotUnreadable: filedAtIso !== null && filed === null,
    shown: filed ?? live,
    changes: filed ? diffSnapshots(filed, live) : [],
  };
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
