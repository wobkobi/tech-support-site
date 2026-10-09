// scripts/check-tax.ts
// Fixtures for the tax maths library: GST basis, IR265 classes, depreciation schedules
// (part years, brought-in assets, low-value grouping, Investment Boost, disposals, filed
// carry-forward), km tiers, home office, brackets, IETC, set-aside targets and one
// end-to-end FY 2026-27 estimate. Every expected figure is worked by hand in a comment.
// Run with: npm run check:tax

import { getFinancialYear } from "@/features/business/lib/financial-year";
import {
  ASSET_CLASSES,
  DEFAULT_IETC,
  DEFAULT_TAX_BRACKETS,
  VEHICLE_CLASS_KEY,
  assetClassByKey,
  assetSchedule,
  computeTaxYear,
  expenseTaxBasis,
  homeOfficeClaim,
  inKmVehiclePeriod,
  incomeTaxBasis,
  incomeTaxOnBrackets,
  independentEarnerCredit,
  irdRatesFor,
  isGstRegisteredOn,
  kmClaim,
  kmVehiclePeriods,
  lowValueGroupTotals,
  setAsideTargets,
  splitTripKm,
  toTaxFy,
  type AssetInput,
  type AssetYearRow,
  type GstStatus,
  type LedgerExpense,
  type TaxFy,
  type TaxRulesSettings,
  type TaxYearInput,
  type TaxYearRecordInput,
  type TaxYearResult,
} from "@/features/business/lib/tax";
import { buildTaxCsv, csvMoney, csvText } from "@/features/business/lib/tax/export-csv";
import { inFy, ledgerDay, pctFraction, roundCents } from "@/features/business/lib/tax/helpers";
import {
  buildTaxYearSnapshot,
  closingAtvFromSnapshot,
  diffSnapshots,
  filedClosingAtvByFy,
  filedYearsTouched,
  parseTaxYearSnapshot,
  type FiledYearRef,
} from "@/features/business/lib/tax/snapshot";

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

/**
 * A ledger-scale FY for the year starting 1 April of `startYear`.
 * @param startYear - Start year, e.g. 2026 for FY 2026-27.
 * @returns The FY.
 */
function fy(startYear: number): TaxFy {
  const yy = String((startYear + 1) % 100).padStart(2, "0");
  return {
    key: `${startYear}-${yy}`,
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 3, 1)),
    current: startYear === 2026,
  };
}

/** Runs the shared helper fixtures. */
function checkHelpers(): void {
  console.log("Helpers:");
  expectEqual(
    "roundCents",
    [roundCents(1066.6666), roundCents(0.1 + 0.2), roundCents(-4.004)],
    [1066.67, 0.3, -4],
  );
  expectEqual(
    "pctFraction clamps, non-finite counts as 100",
    [pctFraction(80), pctFraction(150), pctFraction(-5), pctFraction(Number.NaN)],
    [0.8, 1, 0, 1],
  );
  expectEqual(
    "ledgerDay keeps a ledger date",
    ledgerDay("2026-04-01T00:00:00.000Z").toISOString(),
    "2026-04-01T00:00:00.000Z",
  );
  // 2026-03-31T11:30Z is 12:30am on 1 April NZDT.
  expectEqual(
    "ledgerDay moves a real instant to its NZ day",
    ledgerDay(new Date("2026-03-31T11:30:00.000Z")).toISOString(),
    "2026-04-01T00:00:00.000Z",
  );
  expectEqual(
    "ledgerDay reads a bare date",
    ledgerDay("2026-04-01").toISOString(),
    "2026-04-01T00:00:00.000Z",
  );
  const fy2627 = fy(2026);
  expectEqual(
    "inFy is half-open: 31 Mar out, 1 Apr in, 31 Mar next year in, 1 Apr next year out",
    [
      "2026-03-31T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      "2027-03-31T00:00:00.000Z",
      "2027-04-01T00:00:00.000Z",
    ].map((d) => inFy(d, fy2627)),
    [false, true, true, false],
  );
  expectEqual("inFy reads a bare date", inFy("2026-04-01", fy2627), true);
}

const UNREGISTERED: GstStatus = { registered: false, registeredFrom: null };

/** Runs the GST basis fixtures. */
function checkGstBasis(): void {
  console.log("\nGST basis:");
  const fromJuly: GstStatus = { registered: true, registeredFrom: "2026-07-01T00:00:00.000Z" };
  const row = { amountIncl: 115, amountExcl: 100 };
  expectEqual(
    "row the day before registration > incl",
    expenseTaxBasis({ ...row, date: "2026-06-30T00:00:00.000Z" }, fromJuly),
    115,
  );
  expectEqual(
    "row on the registration date > excl",
    expenseTaxBasis({ ...row, date: "2026-07-01T00:00:00.000Z" }, fromJuly),
    100,
  );
  expectEqual(
    "row after registration > excl",
    expenseTaxBasis({ ...row, date: "2026-12-01T00:00:00.000Z" }, fromJuly),
    100,
  );
  expectEqual(
    "unregistered > incl",
    expenseTaxBasis({ ...row, date: "2026-12-01T00:00:00.000Z" }, UNREGISTERED),
    115,
  );
  expectEqual(
    "registered with no from-date > excl",
    expenseTaxBasis(
      { ...row, date: "2025-10-01T00:00:00.000Z" },
      { registered: true, registeredFrom: null },
    ),
    100,
  );
  expectEqual(
    "empty from-date reads as from business start",
    isGstRegisteredOn("2025-10-01T00:00:00.000Z", { registered: true, registeredFrom: "" }),
    true,
  );
  // 2026-06-30T12:30Z is 12:30am on 1 July NZST: the NZ day, not the UTC day, decides.
  expectEqual(
    "real instant just after NZ midnight on the from-date",
    isGstRegisteredOn(new Date("2026-06-30T12:30:00.000Z"), fromJuly),
    true,
  );
  // Income rows hold only the GST-inclusive amount; registered rows drop the GST:
  // 115 / 1.15 = 100.
  expectEqual(
    "income unregistered > as entered",
    incomeTaxBasis({ date: "2026-12-01T00:00:00.000Z", amount: 115 }, UNREGISTERED),
    115,
  );
  expectEqual(
    "income the day before registration > as entered",
    incomeTaxBasis({ date: "2026-06-30T00:00:00.000Z", amount: 115 }, fromJuly),
    115,
  );
  expectEqual(
    "income on the registration date > excl",
    incomeTaxBasis({ date: "2026-07-01T00:00:00.000Z", amount: 115 }, fromJuly),
    100,
  );
  expectEqual(
    "income after registration > excl",
    incomeTaxBasis({ date: "2026-12-01T00:00:00.000Z", amount: 115 }, fromJuly),
    100,
  );
  // 250 / 1.15 = 217.3913 > 217.39.
  expectEqual(
    "income excl rounds to cents",
    incomeTaxBasis({ date: "2026-12-01T00:00:00.000Z", amount: 250 }, fromJuly),
    217.39,
  );
}

/** Runs the IR265 class table and IRD year-rate fixtures. */
function checkTables(): void {
  console.log("\nIR265 classes and IRD year rates:");
  const keys = ASSET_CLASSES.map((c) => c.key);
  expectEqual("14 classes, keys unique", [keys.length, new Set(keys).size], [14, 14]);
  expectEqual(
    "every key from the plan present",
    [
      "computer",
      "printer",
      "phone",
      "furniture-chair",
      "desk",
      "office-equipment",
      "test-equipment",
      "loose-tools",
      "hand-instruments",
      "vehicle",
      "software",
      "networking",
      "ups-cabling",
      "tablet",
    ].filter((k) => !assetClassByKey(k)),
    [],
  );
  const computer = assetClassByKey("computer");
  expectEqual(
    "computer DV/SL/life",
    [computer?.dv, computer?.sl, computer?.lifeYears],
    [0.5, 0.4, 4],
  );
  const chair = assetClassByKey("furniture-chair");
  expectEqual("chair DV/SL/life", [chair?.dv, chair?.sl, chair?.lifeYears], [0.16, 0.105, 12.5]);
  const car = assetClassByKey("vehicle");
  expectEqual("vehicle DV/SL/life", [car?.dv, car?.sl, car?.lifeYears], [0.3, 0.21, 5]);
  expectEqual("VEHICLE_CLASS_KEY names the vehicle class", car?.key, VEHICLE_CLASS_KEY);
  expectEqual("unknown class", assetClassByKey("boat"), undefined);
  expectEqual("2025-26 m2 rate", irdRatesFor("2025-26").sqmRate, 57.3);
  expectEqual("2025-26 petrol tiers", irdRatesFor("2025-26").km.petrol, {
    tier1: 1.2,
    tier2: 0.37,
  });
  expectEqual("2025-26 diesel tiers", irdRatesFor("2025-26").km.diesel, {
    tier1: 1.3,
    tier2: 0.38,
  });
  expectEqual("2025-26 hybrid tiers", irdRatesFor("2025-26").km["petrol-hybrid"], {
    tier1: 0.9,
    tier2: 0.24,
  });
  expectEqual("2025-26 electric tiers", irdRatesFor("2025-26").km.electric, {
    tier1: 1.22,
    tier2: 0.23,
  });
  expectEqual("2026-27 falls back to 2025-26", irdRatesFor("2026-27").sqmRate, 57.3);
  expectEqual("2024-25 falls forward to the earliest", irdRatesFor("2024-25").sqmRate, 57.3);
}

