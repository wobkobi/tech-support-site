// src/features/business/lib/tax/depreciation.ts
// Per-asset IR260 depreciation schedule: DV/SL, part-year months, low-value write-off,
// Investment Boost, private-use split and disposal. Filed snapshots pin opening values.

import { APRIL } from "@/features/business/lib/financial-year";
import { ledgerDay, pctFraction, roundCents } from "@/features/business/lib/tax/helpers";
import type {
  AssetInput,
  AssetScheduleContext,
  AssetYearRow,
  TaxFy,
} from "@/features/business/lib/tax/types";

/** Investment Boost share of cost deducted in year one (TIB 37/7). */
const INVESTMENT_BOOST_RATE = 0.2;

/** Investment Boost covers assets first used on or after 22 May 2025 (ledger scale). */
export const INVESTMENT_BOOST_FROM = new Date(Date.UTC(2025, 4, 22));

/**
 * One asset's filed closing values out of the all-assets map.
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
 * The NZ day an asset starts depreciating: its in-service date, but never before business start.
 * @param asset - The asset.
 * @param businessStart - Business start date.
 * @returns Ledger-scale start day.
 */
export function assetStartDay(asset: AssetInput, businessStart: Date): Date {
  const inService = ledgerDay(asset.inServiceDate);
  const started = ledgerDay(businessStart);
  return inService.getTime() < started.getTime() ? started : inService;
}

/**
 * Combined cost of each asset's low-value group (s EE 38): purchases of one class from one
 * supplier on one NZ day. Introduced assets, km-rate vehicles and blank suppliers stand alone.
 * @param assets - Every asset on the register.
 * @returns Map of asset id to its group's total cost.
 */
export function lowValueGroupTotals(assets: readonly AssetInput[]): Map<string, number> {
  const groupKeyById = new Map<string, string>();
  const groupSum = new Map<string, number>();
  for (const asset of assets) {
    const supplier = asset.supplier?.trim().toLowerCase() ?? "";
    if (asset.origin !== "purchased" || asset.vehicleMethod === "km" || supplier === "") {
      continue;
    }
    const day = ledgerDay(asset.inServiceDate).toISOString().slice(0, 10);
    const key = `${supplier}|${day}|${asset.classKey}`;
    groupKeyById.set(asset.id, key);
    groupSum.set(key, (groupSum.get(key) ?? 0) + asset.costBase);
  }
  const totals = new Map<string, number>();
  for (const asset of assets) {
    const key = groupKeyById.get(asset.id);
    const sum = key === undefined ? undefined : groupSum.get(key);
    totals.set(asset.id, roundCents(sum ?? asset.costBase));
  }
  return totals;
}

/**
 * Months in use in the asset's first FY; a part month counts as whole (IR260). Clamped to 0-12.
 * @param start - Ledger-scale start day.
 * @param fy - The FY the asset starts in.
 * @returns Months from the start month to March inclusive.
 */
function firstYearMonths(start: Date, fy: TaxFy): number {
  const monthsBefore =
    (start.getUTCFullYear() - fy.start.getUTCFullYear()) * 12 + start.getUTCMonth() - APRIL;
  return Math.min(12, Math.max(0, 12 - monthsBefore));
}

/**
 * Depreciation schedule for one asset, a row per FY from its start through its disposal FY.
 * `fys` must include every FY from the first, as each opening ATV is the prior closing (or filed) value.
 * - Disposal FY: no depreciation; sale above ATV is recovery (capped at cost less opening ATV), below is a loss.
 * - First FY: low-value group written off in full; Investment Boost takes 20% of cost and SL runs on the 80% after.
 * - Else DV: opening ATV x rate; SL: base x rate capped at ATV; first FY x months/12. Km-rate vehicles never depreciate.
 * @param asset - The asset.
 * @param fys - Financial years to schedule, any order.
 * @param ctx - Business start, threshold, group total and filed closing values.
 * @returns One row per FY the asset is on the register, oldest first.
 */
export function assetSchedule(
  asset: AssetInput,
  fys: readonly TaxFy[],
  ctx: AssetScheduleContext,
): AssetYearRow[] {
  const start = assetStartDay(asset, ctx.businessStart);
  const disposedDay = asset.disposedAt ? ledgerDay(asset.disposedAt) : null;
  const businessShare = pctFraction(asset.businessUsePct);
  const isKmVehicle = asset.vehicleMethod === "km";
  const writeOff =
    !isKmVehicle && asset.origin === "purchased" && ctx.groupTotal <= ctx.lowValueThreshold;
  const boostEligible =
    !isKmVehicle &&
    !writeOff &&
    asset.investmentBoost &&
    asset.origin === "purchased" &&
    ledgerDay(asset.inServiceDate).getTime() >= INVESTMENT_BOOST_FROM.getTime();
  const ordered = [...fys].sort((a, b) => a.start.getTime() - b.start.getTime());

  const rows: AssetYearRow[] = [];
  let carriedAtv = asset.costBase;
  let slBase = asset.costBase;
  let prevKey: string | null = null;
  let first = true;
  for (const fy of ordered) {
    if (start.getTime() >= fy.end.getTime()) {
      prevKey = fy.key;
      continue;
    }
    const filed = prevKey === null ? undefined : ctx.filedClosingAtv.get(prevKey);
    const opening = roundCents(filed ?? carriedAtv);
    // Rows stop after disposal, so the first FY ending after it is the disposal FY
    // (a disposal before the start day lands in the first row).
    const disposedHere = disposedDay !== null && disposedDay.getTime() < fy.end.getTime();
    const months = disposedHere ? 0 : first ? firstYearMonths(start, fy) : 12;

    let depreciation = 0;
    let boost = 0;
    let writtenOff = false;
    if (!disposedHere && !isKmVehicle && opening > 0) {
      if (first && writeOff) {
        depreciation = opening;
        writtenOff = true;
      } else {
        if (first && boostEligible) {
          boost = roundCents(asset.costBase * INVESTMENT_BOOST_RATE);
          slBase = asset.costBase - boost;
        }
        const base = opening - boost;
        const annual = asset.method === "SL" ? slBase * asset.rate : base * asset.rate;
        const normal = Math.min(base, (annual * months) / 12);
        depreciation = roundCents(boost + normal);
      }
    }

    let recoveryIncome = 0;
    let lossOnDisposal = 0;
    if (disposedHere && !isKmVehicle) {
      const sale = asset.disposalAmount ?? 0;
      const claimedToDate = Math.max(0, asset.costBase - opening);
      if (sale > opening) {
        recoveryIncome = roundCents(Math.min(sale - opening, claimedToDate) * businessShare);
      } else if (sale < opening) {
        lossOnDisposal = roundCents((opening - sale) * businessShare);
      }
    }

    const closingAtv = disposedHere ? 0 : roundCents(Math.max(0, opening - depreciation));
    rows.push({
      assetId: asset.id,
      fyKey: fy.key,
      months,
      openingAtv: opening,
      depreciation,
      investmentBoost: boost,
      writtenOff,
      deductible: roundCents(depreciation * businessShare),
      closingAtv,
      recoveryIncome,
      lossOnDisposal,
      disposed: disposedHere,
    });
    if (disposedHere) break;
    carriedAtv = closingAtv;
    prevKey = fy.key;
    first = false;
  }
  return rows;
}
