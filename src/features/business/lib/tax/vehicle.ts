// src/features/business/lib/tax/vehicle.ts
// IRD kilometre-rate vehicle claim. The rate covers fuel, running costs and
// depreciation, so a km-rate vehicle is never depreciated. Fuel rows are left out, and
// trips earn the rate, only on days a km-rate vehicle is in service. Tier 1 covers the
// business share of the first 14,000 km the vehicle travels in total (business and
// private); without a total, the first 14,000 business km stand in for it.

import { ledgerDay, roundCents, roundKm } from "@/features/business/lib/tax/helpers";
import type {
  AssetInput,
  KmClaim,
  KmTierRates,
  KmVehiclePeriod,
  LedgerTrip,
  TripKmSplit,
} from "@/features/business/lib/tax/types";

/** Total vehicle km (business and private) whose business share is claimed at the Tier 1 rate. */
export const KM_TIER1_LIMIT = 14_000;

/**
 * Splits a year's business km across the two IRD tiers and prices them. IRD's
 * Tier 1 is the business share of the first 14,000 km the vehicle travels, so
 * when the vehicle's total km for the year is over 14,000, Tier 1 gets
 * businessKm x 14,000 / total (to 0.1 km) and the rest of the business km go to
 * Tier 2. With no total, a total of 14,000 or less, or a total below the
 * business km (impossible, so treated as missing), the first 14,000 business km
 * are Tier 1.
 * @param businessKm - Business km logged in the FY.
 * @param rates - The FY's Tier 1 and Tier 2 per-km rates.
 * @param totalVehicleKm - Every km the vehicle travelled in the FY (business and private), when known.
 * @returns The km in each tier and the claim in dollars.
 */
export function kmClaim(
  businessKm: number,
  rates: KmTierRates,
  totalVehicleKm?: number | null,
): KmClaim {
  const km = roundKm(Math.max(0, businessKm));
  const tier1Km =
    typeof totalVehicleKm === "number" && totalVehicleKm > KM_TIER1_LIMIT && totalVehicleKm >= km
      ? roundKm((km * KM_TIER1_LIMIT) / totalVehicleKm)
      : Math.min(km, KM_TIER1_LIMIT);
  const tier2Km = roundKm(km - tier1Km);
  return {
    businessKm: km,
    tier1Km,
    tier2Km,
    amount: roundCents(tier1Km * rates.tier1 + tier2Km * rates.tier2),
  };
}

/**
 * The days each km-rate vehicle on the register is in service: from its
 * in-service day up to (not including) its disposal day, or open-ended while
 * still held. Other assets are skipped. Periods may overlap when two km
 * vehicles are held at once; {@link inKmVehiclePeriod} only asks whether any covers a day.
 * @param assets - Every asset on the register.
 * @returns One period per km-rate vehicle, in register order.
 */
export function kmVehiclePeriods(assets: readonly AssetInput[]): KmVehiclePeriod[] {
  return assets
    .filter((a) => a.vehicleMethod === "km")
    .map((a) => ({
      from: ledgerDay(a.inServiceDate).toISOString(),
      to: a.disposedAt === null ? null : ledgerDay(a.disposedAt).toISOString(),
    }));
}

/**
 * Whether a km-rate vehicle was in service on a ledger date. The date is moved
 * to its NZ day first, so a stored ledger date and a real instant on the same
 * NZ day give the same answer.
 * @param date - ISO string or Date.
 * @param periods - From {@link kmVehiclePeriods}.
 * @returns True when some period has from <= day < to (or no `to`).
 */
export function inKmVehiclePeriod(
  date: string | Date,
  periods: readonly KmVehiclePeriod[],
): boolean {
  const day = ledgerDay(date).toISOString();
  return periods.some((p) => day >= p.from && (p.to === null || day < p.to));
}

/**
 * Splits trips into km a km-rate vehicle covered (claimable) and km logged on
 * days none did (not claimed). Pass trips already filtered to the FY.
 * @param trips - Logged trips.
 * @param periods - From {@link kmVehiclePeriods}.
 * @returns Both totals, each rounded to 0.1 km.
 */
export function splitTripKm(
  trips: readonly LedgerTrip[],
  periods: readonly KmVehiclePeriod[],
): TripKmSplit {
  let claimableKm = 0;
  let outsideKm = 0;
  for (const t of trips) {
    if (inKmVehiclePeriod(t.date, periods)) claimableKm += t.km;
    else outsideKm += t.km;
  }
  return { claimableKm: roundKm(claimableKm), outsideKm: roundKm(outsideKm) };
}