/** Runs the km tier and home office fixtures. */
function checkKmAndHomeOffice(): void {
  console.log("\nKm tiers (petrol 2025-26: $1.20 / $0.37):");
  const petrol = irdRatesFor("2025-26").km.petrol;
  expectEqual("10,000 km all tier 1", kmClaim(10_000, petrol), {
    businessKm: 10000,
    tier1Km: 10000,
    tier2Km: 0,
    amount: 12000,
  });
  expectEqual("exactly 14,000 km", kmClaim(14_000, petrol), {
    businessKm: 14000,
    tier1Km: 14000,
    tier2Km: 0,
    amount: 16800,
  });
  // 14,000 x 1.20 + 1,000 x 0.37 = 16,800 + 370.
  expectEqual("15,000 km splits at 14,000", kmClaim(15_000, petrol), {
    businessKm: 15000,
    tier1Km: 14000,
    tier2Km: 1000,
    amount: 17170,
  });
  // 10.4 x 0.37 = 3.848 > 16,803.85.
  expectEqual("fractional km past the split", kmClaim(14_010.4, petrol), {
    businessKm: 14010.4,
    tier1Km: 14000,
    tier2Km: 10.4,
    amount: 16803.85,
  });
  expectEqual("no km", kmClaim(0, petrol).amount, 0);

  console.log("\nKm tiers on the vehicle's total km (IRD: business share of the first 14,000):");
  // Total 16,000 km, 3,000 business: Tier 1 = 3,000 x 14,000 / 16,000 = 2,625 km, Tier 2
  // = 375 km. 2,625 x 1.20 = 3,150 + 375 x 0.37 = 138.75 > 3,288.75.
  expectEqual("total 16,000, business 3,000", kmClaim(3000, petrol, 16_000), {
    businessKm: 3000,
    tier1Km: 2625,
    tier2Km: 375,
    amount: 3288.75,
  });
  // Total 12,000 never reaches 14,000: every business km stays Tier 1.
  expectEqual("total under 14,000 > all tier 1", kmClaim(3000, petrol, 12_000), {
    businessKm: 3000,
    tier1Km: 3000,
    tier2Km: 0,
    amount: 3600,
  });
  expectEqual("total null > first 14,000 business km", kmClaim(15_000, petrol, null), {
    businessKm: 15000,
    tier1Km: 14000,
    tier2Km: 1000,
    amount: 17170,
  });
  // A total below the business km is impossible, so it is ignored: 15,000 business km
  // splits at 14,000 as if no total were given.
  expectEqual("total below business km > treated as missing", kmClaim(15_000, petrol, 14_500), {
    businessKm: 15000,
    tier1Km: 14000,
    tier2Km: 1000,
    amount: 17170,
  });

  console.log(
    "\nKm-rate vehicle periods (van 1 Dec 2025 to its 20 Jun 2026 sale, car from 26 Aug):",
  );
  const register: AssetInput[] = [
    kmVehicle("van", "2025-12-01", "2026-06-20"),
    kmVehicle("car", "2026-08-26", null),
    { ...kmVehicle("pc", "2025-10-01", null), classKey: "computer", vehicleMethod: null },
  ];
  const periods = kmVehiclePeriods(register);
  expectEqual("one period per km vehicle, the PC skipped", periods, [
    { from: "2025-12-01T00:00:00.000Z", to: "2026-06-20T00:00:00.000Z" },
    { from: "2026-08-26T00:00:00.000Z", to: null },
  ]);
  // The in-service day counts; the sale day doesn't (the van is gone by then).
  expectEqual(
    "covered days: van start and last day, car start and later; not before, sale day or the gap",
    [
      "2025-11-30",
      "2025-12-01",
      "2026-06-19",
      "2026-06-20",
      "2026-07-15",
      "2026-08-26",
      "2027-03-31",
    ].map((d) => inKmVehiclePeriod(`${d}T00:00:00.000Z`, periods)),
    [false, true, true, false, false, true, true],
  );
  // NZST is UTC+12 in August: 11:30am UTC 25 Aug is 11:30pm NZ the day before the car,
  // 12:30pm UTC is 12:30am NZ on 26 Aug.
  expectEqual(
    "an instant counts on its NZ day",
    [
      inKmVehiclePeriod(new Date("2026-08-25T11:30:00.000Z"), periods),
      inKmVehiclePeriod(new Date("2026-08-25T12:30:00.000Z"), periods),
    ],
    [false, true],
  );
  // Claimable: 30 (van) + 40.5 + 0.1 + 0.2 (car) = 70.8. Outside: 10 (before the van)
  // + 25 (between the van's sale and the car) = 35.
  expectEqual(
    "trips split by period, float tails rounded",
    splitTripKm(
      [
        { date: "2025-11-15T00:00:00.000Z", km: 10 },
        { date: "2026-06-01T00:00:00.000Z", km: 30 },
        { date: "2026-07-15T00:00:00.000Z", km: 25 },
        { date: "2026-09-01T00:00:00.000Z", km: 40.5 },
        { date: "2026-09-02T00:00:00.000Z", km: 0.1 },
        { date: "2026-09-03T00:00:00.000Z", km: 0.2 },
      ],
      periods,
    ),
    { claimableKm: 70.8, outsideKm: 35 },
  );
  expectEqual(
    "no km-rate vehicle > every km outside",
    splitTripKm([{ date: "2026-06-01T00:00:00.000Z", km: 12.3 }], []),
    { claimableKm: 0, outsideKm: 12.3 },
  );

  console.log("\nHome office:");
  const office: TaxYearRecordInput = {
    officeSqm: 10,
    houseSqm: 120,
    sqmRate: 57.3,
    kmTier1: 1.2,
    kmTier2: 0.37,
    mortgageInterestOrRent: 12_000,
    rates: 3000,
  };
  const claim = homeOfficeClaim(office);
  // 10 x 57.30 = 573; 10/120 x (12,000 + 3,000) = 1,250; total 1,823.
  expectEqual(
    "10 m2 of 120 m2",
    [
      Math.round(claim.officePct * 10000) / 10000,
      claim.sqmPart,
      claim.proportionalPart,
      claim.amount,
    ],
    [0.0833, 573, 1250, 1823],
  );
  expectEqual(
    "no house area > no proportional part",
    homeOfficeClaim({ ...office, houseSqm: null }),
    { officePct: 0, sqmPart: 573, proportionalPart: 0, amount: 573 },
  );
  expectEqual("no office > nothing", homeOfficeClaim({ ...office, officeSqm: null }).amount, 0);
  // 9.5 x 57.30 = 544.35; 9.5/140 x 16,110 = 1,093.1786 > 1,093.18; total = the two parts.
  const odd = homeOfficeClaim({
    ...office,
    officeSqm: 9.5,
    houseSqm: 140,
    mortgageInterestOrRent: 13_333,
    rates: 2777,
  });
  expectEqual(
    "odd areas: the total is the sum of the rounded parts",
    [odd.sqmPart, odd.proportionalPart, odd.amount],
    [544.35, 1093.18, 1637.53],
  );
  expectEqual(
    "house area 0 > no proportional part",
    homeOfficeClaim({ ...office, houseSqm: 0 }).proportionalPart,
    0,
  );
}

/**
 * A km-rate vehicle for the period fixtures.
 * @param id - Asset id.
 * @param from - In-service day (YYYY-MM-DD).
 * @param sold - Disposal day (YYYY-MM-DD), or null while still held.
 * @returns The asset.
 */
function kmVehicle(id: string, from: string, sold: string | null): AssetInput {
  return {
    id,
    name: id,
    classKey: "vehicle",
    origin: "purchased",
    inServiceDate: `${from}T00:00:00.000Z`,
    costBase: 5000,
    supplier: "Turners",
    method: "DV",
    rate: 0.3,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: "km",
    disposedAt: sold === null ? null : `${sold}T00:00:00.000Z`,
    disposalAmount: sold === null ? null : 3000,
    expenseId: null,
  };
}

