// src/features/business/lib/tax/vehicle.ts
// IRD kilometre-rate vehicle claim (covers fuel, running costs and depreciation). Trips earn
// the rate only on days a km-rate vehicle is in service.

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
 * Splits business km across the IRD tiers and prices them. Total over 14,000: Tier 1 is
 * businessKm x 14,000 / total. Otherwise (missing, <= 14,000, or below businessKm) the first
 * 14,000 business km are Tier 1.
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
 * Each km-rate vehicle's in-service period [inService, disposal), open-ended while held.
 * Periods may overlap; {@link inKmVehiclePeriod} only asks whether any covers a day.
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
 * Whether a km-rate vehicle was in service on a date's NZ day.
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
 * Whether a date is before the first km-rate vehicle went into service (so the trip used an
 * unregistered car). False when there is no km-rate vehicle.
 * @param date - ISO string or Date.
 * @param periods - From {@link kmVehiclePeriods}.
 * @returns True when the NZ day is earlier than every period's start.
 */
export function beforeKmVehicles(
  date: string | Date,
  periods: readonly KmVehiclePeriod[],
): boolean {
  if (periods.length === 0) return false;
  const day = ledgerDay(date).toISOString();
  return periods.every((p) => day < p.from);
}

/**
 * Splits FY-filtered trips into km a km-rate vehicle covered and km it didn't.
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
