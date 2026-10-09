// scripts/check-tax-load.ts
// The pure mappers inside the tax loader: stored Asset rows > AssetInput, TaxYear rows >
// the year record (blank rates filled from IRD for the year and fuel type), and
// settings.tax > the rules the maths reads. load.ts is server-only, hence the
// react-server condition; nothing here touches the database.
// Run with: npm run check:tax-load

import {
  taxRulesFrom,
  toAssetInput,
  yearRecordFor,
  type TaxYearRow,
} from "@/features/business/lib/tax/load";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { Asset } from "@prisma/client";

let failures = 0;

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - What the call produced.
 * @param expected - What it should have produced.
 */
function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label} > ${a}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${e}, got ${a}`);
    failures++;
  }
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  const stamp = new Date("2026-10-09T00:00:00.000Z");
  const ute: Asset = {
    id: "a1",
    name: "Ford Ranger",
    classKey: "vehicle",
    origin: "introduced",
    inServiceDate: new Date("2025-10-01T00:00:00.000Z"),
    costBase: 18000,
    supplier: null,
    valuationNote: "Turners listing",
    method: "DV",
    rate: 0.3,
    businessUsePct: 60,
    investmentBoost: false,
    vehicleMethod: "km",
    expenseId: null,
    disposedAt: null,
    disposalAmount: null,
    notes: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  console.log("Asset rows:");
  expectEqual("introduced km vehicle", toAssetInput(ute), {
    id: "a1",
    name: "Ford Ranger",
    classKey: "vehicle",
    origin: "introduced",
    inServiceDate: "2025-10-01T00:00:00.000Z",
    costBase: 18000,
    supplier: null,
    method: "DV",
    rate: 0.3,
    businessUsePct: 60,
    investmentBoost: false,
    vehicleMethod: "km",
    disposedAt: null,
    disposalAmount: null,
    expenseId: null,
  });
  const odd = toAssetInput({
    ...ute,
    origin: "bought",
    method: "SL",
    vehicleMethod: "logbook",
    supplier: "  ",
    disposedAt: new Date("2026-08-15T00:00:00.000Z"),
    disposalAmount: 500,
    expenseId: "e1",
  });
  expectEqual(
    "unknown values narrow; blank supplier is null; dates go ISO",
    [
      odd.origin,
      odd.method,
      odd.vehicleMethod,
      odd.supplier,
      odd.disposedAt,
      odd.disposalAmount,
      odd.expenseId,
    ],
    ["purchased", "SL", null, null, "2026-08-15T00:00:00.000Z", 500, "e1"],
  );

  console.log("\nYear record:");
  expectEqual(
    "published year, petrol, nothing stored",
    yearRecordFor("2025-26", undefined, "petrol"),
    {
      officeSqm: null,
      houseSqm: null,
      sqmRate: 57.3,
      kmTier1: 1.2,
      kmTier2: 0.37,
      totalVehicleKm: null,
      mortgageInterestOrRent: null,
      rates: null,
    },
  );
  expectEqual(
    "unpublished year falls back to the latest rates, diesel",
    yearRecordFor("2026-27", undefined, "diesel"),
    {
      officeSqm: null,
      houseSqm: null,
      sqmRate: 57.3,
      kmTier1: 1.3,
      kmTier2: 0.38,
      totalVehicleKm: null,
      mortgageInterestOrRent: null,
      rates: null,
    },
  );
  const stored: TaxYearRow = {
    fyKey: "2026-27",
    officeSqm: 9,
    houseSqm: 120,
    sqmRate: 60,
    kmTier1: null,
    kmTier2: 0.4,
    totalVehicleKm: 21000,
    mortgageInterestOrRent: 18000,
    rates: 3200,
    filedAt: null,
    snapshot: null,
  };
  expectEqual(
    "stored values win, gaps from IRD, electric",
    yearRecordFor("2026-27", stored, "electric"),
    {
      officeSqm: 9,
      houseSqm: 120,
      sqmRate: 60,
      kmTier1: 1.22,
      kmTier2: 0.4,
      totalVehicleKm: 21000,
      mortgageInterestOrRent: 18000,
      rates: 3200,
    },
  );
  expectEqual(
    "unset total vehicle km reads as null",
    yearRecordFor("2026-27", { ...stored, totalVehicleKm: null }, "petrol").totalVehicleKm,
    null,
  );

  console.log("\nTax rules:");
  const rules = taxRulesFrom(DEFAULT_SETTINGS.tax);
  expectEqual("only the fields the maths reads", Object.keys(rules).sort(), [
    "acc",
    "brackets",
    "categoryBusinessUse",
    "ietc",
    "kiwiSaver",
    "lowValueThreshold",
    "provisionalThreshold",
    "vehicleFuel",
  ]);
  expectEqual(
    "copies, so the maths can't change the cached settings",
    [
      rules.brackets !== DEFAULT_SETTINGS.tax.brackets,
      rules.ietc !== DEFAULT_SETTINGS.tax.ietc,
      rules.categoryBusinessUse !== DEFAULT_SETTINGS.tax.categoryBusinessUse,
    ],
    [true, true, true],
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