/** Runs the bracket and IETC fixtures. */
function checkIncomeTax(): void {
  console.log("\nIncome tax brackets (from 1 April 2025):");
  const b = DEFAULT_TAX_BRACKETS;
  expectEqual("0", incomeTaxOnBrackets(0, b), 0);
  expectEqual("negative", incomeTaxOnBrackets(-500, b), 0);
  expectEqual("10,000 (10.5%)", incomeTaxOnBrackets(10_000, b), 1050);
  // 15,600 x 0.105 = 1,638.
  expectEqual("15,600", incomeTaxOnBrackets(15_600, b), 1638);
  expectEqual("15,610 (next $10 at 17.5%)", incomeTaxOnBrackets(15_610, b), 1639.75);
  // + 37,900 x 0.175 = 6,632.50 > 8,270.50.
  expectEqual("53,500", incomeTaxOnBrackets(53_500, b), 8270.5);
  expectEqual("53,510 (next $10 at 30%)", incomeTaxOnBrackets(53_510, b), 8273.5);
  // + 24,600 x 0.30 = 7,380 > 15,650.50.
  expectEqual("78,100", incomeTaxOnBrackets(78_100, b), 15650.5);
  expectEqual("78,110 (next $10 at 33%)", incomeTaxOnBrackets(78_110, b), 15653.8);
  // + 101,900 x 0.33 = 33,627 > 49,277.50.
  expectEqual("180,000", incomeTaxOnBrackets(180_000, b), 49277.5);
  expectEqual("180,010 (next $10 at 39%)", incomeTaxOnBrackets(180_010, b), 49281.4);
  expectEqual("brackets given out of order", incomeTaxOnBrackets(53_500, [...b].reverse()), 8270.5);

  console.log("\nIETC ($520, $24k-$66k, 13c abatement to $70k):");
  const ietc = DEFAULT_IETC;
  expectEqual("23,999", independentEarnerCredit(23_999, ietc), 0);
  expectEqual("24,000", independentEarnerCredit(24_000, ietc), 520);
  expectEqual("66,000", independentEarnerCredit(66_000, ietc), 520);
  // 520 - 2,000 x 0.13 = 260.
  expectEqual("68,000", independentEarnerCredit(68_000, ietc), 260);
  expectEqual("70,000", independentEarnerCredit(70_000, ietc), 0);
  expectEqual("70,001", independentEarnerCredit(70_001, ietc), 0);
  expectEqual("disabled", independentEarnerCredit(30_000, { ...ietc, enabled: false }), 0);
}

/** Runs the set-aside target fixtures. */
function checkSetAside(): void {
  console.log("\nSet-aside targets (FY 2026-27):");
  // 9am 9 Oct 2026 NZDT. 9 Oct > 1 Apr 2027 = 174 days > 25 weeks; Oct-Mar = 6 months.
  const fy2627 = fy(2026);
  expectEqual("mid-year", setAsideTargets(2500, fy2627, new Date("2026-10-08T20:00:00.000Z")), {
    weeksLeft: 25,
    monthsLeft: 6,
    perWeek: 100,
    perMonth: 416.67,
  });
  expectEqual(
    "last day of the FY",
    setAsideTargets(2500, fy2627, new Date("2027-03-30T20:00:00.000Z")),
    {
      weeksLeft: 1,
      monthsLeft: 1,
      perWeek: 2500,
      perMonth: 2500,
    },
  );
  expectEqual(
    "past FY > one lump",
    setAsideTargets(2500, fy2627, new Date("2027-05-01T00:00:00.000Z")),
    {
      weeksLeft: 1,
      monthsLeft: 1,
      perWeek: 2500,
      perMonth: 2500,
    },
  );
  // FY 2027-28 not begun: 366 days (Feb 2028 is a leap month) > 53 weeks, 12 months.
  expectEqual(
    "future FY counts the whole year",
    setAsideTargets(1200, fy(2027), new Date("2026-10-08T20:00:00.000Z")),
    {
      weeksLeft: 53,
      monthsLeft: 12,
      perWeek: 22.64,
      perMonth: 100,
    },
  );
  expectEqual(
    "nothing owed",
    setAsideTargets(-50, fy2627, new Date("2026-10-08T20:00:00.000Z")).perWeek,
    0,
  );
}

const BUSINESS_START = new Date("2025-10-01T00:00:00.000Z");

/** FY 2025-26 through FY 2029-30, oldest first. */
const FYS: TaxFy[] = [2025, 2026, 2027, 2028, 2029].map(fy);

/**
 * An asset with sensible defaults, overridden per case.
 * @param overrides - Fields that differ from a $2,400 DV computer bought 15 Aug 2026.
 * @returns The asset.
 */
function asset(overrides: Partial<AssetInput>): AssetInput {
  return {
    id: "a",
    name: "Asset",
    classKey: "computer",
    origin: "purchased",
    inServiceDate: "2026-08-15T00:00:00.000Z",
    costBase: 2400,
    supplier: "PB Tech",
    method: "DV",
    rate: 0.5,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: null,
    disposedAt: null,
    disposalAmount: null,
    expenseId: null,
    ...overrides,
  };
}

/**
 * Runs a schedule with a fixed threshold and no filed years unless given.
 * @param a - The asset.
 * @param groupTotal - Its low-value group total (defaults to its own cost).
 * @param filed - Filed closing ATVs by FY key.
 * @returns The schedule rows.
 */
function schedule(
  a: AssetInput,
  groupTotal: number = a.costBase,
  filed: ReadonlyMap<string, number> = new Map(),
): AssetYearRow[] {
  return assetSchedule(a, FYS, {
    businessStart: BUSINESS_START,
    lowValueThreshold: 1000,
    groupTotal,
    filedClosingAtv: filed,
  });
}

/**
 * Compact view of schedule rows: [fyKey, months, opening, depreciation, closing].
 * @param rows - Schedule rows.
 * @returns One tuple per row.
 */
function brief(rows: AssetYearRow[]): Array<[string, number, number, number, number]> {
  return rows.map((r) => [r.fyKey, r.months, r.openingAtv, r.depreciation, r.closingAtv]);
}

/** Runs the depreciation schedule fixtures. */
function checkDepreciation(): void {
  console.log("\nDepreciation part years:");
  // 15 Aug 2026: Aug-Mar = 8 months. DV: 2400 x 0.5 x 8/12 = 800, then 1600 x 0.5 = 800.
  expectEqual("DV part year then full year", brief(schedule(asset({}))).slice(0, 2), [
    ["2026-27", 8, 2400, 800, 1600],
    ["2027-28", 12, 1600, 800, 800],
  ]);
  // SL: 2400 x 0.4 x 8/12 = 640, then 960, then 960 capped at the 800 left, then nothing.
  expectEqual(
    "SL part year, full years, floor at 0",
    brief(schedule(asset({ method: "SL", rate: 0.4 }))),
    [
      ["2026-27", 8, 2400, 640, 1760],
      ["2027-28", 12, 1760, 960, 800],
      ["2028-29", 12, 800, 800, 0],
      ["2029-30", 12, 0, 0, 0],
    ],
  );
  // Start month counts whole: 31 Mar 2027 is 1 month; 1 Apr 2026 is 12.
  expectEqual(
    "in service 31 March > 1 month",
    schedule(asset({ inServiceDate: "2027-03-31T00:00:00.000Z" }))[0]?.months,
    1,
  );
  expectEqual(
    "in service 1 April > 12 months",
    schedule(asset({ inServiceDate: "2026-04-01T00:00:00.000Z" }))[0]?.months,
    12,
  );

  console.log("\nBrought-in assets (business start 2025-10-01):");
  // In use privately since 2023, brought in at the business start: Oct-Mar = 6 months.
  // 1500 x 0.5 x 6/12 = 375; then 1125 x 0.5 = 562.5.
  const broughtIn = asset({
    id: "pc",
    origin: "introduced",
    supplier: null,
    costBase: 1500,
    inServiceDate: "2023-05-01T00:00:00.000Z",
  });
  expectEqual(
    "FY 2025-26 counts 6 months from the business start",
    brief(schedule(broughtIn)).slice(0, 2),
    [
      ["2025-26", 6, 1500, 375, 1125],
      ["2026-27", 12, 1125, 562.5, 562.5],
    ],
  );
  // A brought-in $600 phone is under $1,000 but is depreciated, not written off:
  // 600 x 0.67 x 6/12 = 201.
  const phone = asset({
    id: "phone",
    origin: "introduced",
    supplier: null,
    costBase: 600,
    rate: 0.67,
    inServiceDate: "2025-10-01T00:00:00.000Z",
  });
  const phoneRow = schedule(phone, lowValueGroupTotals([phone]).get("phone"))[0];
  expectEqual(
    "introduced item under $1,000 > depreciated, not written off",
    [phoneRow?.writtenOff, phoneRow?.depreciation, phoneRow?.closingAtv],
    [false, 201, 399],
  );
  expectEqual(
    "introduced asset never gets Investment Boost",
    schedule({ ...broughtIn, investmentBoost: true })[0]?.investmentBoost,
    0,
  );
  // First used 1 May 2025, before Investment Boost began on 22 May 2025. Depreciation
  // starts at the 1 Oct 2025 business start, but the first-use date decides the boost:
  // none. Oct-Mar = 6 months: 3000 x 0.5 x 6/12 = 750.
  const preBoost = schedule(
    asset({ costBase: 3000, investmentBoost: true, inServiceDate: "2025-05-01T00:00:00.000Z" }),
  )[0];
  expectEqual(
    "purchased asset first used before 22 May 2025 > no boost, even with a later business start",
    [preBoost?.fyKey, preBoost?.months, preBoost?.investmentBoost, preBoost?.depreciation],
    ["2025-26", 6, 0, 750],
  );

  console.log("\nLow-value grouping (threshold $1,000):");
  const sameDay = "2025-11-13T00:00:00.000Z";
  const group = [
    asset({ id: "psu", supplier: "PB Tech", costBase: 600, inServiceDate: sameDay }),
    asset({ id: "ssd", supplier: " pb tech ", costBase: 500, inServiceDate: sameDay }),
    asset({ id: "aio", supplier: "Computer Lounge", costBase: 300, inServiceDate: sameDay }),
    asset({ id: "kb", supplier: "Computer Lounge", costBase: 400, inServiceDate: sameDay }),
    asset({
      id: "dock",
      supplier: "PB Tech",
      costBase: 200,
      inServiceDate: "2025-11-14T00:00:00.000Z",
    }),
    asset({
      id: "chair",
      classKey: "furniture-chair",
      supplier: "PB Tech",
      costBase: 150,
      rate: 0.16,
      inServiceDate: sameDay,
    }),
    asset({ id: "cable", supplier: null, costBase: 90, inServiceDate: sameDay }),
    asset({
      id: "gift",
      origin: "introduced",
      supplier: null,
      costBase: 700,
      inServiceDate: sameDay,
    }),
  ];
  const totals = lowValueGroupTotals(group);
  expectEqual(
    "group totals (same supplier ignoring case/spaces, same day, same class)",
    group.map((a) => [a.id, totals.get(a.id)]),
    [
      ["psu", 1100],
      ["ssd", 1100],
      ["aio", 700],
      ["kb", 700],
      ["dock", 200],
      ["chair", 150],
      ["cable", 90],
      ["gift", 700],
    ],
  );
  // $1,100 together > threshold: depreciated. Nov-Mar = 5 months: 600 x 0.5 x 5/12 = 125.
  const psu = schedule(group[0]!, totals.get("psu"))[0];
  expectEqual(
    "$600 + $500 same supplier same day > not written off",
    [psu?.writtenOff, psu?.depreciation],
    [false, 125],
  );
  // 500 x 0.5 x 5/12 = 104.1666 > 104.17.
  expectEqual(
    "its partner depreciates too",
    schedule(group[1]!, totals.get("ssd"))[0]?.depreciation,
    104.17,
  );
  // $700 together <= threshold: written off in full in the year bought, nothing after.
  const aio = schedule(group[2]!, totals.get("aio"));
  expectEqual("$300 + $400 same supplier same day > written off", brief(aio).slice(0, 2), [
    ["2025-26", 5, 300, 300, 0],
    ["2026-27", 12, 0, 0, 0],
  ]);
  expectEqual("flagged as a write-off", aio[0]?.writtenOff, true);
  const aioHalf = schedule({ ...group[2]!, businessUsePct: 50 }, totals.get("aio"))[0];
  expectEqual(
    "written off at 50% business: full write-off off the ATV, half deducted",
    [aioHalf?.depreciation, aioHalf?.deductible, aioHalf?.closingAtv],
    [300, 150, 0],
  );
  expectEqual(
    "brought-in $700 > not written off",
    schedule(group[7]!, totals.get("gift"))[0]?.writtenOff,
    false,
  );
  // Same class, supplier and day but one DV at 50% and one SL at 40%: still one purchase.
  // 600 + 500 = 1,100 > threshold, so neither is written off.
  const mixed = [
    asset({ id: "dv", supplier: "Noel Leeming", costBase: 600, inServiceDate: sameDay }),
    asset({
      id: "sl",
      supplier: "Noel Leeming",
      costBase: 500,
      method: "SL",
      rate: 0.4,
      inServiceDate: sameDay,
    }),
  ];
  const mixedTotals = lowValueGroupTotals(mixed);
  expectEqual(
    "same class, one DV one SL > grouped at $1,100, neither written off",
    [
      mixedTotals.get("dv"),
      mixedTotals.get("sl"),
      schedule(mixed[0]!, mixedTotals.get("dv"))[0]?.writtenOff,
      schedule(mixed[1]!, mixedTotals.get("sl"))[0]?.writtenOff,
    ],
    [1100, 1100, false, false],
  );

  console.log("\nInvestment Boost:");
  // $3,000 laptop, 10 Jun 2026 (Jun-Mar = 10 months). Boost 600; normal on 2400:
  // 2400 x 0.5 x 10/12 = 1000. Year one = 1600; then 1400 x 0.5 = 700.
  const laptop = asset({
    id: "laptop",
    costBase: 3000,
    investmentBoost: true,
    inServiceDate: "2026-06-10T00:00:00.000Z",
  });
  const boosted = schedule(laptop);
  expectEqual("DV year one: 20% plus normal on 80%", brief(boosted).slice(0, 2), [
    ["2026-27", 10, 3000, 1600, 1400],
    ["2027-28", 12, 1400, 700, 700],
  ]);
  expectEqual(
    "boost portion recorded in year one only",
    boosted.slice(0, 2).map((r) => r.investmentBoost),
    [600, 0],
  );
  // SL on the 80%: 2400 x 0.4 x 10/12 = 800 (+600 boost); then 960; then 640 left.
  expectEqual(
    "SL year one then SL on the 80% base",
    brief(schedule({ ...laptop, method: "SL", rate: 0.4 })).slice(0, 3),
    [
      ["2026-27", 10, 3000, 1400, 1600],
      ["2027-28", 12, 1600, 960, 640],
      ["2028-29", 12, 640, 640, 0],
    ],
  );
  // At 80% business: 1600 x 0.8 = 1280 deductible, the ATV still drops by 1600.
  const boosted80 = schedule({ ...laptop, businessUsePct: 80 })[0];
  expectEqual(
    "boost year at 80% business",
    [boosted80?.deductible, boosted80?.closingAtv],
    [1280, 1400],
  );

  console.log("\nBusiness-use split:");
  // 60%: depreciation 800 in full off the ATV, 480 deductible.
  const shared = schedule(asset({ businessUsePct: 60 }))[0];
  expectEqual(
    "60% business: full drop in ATV, business share deducted",
    [shared?.depreciation, shared?.deductible, shared?.closingAtv],
    [800, 480, 1600],
  );

  console.log("\nDisposals:");
  // 2026-27: 800 depreciation (ATV 1600). Sold 1 Sep 2027 for 2000 at 80% business:
  // gain 400, claimed to date 800, recovery min(400, 800) x 0.8 = 320. No 2027-28 depreciation.
  const sold = schedule(
    asset({ businessUsePct: 80, disposedAt: "2027-09-01T00:00:00.000Z", disposalAmount: 2000 }),
  );
  expectEqual(
    "gain: recovery is business share, no depreciation in the disposal year, rows stop",
    sold.map((r) => [
      r.fyKey,
      r.months,
      r.depreciation,
      r.deductible,
      r.closingAtv,
      r.recoveryIncome,
      r.lossOnDisposal,
      r.disposed,
    ]),
    [
      ["2026-27", 8, 800, 640, 1600, 0, 0, false],
      ["2027-28", 0, 0, 0, 0, 320, 0, true],
    ],
  );
  // Sold above cost for 3000 at 100%: gain 1400 capped at the 800 claimed.
  expectEqual(
    "gain above cost: recovery capped at depreciation claimed",
    schedule(asset({ disposedAt: "2027-09-01T00:00:00.000Z", disposalAmount: 3000 }))[1]
      ?.recoveryIncome,
    800,
  );
  // Sold for 1000 against ATV 1600: loss 600, or 300 at 50% business.
  expectEqual(
    "loss: ATV less sale",
    schedule(asset({ disposedAt: "2027-09-01T00:00:00.000Z", disposalAmount: 1000 }))[1]
      ?.lossOnDisposal,
    600,
  );
  expectEqual(
    "loss at 50% business",
    schedule(
      asset({ businessUsePct: 50, disposedAt: "2027-09-01T00:00:00.000Z", disposalAmount: 1000 }),
    )[1]?.lossOnDisposal,
    300,
  );
  // Disposed in the year bought: no depreciation and no write-off, loss = cost - sale.
  const quick = schedule(
    asset({ costBase: 500, disposedAt: "2026-12-01T00:00:00.000Z", disposalAmount: 100 }),
    500,
  );
  expectEqual(
    "bought and sold in the same FY",
    quick.map((r) => [r.depreciation, r.writtenOff, r.lossOnDisposal, r.disposed]),
    [[0, false, 400, true]],
  );

  console.log("\nKm-rate vehicle:");
  const car = asset({
    id: "car",
    classKey: "vehicle",
    costBase: 4500,
    rate: 0.3,
    supplier: "Kevin",
    vehicleMethod: "km",
    inServiceDate: "2026-08-26T00:00:00.000Z",
  });
  expectEqual("never depreciated, ATV stays at cost", brief(schedule(car)).slice(0, 2), [
    ["2026-27", 8, 4500, 0, 4500],
    ["2027-28", 12, 4500, 0, 4500],
  ]);
  const cheapCar = { ...car, costBase: 900 };
  expectEqual(
    "never written off, even under $1,000",
    schedule(cheapCar, lowValueGroupTotals([cheapCar]).get("car"))[0]?.writtenOff,
    false,
  );
  expectEqual(
    "no recovery when sold",
    schedule({ ...car, disposedAt: "2027-06-01T00:00:00.000Z", disposalAmount: 6000 })[1]
      ?.recoveryIncome,
    0,
  );

  console.log("\nFiled snapshot carry-forward:");
  // 13 Nov 2025: Nov-Mar = 5 months, 2400 x 0.5 x 5/12 = 500, closing 1900. The filed
  // FY 2025-26 snapshot says 2000, so FY 2026-27 opens at 2000 and depreciates 1000.
  const filedAsset = asset({ inServiceDate: "2025-11-13T00:00:00.000Z" });
  expectEqual("computed without a snapshot", brief(schedule(filedAsset)).slice(0, 2), [
    ["2025-26", 5, 2400, 500, 1900],
    ["2026-27", 12, 1900, 950, 950],
  ]);
  expectEqual(
    "filed closing ATV overrides the next opening",
    brief(schedule(filedAsset, 2400, new Map([["2025-26", 2000]]))).slice(0, 2),
    [
      ["2025-26", 5, 2400, 500, 1900],
      ["2026-27", 12, 2000, 1000, 1000],
    ],
  );
}

/**
 * An expense row on both GST bases.
 * @param id - Row id.
 * @param date - Ledger date (YYYY-MM-DD).
 * @param category - Expense category.
 * @param amountIncl - GST-inclusive amount.
 * @param amountExcl - GST-exclusive amount.
 * @returns The row.
 */
function expense(
  id: string,
  date: string,
  category: string,
  amountIncl: number,
  amountExcl: number,
): LedgerExpense {
  return {
    id,
    date: `${date}T00:00:00.000Z`,
    category,
    amountIncl,
    amountExcl,
    supplier: "",
    description: id,
  };
}

/** Runs the end-to-end FY 2026-27 estimate. */
function checkTaxYear(): void {
  console.log("\ncomputeTaxYear, FY 2026-27 (not GST registered):");
  const now = new Date("2026-10-08T20:00:00.000Z");
  const fy2627 = toTaxFy(
    getFinancialYear(new Date("2026-06-01T00:00:00.000Z"), now, BUSINESS_START),
  );
  expectEqual(
    "toTaxFy",
    [fy2627.key, fy2627.start.toISOString(), fy2627.end.toISOString(), fy2627.current],
    ["2026-27", "2026-04-01T00:00:00.000Z", "2027-04-01T00:00:00.000Z", true],
  );

  const settings: TaxRulesSettings = {
    brackets: [...DEFAULT_TAX_BRACKETS],
    ietc: DEFAULT_IETC,
    acc: 0.0175,
    kiwiSaver: 0.03,
    lowValueThreshold: 1000,
    provisionalThreshold: 5000,
    vehicleFuel: "petrol",
    categoryBusinessUse: { "Phone/Internet": 50 },
  };
  const input: TaxYearInput = {
    fy: fy2627,
    businessStart: BUSINESS_START,
    // 1,000 + 15,000 + 14,000 = 30,000 in the window; the 31 Mar 2026 and
    // 1 Apr 2027 rows fall outside it.
    income: [
      { date: "2026-03-31T00:00:00.000Z", amount: 500 },
      { date: "2026-04-01T00:00:00.000Z", amount: 1000 },
      { date: "2026-08-10T00:00:00.000Z", amount: 15_000 },
      { date: "2027-02-15T00:00:00.000Z", amount: 14_000 },
      { date: "2027-04-01T00:00:00.000Z", amount: 700 },
    ],
    expenses: [
      expense("fuel-early", "2026-05-10", "Fuel", 69, 60),
      expense("fuel", "2026-10-05", "Fuel", 115, 100),
      expense("car", "2026-08-26", "Other", 4500, 3913.04),
      expense("subs", "2026-06-01", "Subscriptions", 230, 200),
      expense("phone", "2026-07-01", "Phone/Internet", 1200, 1043.48),
      expense("paper", "2026-09-15", "Office supplies", 57.5, 50),
      expense("meter", "2026-11-20", "Tools", 345, 300),
      expense("before", "2026-03-30", "Tools", 100, 86.96),
      expense("after", "2027-04-02", "Tools", 999, 868.7),
    ],
    assets: [
      asset({
        id: "car",
        name: "Car",
        classKey: "vehicle",
        costBase: 4500,
        rate: 0.3,
        supplier: "Kevin",
        vehicleMethod: "km",
        inServiceDate: "2026-08-26T00:00:00.000Z",
        expenseId: "car",
      }),
      asset({
        id: "pc",
        name: "PC and monitors",
        origin: "introduced",
        supplier: null,
        costBase: 1500,
        inServiceDate: "2025-10-01T00:00:00.000Z",
      }),
      asset({
        id: "meter",
        name: "Multimeter",
        classKey: "test-equipment",
        costBase: 345,
        rate: 0.25,
        supplier: "Jaycar",
        inServiceDate: "2026-11-20T00:00:00.000Z",
        expenseId: "meter",
      }),
      asset({
        id: "laptop",
        name: "Laptop",
        costBase: 2000,
        investmentBoost: true,
        businessUsePct: 80,
        inServiceDate: "2026-06-10T00:00:00.000Z",
      }),
      asset({
        id: "oldphone",
        name: "Old phone",
        classKey: "phone",
        origin: "introduced",
        supplier: null,
        costBase: 400,
        rate: 0.67,
        inServiceDate: "2025-10-01T00:00:00.000Z",
        disposedAt: "2026-09-01T00:00:00.000Z",
        disposalAmount: 250,
      }),
    ],
    // 25 + 40.5 + 120 + 39.5 = 225 km in the window. The 15 Jul trip is before the car
    // went into service on 26 Aug, so only 200 km earn the km rate.
    trips: [
      { date: "2026-03-31T00:00:00.000Z", km: 100 },
      { date: "2026-07-15T00:00:00.000Z", km: 25 },
      { date: "2026-09-01T00:00:00.000Z", km: 40.5 },
      { date: "2026-12-01T00:00:00.000Z", km: 120 },
      { date: "2027-03-31T00:00:00.000Z", km: 39.5 },
      { date: "2027-04-01T00:00:00.000Z", km: 50 },
    ],
    year: {
      officeSqm: 10,
      houseSqm: 120,
      sqmRate: 57.3,
      kmTier1: 1.2,
      kmTier2: 0.37,
      mortgageInterestOrRent: 12_000,
      rates: 3000,
    },
    settings,
    gst: UNREGISTERED,
    // FY 2025-26 filed with the PC at 1,200 (computed would be 1,125) and the phone at 266.
    filedClosingAtv: new Map([
      [
        "2025-26",
        new Map([
          ["pc", 1200],
          ["oldphone", 266],
        ]),
      ],
    ]),
    now,
  };
  const r = computeTaxYear(input);

  // Expenses: fuel-early 69 (10 May, before the car) + subs 230 + phone 1,200 x 50% +
  // paper 57.50 = 956.50 (inclusive amounts). Fuel 115 (5 Oct, car on km rates) out;
  // car 4,500 + meter 345 out (linked to assets).
  expectEqual("income in the window", r.income, 30_000);
  expectEqual(
    "expenses / excluded fuel / excluded asset-linked",
    [r.deductions.expenses, r.deductions.excludedFuel, r.deductions.excludedAssetLinked],
    [956.5, 115, 4845],
  );
  // PC opens at the filed 1,200: 600. Laptop: boost 400, normal 1600 x 0.5 x 10/12 =
  // 666.67, total 1,066.67 x 80% = 853.34, of which boost 320 and depreciation 533.34.
  // Depreciation 600 + 533.34 = 1,133.34. Meter: 345 written off (Jaycar group of one).
  // Old phone: disposed 1 Sep 2026 for 250 against the filed 266 > loss 16.
  expectEqual(
    "depreciation / low-value / boost / loss on disposal",
    [
      r.deductions.depreciation,
      r.deductions.lowValueWriteOffs,
      r.deductions.investmentBoost,
      r.deductions.lossOnDisposal,
    ],
    [1133.34, 345, 320, 16],
  );
  expectEqual(
    "asset rows this FY",
    r.assets.map((a) => [a.assetId, a.openingAtv, a.depreciation, a.deductible, a.closingAtv]),
    [
      ["car", 4500, 0, 0, 4500],
      ["pc", 1200, 600, 600, 600],
      ["meter", 345, 345, 345, 0],
      ["laptop", 2000, 1066.67, 853.34, 933.33],
      ["oldphone", 266, 0, 0, 0],
    ],
  );
  // 200 km x 1.20 = 240; the 25 km before the car is reported, not claimed.
  // Home office 1,823 as above.
  expectEqual("km claim", r.km, { businessKm: 200, tier1Km: 200, tier2Km: 0, amount: 240 });
  expectEqual("km before the car", r.deductions.unclaimedKm, 25);
  expectEqual("home office", r.homeOffice.amount, 1823);
  // 956.50 + 1,133.34 + 345 + 320 + 240 + 1,823 + 16 = 4,833.84.
  expectEqual("total deductions", r.deductions.total, 4833.84);
  expectEqual(
    "breakdown lines",
    r.deductions.lines.map((l) => [l.key, l.amount]),
    [
      ["expenses", 956.5],
      ["depreciation", 1133.34],
      ["low-value", 345],
      ["investment-boost", 320],
      ["km", 240],
      ["home-office", 1823],
      ["loss-on-disposal", 16],
    ],
  );
  // The Tax page renders `lines` as the counted deductions, so they must add up to the total
  // and carry no excluded rows.
  expectEqual(
    "lines add up to the total",
    roundCents(r.deductions.lines.reduce((s, l) => s + l.amount, 0)),
    r.deductions.total,
  );
  // Profit 30,000 - 4,833.84 = 25,166.16. Tax 1,638 + 9,566.16 x 0.175 = 1,638 + 1,674.078
  // = 3,312.08. IETC 520 (in the full band). Residual 2,792.08. ACC 25,166.16 x 0.0175 =
  // 440.4078 > 440.41. KiwiSaver x 0.03 = 754.9848 > 754.98. Set aside 2,792.08 + 440.41
  // = 3,232.49.
  expectEqual(
    "profit / taxable / tax / IETC / residual",
    [r.profit, r.taxable, r.incomeTax, r.ietc, r.residualIncomeTax],
    [25166.16, 25166.16, 3312.08, 520, 2792.08],
  );
  expectEqual(
    "ACC / KiwiSaver / set aside / provisional warning",
    [r.acc, r.kiwiSaver, r.totalToSetAside, r.provisionalWarning],
    [440.41, 754.98, 3232.49, false],
  );
  // Box 52 = 1,133.34 + 345 + 320. Box 54 = car 4,500 + meter 345 + laptop 2,000.
  expectEqual("IR3 / IR10 figures", r.ir, {
    ir3NetIncome: 25166.16,
    ir10Box52Depreciation: 1798.34,
    ir10Box54Additions: 6845,
    ir10Box55Disposals: 250,
    ir10Box59LossOnDisposal: 16,
    ir10Box60BoostValue: 2000,
  });

  console.log("\ncomputeTaxYear variants:");
  // No km-rate car on the register: Fuel 115 and the unlinked car 4,500 come back in
  // (956.50 + 115 + 4,500 = 5,571.50), and none of the 225 km earns the rate.
  const noCar = computeTaxYear({ ...input, assets: input.assets.filter((a) => a.id !== "car") });
  expectEqual(
    "without the km vehicle, Fuel and the car purchase are deducted and no km is claimed",
    [
      noCar.deductions.expenses,
      noCar.deductions.excludedFuel,
      noCar.deductions.excludedAssetLinked,
      noCar.km.amount,
      noCar.deductions.unclaimedKm,
    ],
    [5571.5, 0, 345, 0, 225],
  );
  // A km-rate van held 1 Dec 2025 until its sale on 20 Jun 2026 covers its own days only.
  // fuel-early (10 May) is now inside the van's period: out. A 1 Jul fill-up falls between
  // the sale and the car: deducted. Expenses 887.50 + 46 = 933.50; excluded fuel 69 + 115
  // = 184. A 30 km van trip on 1 Jun earns the rate: 230 km x 1.20 = 276. The 15 Jul trip
  // is still in the gap: 25 km unclaimed.
  const withVan = computeTaxYear({
    ...input,
    assets: [
      ...input.assets,
      asset({
        id: "van",
        name: "Van",
        classKey: "vehicle",
        costBase: 6000,
        rate: 0.3,
        supplier: "Turners",
        vehicleMethod: "km",
        inServiceDate: "2025-12-01T00:00:00.000Z",
        disposedAt: "2026-06-20T00:00:00.000Z",
        disposalAmount: 3500,
      }),
    ],
    expenses: [...input.expenses, expense("fuel-gap", "2026-07-01", "Fuel", 46, 40)],
    trips: [...input.trips, { date: "2026-06-01T00:00:00.000Z", km: 30 }],
  });
  expectEqual(
    "an earlier km van: its fuel out, fuel after its sale in, its trips claimed",
    [
      withVan.deductions.expenses,
      withVan.deductions.excludedFuel,
      withVan.km.businessKm,
      withVan.km.amount,
      withVan.deductions.unclaimedKm,
    ],
    [933.5, 184, 230, 276, 25],
  );
  // Registered from 1 Sep 2026: paper (15 Sep) moves to excl, 57.50 > 50, so expenses are
  // 69 + 230 + 600 + 50 = 949. The 5 Oct Fuel row is reported at its excl 100.
  const registered = computeTaxYear({
    ...input,
    gst: { registered: true, registeredFrom: "2026-09-01T00:00:00.000Z" },
  });
  expectEqual(
    "registered from 1 Sep: later rows count excl",
    [registered.deductions.expenses, registered.deductions.excludedFuel],
    [949, 100],
  );
  // Income from 1 Sep counts GST-exclusive too: only the 15 Feb 14,000 row is in the
  // registered period. 14,000 / 1.15 = 12,173.913 > 12,173.91 (3/23 of 14,000 = 1,826.09
  // comes off). Income 1,000 + 15,000 + 12,173.91 = 28,173.91. Deductions 4,833.84 - 956.50
  // + 949 = 4,826.34, so profit 28,173.91 - 4,826.34 = 23,347.57.
  expectEqual(
    "registered from 1 Sep: later income counts excl",
    [registered.income, registered.profit, registered.ir.ir3NetIncome],
    [28173.91, 23347.57, 23347.57],
  );
  // Registered from 1 May 2027, after FY 2026-27 ends: no day of the FY is registered, so
  // every figure stays GST-inclusive and the Expenses note says so.
  const laterReg = computeTaxYear({
    ...input,
    gst: { registered: true, registeredFrom: "2027-05-01T00:00:00.000Z" },
  });
  const notes = [laterReg, registered].map(
    (res) => res.deductions.lines.find((l) => l.key === "expenses")?.note,
  );
  expectEqual(
    "registered after the FY ends > incl note and figures; registered mid-FY > excl note",
    [...notes, laterReg.income, laterReg.deductions.expenses],
    ["GST-inclusive", "GST-exclusive from the registration date", 30_000, 956.5],
  );
  // The car's total 20,000 km for the year passes through: 200 business km x 14,000 /
  // 20,000 = 140 km at Tier 1, 60 km at Tier 2. 140 x 1.20 = 168 + 60 x 0.37 = 22.20 > 190.20.
  const highKm = computeTaxYear({ ...input, year: { ...input.year, totalVehicleKm: 20_000 } });
  expectEqual("total vehicle km reaches the km claim", highKm.km, {
    businessKm: 200,
    tier1Km: 140,
    tier2Km: 60,
    amount: 190.2,
  });
  // A loss year: nothing to pay.
  const lossYear = computeTaxYear({ ...input, income: [] });
  expectEqual(
    "no income > negative profit, zero tax",
    [lossYear.profit, lossYear.taxable, lossYear.incomeTax, lossYear.totalToSetAside],
    [-4833.84, 0, 0, 0],
  );
  // 100,000 income: profit 95,166.16, tax 15,650.50 + 17,066.16 x 0.33 = 15,650.50 +
  // 5,631.8328 = 21,282.33.
  const bigYear = computeTaxYear({
    ...input,
    income: [{ date: "2026-06-01T00:00:00.000Z", amount: 100_000 }],
  });
  expectEqual(
    "over the provisional threshold",
    [bigYear.incomeTax, bigYear.ietc, bigYear.provisionalWarning],
    [21282.33, 0, true],
  );
}

/** Register for the snapshot fixtures: two assets in FY 2025-26 and the car from 2026-27. */
const SNAPSHOT_ASSETS: AssetInput[] = [
  {
    id: "a2",
    name: "=Desk, oak",
    classKey: "fixture-desk",
    origin: "introduced",
    inServiceDate: "2025-10-01T00:00:00.000Z",
    costBase: 400,
    supplier: null,
    method: "SL",
    rate: 0.085,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: null,
    disposedAt: null,
    disposalAmount: null,
    expenseId: null,
  },
  {
    id: "a1",
    name: 'Laptop, "Pro" 14in',
    classKey: "fixture-laptop",
    origin: "introduced",
    inServiceDate: "2025-10-01T00:00:00.000Z",
    costBase: 2500,
    supplier: null,
    method: "DV",
    rate: 0.5,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: null,
    disposedAt: null,
    disposalAmount: null,
    expenseId: null,
  },
  {
    id: "car",
    name: "Car",
    classKey: "fixture-car",
    origin: "purchased",
    inServiceDate: "2026-08-26T00:00:00.000Z",
    costBase: 4500,
    supplier: "Kevin",
    method: "DV",
    rate: 0.3,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: "km",
    disposedAt: null,
    disposalAmount: null,
    expenseId: null,
  },
];

/**
 * Hand-built FY 2025-26 result. It only has to be internally consistent: these fixtures
 * test storage, comparison and export, not the tax maths (the fixtures above cover that).
 */
const SNAPSHOT_RESULT: TaxYearResult = {
  fyKey: "2025-26",
  income: 4207.5,
  recoveryIncome: 0,
  deductions: {
    expenses: 560.63,
    excludedFuel: 0,
    excludedAssetLinked: 0,
    unclaimedKm: 0,
    depreciation: 642,
    lowValueWriteOffs: 0,
    investmentBoost: 0,
    km: 51,
    homeOffice: 0,
    lossOnDisposal: 0,
    total: 1253.63,
    lines: [
      { key: "expenses", label: "Expenses", amount: 560.63 },
      {
        key: "depreciation",
        label: "Depreciation",
        amount: 642,
        note: 'Laptop, "Pro" 14in and desk',
      },
      { key: "km", label: "Vehicle km claim", amount: 51 },
    ],
  },
  profit: 2953.87,
  taxable: 2953.87,
  incomeTax: 310.16,
  ietc: 0,
  residualIncomeTax: 310.16,
  acc: 49.33,
  kiwiSaver: 354.46,
  totalToSetAside: 359.49,
  provisionalWarning: false,
  assets: [
    {
      assetId: "a1",
      fyKey: "2025-26",
      months: 6,
      openingAtv: 2500,
      depreciation: 625,
      investmentBoost: 0,
      writtenOff: false,
      deductible: 625,
      closingAtv: 1875,
      recoveryIncome: 0,
      lossOnDisposal: 0,
      disposed: false,
    },
    {
      assetId: "a2",
      fyKey: "2025-26",
      months: 6,
      openingAtv: 400,
      depreciation: 17,
      investmentBoost: 0,
      writtenOff: false,
      deductible: 17,
      closingAtv: 383,
      recoveryIncome: 0,
      lossOnDisposal: 0,
      disposed: false,
    },
  ],
  km: { businessKm: 42.5, tier1Km: 42.5, tier2Km: 0, amount: 51 },
  homeOffice: { officePct: 0, sqmPart: 0, proportionalPart: 0, amount: 0 },
  ir: {
    ir3NetIncome: 2953.87,
    ir10Box52Depreciation: 642,
    ir10Box54Additions: 2900,
    ir10Box55Disposals: 0,
    ir10Box59LossOnDisposal: 0,
    ir10Box60BoostValue: 0,
  },
};

/** FY 2025-26 as a filed year, for the edit-warning cases. */
const FILED_2025: FiledYearRef = {
  fyKey: "2025-26",
  label: "FY 2025-26 (partial)",
  startIso: "2025-04-01T00:00:00.000Z",
  endIso: "2026-04-01T00:00:00.000Z",
  filedAtIso: "2026-06-30T13:00:00.000Z",
};

/**
 * Filed-year snapshot fixtures: build, JSON round trip, closing-value carry-forward,
 * comparison with a live recompute, and which filed years an edit reaches.
 */
function checkSnapshots(): void {
  console.log("\nFiled-year snapshots:");
  const trips = [
    { date: "2026-02-10T00:00:00.000Z", km: 12.5, purpose: "Client visit, Ponsonby" },
    { date: "2025-11-03T00:00:00.000Z", km: 30, purpose: "-Parts run" },
  ];
  const built = buildTaxYearSnapshot({
    result: SNAPSHOT_RESULT,
    assets: SNAPSHOT_ASSETS,
    trips,
    totalVehicleKm: 9000,
    filedAt: FILED_2025.filedAtIso,
  });
  expectEqual(
    "keeps only assets with a row this year, oldest in service first",
    built.assets.map((a) => a.id),
    ["a1", "a2"],
  );
  expectEqual(
    "unknown class key falls back to the key",
    built.assets[1]?.classLabel,
    "fixture-desk",
  );
  expectEqual(
    "trips oldest first",
    built.trips.map((t) => t.date),
    ["2025-11-03T00:00:00.000Z", "2026-02-10T00:00:00.000Z"],
  );
  expectEqual("closing values per asset", built.closingAtv, { a1: 1875, a2: 383 });
  expectEqual("total vehicle km kept", built.totalVehicleKm, 9000);

  // Round trip through the same JSON the Mongo document stores.
  const stored: unknown = JSON.parse(JSON.stringify(built));
  const parsed = parseTaxYearSnapshot(stored);
  expectEqual("round trip parses", parsed !== null, true);
  expectEqual("round trip is lossless", JSON.stringify(parsed), JSON.stringify(built));
  expectEqual(
    "closing values read back",
    parsed ? [...closingAtvFromSnapshot(parsed).entries()] : null,
    [
      ["a1", 1875],
      ["a2", 383],
    ],
  );
  expectEqual("null snapshot rejected", parseTaxYearSnapshot(null), null);
  expectEqual("other version rejected", parseTaxYearSnapshot({ ...built, version: 2 }), null);
  expectEqual("bare TaxYearResult rejected", parseTaxYearSnapshot(SNAPSHOT_RESULT), null);

  // Damaged version-1 documents: anything the Tax page or the CSV would trip over is rejected.
  expectEqual(
    "thin v1 snapshot rejected",
    parseTaxYearSnapshot({
      version: 1,
      filedAt: null,
      result: { fyKey: "2025-26", assets: [] },
      assets: [],
      trips: [],
      closingAtv: {},
    }),
    null,
  );
  expectEqual(
    "unparseable filedAt rejected",
    parseTaxYearSnapshot({ ...built, filedAt: "garbage" }),
    null,
  );
  expectEqual(
    "trip with non-number km rejected",
    parseTaxYearSnapshot({
      ...built,
      trips: [{ date: "2025-11-03T00:00:00.000Z", km: "30", purpose: "Parts run" }],
    }),
    null,
  );
  expectEqual(
    "trip with unparseable date rejected",
    parseTaxYearSnapshot({ ...built, trips: [{ date: "31/02/2026", km: 30, purpose: "x" }] }),
    null,
  );
  expectEqual(
    "asset with unparseable in-service date rejected",
    parseTaxYearSnapshot({
      ...built,
      assets: built.assets.map((a, i) => (i === 0 ? { ...a, inServiceDate: "soon" } : a)),
    }),
    null,
  );
  expectEqual(
    "deduction line without an amount rejected",
    parseTaxYearSnapshot({
      ...built,
      result: {
        ...built.result,
        deductions: { ...built.result.deductions, lines: [{ key: "x", label: "X" }] },
      },
    }),
    null,
  );
  expectEqual(
    "missing IR figures rejected",
    parseTaxYearSnapshot({ ...built, result: { ...built.result, ir: undefined } }),
    null,
  );
  expectEqual(
    "non-finite schedule figure rejected",
    parseTaxYearSnapshot(
      JSON.parse(JSON.stringify(built).replace('"closingAtv":1875', '"closingAtv":null')),
    ),
    null,
  );
  expectEqual(
    "non-number closing value rejected",
    parseTaxYearSnapshot({ ...built, closingAtv: { a1: "1875" } }),
    null,
  );
  expectEqual(
    "valid snapshot still round-trips",
    JSON.stringify(parseTaxYearSnapshot(JSON.parse(JSON.stringify(built)))),
    JSON.stringify(built),
  );

  // Total km not entered: stored as null, and a missing field reads back as null too.
  const noTotalKm = buildTaxYearSnapshot({
    result: SNAPSHOT_RESULT,
    assets: SNAPSHOT_ASSETS,
    trips,
    totalVehicleKm: null,
    filedAt: null,
  });
  const noTotalKmParsed = parseTaxYearSnapshot(JSON.parse(JSON.stringify(noTotalKm)));
  expectEqual("null total km round trip", noTotalKmParsed?.totalVehicleKm, null);
  expectEqual(
    "missing total km reads as null",
    parseTaxYearSnapshot({ ...built, totalVehicleKm: undefined })?.totalVehicleKm,
    null,
  );
  expectEqual(
    "non-numeric total km rejected",
    parseTaxYearSnapshot({ ...built, totalVehicleKm: "9000" }),
    null,
  );

  // Carry-forward map loadTaxInputs feeds into the next FY: filed rows only, bad JSON skipped.
  const byFy = filedClosingAtvByFy([
    { fyKey: "2025-26", filedAt: new Date(FILED_2025.filedAtIso), snapshot: stored },
    { fyKey: "2026-27", filedAt: null, snapshot: stored },
    { fyKey: "2024-25", filedAt: new Date("2025-07-01T00:00:00.000Z"), snapshot: { junk: true } },
  ]);
  expectEqual("carry-forward only from filed years", [...byFy.keys()], ["2025-26"]);
  expectEqual("carry-forward value for a1", byFy.get("2025-26")?.get("a1"), 1875);

  // Comparison: identical > nothing; changed income and a removed asset > listed.
  expectEqual("no changes against itself", diffSnapshots(built, built), []);
  const live = buildTaxYearSnapshot({
    result: {
      ...SNAPSHOT_RESULT,
      income: 4300,
      profit: 3046.37,
      ir: { ...SNAPSHOT_RESULT.ir, ir3NetIncome: 3046.37 },
      assets: SNAPSHOT_RESULT.assets.filter((row) => row.assetId === "a1"),
    },
    assets: SNAPSHOT_ASSETS,
    trips,
    totalVehicleKm: 9000,
    filedAt: null,
  });
  expectEqual("changes listed in display order", diffSnapshots(built, live), [
    { key: "income", label: "Income", unit: "money", filed: 4207.5, live: 4300 },
    { key: "profit", label: "Net profit", unit: "money", filed: 2953.87, live: 3046.37 },
    {
      key: "ir.ir3NetIncome",
      label: "Net income (IR3 question 24)",
      unit: "money",
      filed: 2953.87,
      live: 3046.37,
    },
    {
      key: "asset:a2",
      label: "=Desk, oak closing value (no longer in this year)",
      unit: "money",
      filed: 383,
      live: 0,
    },
  ]);

  // Total km for the year: changed, entered after filing, and cleared after filing.
  expectEqual("total km changed", diffSnapshots(built, { ...built, totalVehicleKm: 21000 }), [
    {
      key: "totalVehicleKm",
      label: "Total km the car travelled (odometer)",
      unit: "km",
      filed: 9000,
      live: 21000,
    },
  ]);
  expectEqual("total km entered after filing", diffSnapshots(noTotalKm, built), [
    {
      key: "totalVehicleKm",
      label: "Total km the car travelled (not entered when filed)",
      unit: "km",
      filed: 0,
      live: 9000,
    },
  ]);
  expectEqual("total km cleared after filing", diffSnapshots(built, noTotalKm), [
    {
      key: "totalVehicleKm",
      label: "Total km the car travelled (now cleared)",
      unit: "km",
      filed: 9000,
      live: 0,
    },
  ]);
  expectEqual("total km null on both sides", diffSnapshots(noTotalKm, noTotalKm), []);

  // Which filed years an edit reaches. FY windows are half-open: 1 April belongs to the next FY.
  /**
   * Filed FY keys the given spans reach, against FY 2025-26 only.
   * @param spans - Date spans of the edited record.
   * @returns Matching FY keys.
   */
  const keys = (spans: { from: string; to: string | null }[]): string[] =>
    filedYearsTouched(spans, [FILED_2025]).map((fy) => fy.fyKey);
  expectEqual("trip on 31 March", keys([{ from: "2026-03-31", to: "2026-03-31" }]), ["2025-26"]);
  expectEqual("trip on 1 April", keys([{ from: "2026-04-01", to: "2026-04-01" }]), []);
  expectEqual("asset in service Oct 2025, kept", keys([{ from: "2025-10-01", to: null }]), [
    "2025-26",
  ]);
  expectEqual(
    "asset in service Aug 2026",
    keys([{ from: "2026-08-26T00:00:00.000Z", to: null }]),
    [],
  );
  expectEqual("asset disposed before the FY", keys([{ from: "2024-01-01", to: "2025-03-31" }]), []);
  expectEqual("empty date touches nothing", keys([{ from: "", to: null }]), []);
  expectEqual(
    "trip moved out of a filed year still warns",
    keys([
      { from: "2026-04-02", to: "2026-04-02" },
      { from: "2026-03-31", to: "2026-03-31" },
    ]),
    ["2025-26"],
  );

  console.log("\nAccountant CSV:");
  expectEqual("quotes doubled", csvText('He said "hi"'), '"He said ""hi"""');
  expectEqual("formula guarded", csvText("=1+1"), `"'=1+1"`);
  expectEqual("leading minus guarded", csvText("-5"), `"'-5"`);
  expectEqual("null is empty", csvText(null), '""');
  expectEqual("money two decimals", csvMoney(1234.5), "1234.50");
  expectEqual("tiny negative is zero", csvMoney(-0.004), "0.00");

  // 30 Jun 13:00Z is 1 Jul in NZ; 8 Oct 23:30Z is 9 Oct. Both must print the NZ day.
  const csv = buildTaxCsv(built, {
    fyLabel: "FY 2025-26 (partial)",
    generatedAt: new Date("2026-10-08T23:30:00.000Z"),
  });
  const lines = csv.split("\r\n");
  expectEqual("BOM and title row", lines[0], '\uFEFF"Tax summary","FY 2025-26 (partial)"');
  expectEqual("filed status in NZ date", lines[1], '"Status","Filed 01/07/2026"');
  expectEqual("generated in NZ date", lines[2], '"Generated","09/10/2026"');
  expectEqual("IR3 net income row", lines.includes('"Net income",2953.87,"IR3 question 24"'), true);
  expectEqual(
    "IR10 box 52 row",
    lines.includes('"Depreciation incl. Investment Boost",642.00,"IR10 box 52"'),
    true,
  );
  expectEqual(
    "asset row escaped and complete",
    lines.includes(
      `"'=Desk, oak","fixture-desk","Brought in","01/10/2025",400.00,"SL",8.5,100,6,400.00,17.00,0.00,"No",17.00,383.00,"","",0.00,0.00,"No"`,
    ),
    true,
  );
  expectEqual(
    "asset name with quotes",
    lines.some((line) => line.startsWith('"Laptop, ""Pro"" 14in","fixture-laptop"')),
    true,
  );
  expectEqual("trip row", lines.includes(`"03/11/2025",30,"'-Parts run"`), true);
  expectEqual(
    "trip km decimal",
    lines.includes('"10/02/2026",12.5,"Client visit, Ponsonby"'),
    true,
  );
  expectEqual("km claim row", lines.includes('"Km claim",51.00'), true);
  expectEqual("unclaimed km row", lines.includes('"Km not claimed (no km-rate vehicle)",0'), true);
  expectEqual(
    "total km row before the tier split",
    lines.slice(lines.indexOf('"Km not claimed (no km-rate vehicle)",0') + 1).slice(0, 2),
    ['"Total km the car travelled (odometer)",9000', '"Tier 1 km",42.5'],
  );
  expectEqual("ends with a line break", csv.endsWith("\r\n"), true);
  expectEqual(
    "stored snapshot exports the same CSV",
    parsed
      ? buildTaxCsv(parsed, {
          fyLabel: "FY 2025-26 (partial)",
          generatedAt: new Date("2026-10-08T23:30:00.000Z"),
        })
      : null,
    csv,
  );
  const liveCsv = buildTaxCsv(live, { fyLabel: "FY 2025-26 (partial)", generatedAt: new Date() });
  expectEqual("live status", liveCsv.split("\r\n")[1], '"Status","Not filed - live figures"');
  // A filed year whose snapshot won't parse exports live figures, still dated as filed.
  const unreadableCsv = buildTaxCsv(live, {
    fyLabel: "FY 2025-26 (partial)",
    generatedAt: new Date(),
    unreadableFiledAt: "2026-06-30T13:00:00.000Z",
  });
  expectEqual(
    "unreadable filed status",
    unreadableCsv.split("\r\n")[1],
    `"Status","Filed 01/07/2026 - saved figures couldn't be read, these are fresh figures"`,
  );
  const noTotalKmCsv = buildTaxCsv(noTotalKm, {
    fyLabel: "FY 2025-26 (partial)",
    generatedAt: new Date(),
  });
  expectEqual(
    "total km not entered",
    noTotalKmCsv.split("\r\n").includes('"Total km the car travelled (odometer)","Not entered"'),
    true,
  );
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  checkHelpers();
  checkGstBasis();
  checkTables();
  checkKmAndHomeOffice();
  checkIncomeTax();
  checkSetAside();
  checkDepreciation();
  checkTaxYear();
  checkSnapshots();
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
