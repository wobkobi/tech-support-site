// scripts/check-tax-page.ts
// Display maths behind the Tax page and the overview's tax card: the per-bracket split of
// income tax, the rate and dollar labels, the all-FY sum for "All time", the GST roll-up
// gated by the "registered from" date, and the invariants the page relies on in a
// computeTaxYear result (counted deduction lines add up to the total, the bands add up to
// the income tax, the set-aside total is residual tax plus ACC), and the labels a filed
// year shows once Settings have changed (rates from the saved amounts, band rows only while
// the brackets still give the saved income tax).
// Run with: npm run check:tax-page

import {
  ASSET_CLASSES,
  computeTaxYear,
  type AssetInput,
  type TaxBracket,
  type TaxFy,
  type TaxYearInput,
  type TaxYearResult,
} from "@/features/business/lib/tax";
import {
  bandBreakdown,
  bandLabel,
  bracketsMatchFiled,
  filedRateLabel,
  formatRatePct,
  formatWholeDollars,
  fuelLabel,
  gstToPay,
  sumTaxEstimates,
} from "@/features/business/lib/tax/workings";

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
 * Rounds to cents, as the tax maths does.
 * @param n - Value to round.
 * @returns Rounded value.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** NZ brackets current since 1 April 2025. */
const BRACKETS: TaxBracket[] = [
  { upTo: 15600, rate: 0.105 },
  { upTo: 53500, rate: 0.175 },
  { upTo: 78100, rate: 0.3 },
  { upTo: 180000, rate: 0.33 },
  { upTo: null, rate: 0.39 },
];

/**
 * A TaxYearResult with every figure zero except the ones the summary reads.
 * @param fyKey - FY key.
 * @param f - Figures to set.
 * @param f.income - Income.
 * @param f.recoveryIncome - Depreciation recovery income.
 * @param f.deductionsTotal - Total deductions.
 * @param f.taxable - Taxable profit.
 * @param f.incomeTax - Income tax on the brackets.
 * @param f.ietc - IETC credit.
 * @param f.residualIncomeTax - Income tax after the credit.
 * @param f.acc - ACC.
 * @param f.totalToSetAside - Residual tax plus ACC.
 * @param f.provisionalWarning - Provisional tax flag.
 * @returns The fake result.
 */
function fakeResult(
  fyKey: string,
  f: {
    income: number;
    recoveryIncome: number;
    deductionsTotal: number;
    taxable: number;
    incomeTax: number;
    ietc: number;
    residualIncomeTax: number;
    acc: number;
    totalToSetAside: number;
    provisionalWarning: boolean;
  },
): TaxYearResult {
  return {
    fyKey,
    income: f.income,
    recoveryIncome: f.recoveryIncome,
    deductions: {
      expenses: 0,
      excludedFuel: 0,
      excludedAssetLinked: 0,
      unclaimedKm: 0,
      depreciation: 0,
      lowValueWriteOffs: 0,
      investmentBoost: 0,
      km: 0,
      homeOffice: 0,
      lossOnDisposal: 0,
      total: f.deductionsTotal,
      lines: [],
    },
    profit: f.taxable,
    taxable: f.taxable,
    incomeTax: f.incomeTax,
    ietc: f.ietc,
    residualIncomeTax: f.residualIncomeTax,
    acc: f.acc,
    kiwiSaver: 0,
    totalToSetAside: f.totalToSetAside,
    provisionalWarning: f.provisionalWarning,
    assets: [],
    km: { businessKm: 0, tier1Km: 0, tier2Km: 0, amount: 0 },
    homeOffice: { officePct: 0, sqmPart: 0, proportionalPart: 0, amount: 0 },
    ir: {
      ir3NetIncome: 0,
      ir10Box52Depreciation: 0,
      ir10Box54Additions: 0,
      ir10Box55Disposals: 0,
      ir10Box59LossOnDisposal: 0,
      ir10Box60BoostValue: 0,
    },
  };
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("Bracket split:");
  expectEqual("taxable 60,000 reaches the 30% band", bandBreakdown(60000, BRACKETS), [
    { from: 0, upTo: 15600, rate: 0.105, taxedAmount: 15600, tax: 1638 },
    { from: 15600, upTo: 53500, rate: 0.175, taxedAmount: 37900, tax: 6632.5 },
    { from: 53500, upTo: 78100, rate: 0.3, taxedAmount: 6500, tax: 1950 },
    { from: 78100, upTo: 180000, rate: 0.33, taxedAmount: 0, tax: 0 },
    { from: 180000, upTo: null, rate: 0.39, taxedAmount: 0, tax: 0 },
  ]);
  expectEqual(
    "taxable 200,000 band taxes",
    bandBreakdown(200000, BRACKETS).map((b) => b.tax),
    [1638, 6632.5, 7380, 33627, 7800],
  );
  expectEqual(
    "taxable exactly 15,600 stays in the first band",
    bandBreakdown(15600, BRACKETS).map((b) => b.taxedAmount),
    [15600, 0, 0, 0, 0],
  );
  expectEqual(
    "taxable 0 taxes nothing",
    bandBreakdown(0, BRACKETS).map((b) => b.tax),
    [0, 0, 0, 0, 0],
  );
  expectEqual(
    "brackets stored out of order are sorted, open band last",
    bandBreakdown(20000, [
      BRACKETS[4]!,
      BRACKETS[1]!,
      BRACKETS[0]!,
      BRACKETS[3]!,
      BRACKETS[2]!,
    ]).map((b) => b.upTo),
    [15600, 53500, 78100, 180000, null],
  );

  console.log("\nLabels:");
  expectEqual(
    "first band label",
    bandLabel(bandBreakdown(60000, BRACKETS)[0]!),
    "10.5% on the first $15,600",
  );
  expectEqual(
    "middle band label",
    bandLabel(bandBreakdown(60000, BRACKETS)[1]!),
    "17.5% from $15,600 to $53,500",
  );
  expectEqual("top band label", bandLabel(bandBreakdown(60000, BRACKETS)[4]!), "39% over $180,000");
  expectEqual("rate 1.46% survives floating point", formatRatePct(0.0146), "1.46%");
  expectEqual("rate 1.67%", formatRatePct(0.0167), "1.67%");
  expectEqual("whole rate drops the decimals", formatRatePct(0.03), "3%");
  expectEqual("whole dollars", formatWholeDollars(180000), "$180,000");
  expectEqual("whole dollars rounds", formatWholeDollars(57.3), "$57");
  expectEqual("fuel label", fuelLabel("petrol-hybrid"), "petrol hybrid");

  console.log("\nAll-FY sum:");
  const fy25 = fakeResult("2025-26", {
    income: 4207.5,
    recoveryIncome: 0,
    deductionsTotal: 560.63,
    taxable: 3646.87,
    incomeTax: 382.92,
    ietc: 0,
    residualIncomeTax: 382.92,
    acc: 60.9,
    totalToSetAside: 443.82,
    provisionalWarning: false,
  });
  const fy26 = fakeResult("2026-27", {
    income: 10219.99,
    recoveryIncome: 100.1,
    deductionsTotal: 8103.19,
    taxable: 2216.9,
    incomeTax: 232.77,
    ietc: 0,
    residualIncomeTax: 232.77,
    acc: 37.02,
    totalToSetAside: 269.79,
    provisionalWarning: true,
  });
  expectEqual(
    "two FYs summed (recovery counts as income, warning carries)",
    sumTaxEstimates([fy25, fy26]),
    {
      income: 14527.59,
      deductions: 8663.82,
      taxable: 5863.77,
      incomeTax: 615.69,
      ietc: 0,
      residualIncomeTax: 615.69,
      acc: 97.92,
      totalToSetAside: 713.61,
      provisionalWarning: true,
    },
  );
  expectEqual("no FYs sums to zero", sumTaxEstimates([]), {
    income: 0,
    deductions: 0,
    taxable: 0,
    incomeTax: 0,
    ietc: 0,
    residualIncomeTax: 0,
    acc: 0,
    totalToSetAside: 0,
    provisionalWarning: false,
  });

  console.log("\nGST roll-up:");
  const gstIncome = [
    { date: "2026-09-30T00:00:00.000Z", amount: 230 },
    { date: "2026-10-01T00:00:00.000Z", amount: 115 },
    { date: "2026-11-05T00:00:00.000Z", amount: 230 },
  ];
  const gstExpenses = [
    { date: "2026-09-15T00:00:00.000Z", gstAmount: 10 },
    { date: "2026-10-02T00:00:00.000Z", gstAmount: 6.5 },
  ];
  expectEqual(
    "registered from 1 Oct: only rows from that NZ day count",
    gstToPay(gstIncome, gstExpenses, { registered: true, registeredFrom: "2026-10-01" }),
    { outputFromIncome: 45, inputFromExpenses: 6.5, netToPay: 38.5 },
  );
  expectEqual(
    "registered from business start: every row counts",
    gstToPay(gstIncome, gstExpenses, { registered: true, registeredFrom: null }),
    { outputFromIncome: 75, inputFromExpenses: 16.5, netToPay: 58.5 },
  );
  expectEqual(
    "not registered: nothing",
    gstToPay(gstIncome, gstExpenses, { registered: false, registeredFrom: null }),
    { outputFromIncome: 0, inputFromExpenses: 0, netToPay: 0 },
  );

  console.log("\nInvariants the Tax page relies on (computeTaxYear, FY 2026-27):");
  const fy: TaxFy = {
    key: "2026-27",
    start: new Date("2026-04-01T00:00:00.000Z"),
    end: new Date("2027-04-01T00:00:00.000Z"),
    current: false,
  };
  const car: AssetInput = {
    id: "car",
    name: "Car",
    classKey: ASSET_CLASSES[0]?.key ?? "",
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
    expenseId: "e3",
  };
  const input: TaxYearInput = {
    fy,
    businessStart: new Date("2025-10-01T00:00:00.000Z"),
    income: [
      { date: "2026-03-31T00:00:00.000Z", amount: 999 },
      { date: "2026-05-01T00:00:00.000Z", amount: 30000 },
    ],
    expenses: [
      {
        id: "e1",
        date: "2026-06-01T00:00:00.000Z",
        category: "Tools",
        amountIncl: 115,
        amountExcl: 100,
        supplier: "PB Tech",
        description: "Multimeter",
      },
      {
        id: "e2",
        date: "2026-09-15T00:00:00.000Z",
        category: "Fuel",
        amountIncl: 80,
        amountExcl: 69.57,
        supplier: "Z",
        description: "Fuel",
      },
      {
        id: "e3",
        date: "2026-08-26T00:00:00.000Z",
        category: "Other",
        amountIncl: 4500,
        amountExcl: 3913.04,
        supplier: "Kevin",
        description: "Car",
      },
    ],
    assets: [car],
    // The 15 Jul trip is before the car's 26 Aug in-service day, so it is unclaimed.
    trips: [
      { date: "2026-07-15T00:00:00.000Z", km: 50 },
      { date: "2026-09-01T00:00:00.000Z", km: 1000 },
    ],
    year: {
      officeSqm: 10,
      houseSqm: 100,
      sqmRate: 57.3,
      kmTier1: 1.2,
      kmTier2: 0.37,
      mortgageInterestOrRent: 10000,
      rates: 3000,
    },
    settings: {
      brackets: BRACKETS,
      ietc: {
        enabled: true,
        annual: 520,
        from: 24000,
        fullTo: 66000,
        cutoff: 70000,
        abatementPerDollar: 0.13,
      },
      acc: 0.0167,
      kiwiSaver: 0.03,
      lowValueThreshold: 1000,
      provisionalThreshold: 5000,
      vehicleFuel: "petrol",
      categoryBusinessUse: {},
    },
    gst: { registered: false, registeredFrom: null },
    filedClosingAtv: new Map(),
    now: new Date("2027-05-01T00:00:00.000Z"),
  };
  const result = computeTaxYear(input);
  const counted = result.deductions.lines.filter((l) => l.amount !== 0);
  expectEqual(
    "counted deduction lines add up to the total (excluded rows are not lines)",
    round2(counted.reduce((s, l) => s + l.amount, 0)),
    round2(result.deductions.total),
  );
  expectEqual(
    "Fuel (dated while the car is on km rates) and the asset-linked car are reported as excluded",
    [result.deductions.excludedFuel > 0, result.deductions.excludedAssetLinked > 0],
    [true, true],
  );
  expectEqual(
    "a trip before the car is reported as unclaimed km, not claimed",
    [result.km.businessKm, result.deductions.unclaimedKm],
    [1000, 50],
  );
  const bandTotal = round2(bandBreakdown(result.taxable, BRACKETS).reduce((s, b) => s + b.tax, 0));
  expectEqual(
    "bands add up to the income tax (within 5c of per-band rounding)",
    Math.abs(bandTotal - result.incomeTax) <= 0.05,
    true,
  );
  expectEqual(
    "set-aside total is residual income tax plus ACC",
    result.totalToSetAside,
    round2(result.residualIncomeTax + result.acc),
  );
  expectEqual(
    "one-FY summary carries the same set-aside total",
    sumTaxEstimates([result]).totalToSetAside,
    result.totalToSetAside,
  );

  console.log("\nFiled-year labels (the result above filed, then the settings changed):");
  // The ACC rate moved from 1.67% to 1.75% and the first threshold moved after filing.
  const laterBrackets: TaxBracket[] = BRACKETS.map((b) =>
    b.upTo === 15600 ? { upTo: 18000, rate: 0.105 } : b,
  );
  expectEqual(
    "ACC rate comes from the saved amounts, not the later 1.75%",
    filedRateLabel(result.acc, result.taxable),
    "1.67%",
  );
  expectEqual(
    "KiwiSaver rate comes from the saved amounts",
    filedRateLabel(result.kiwiSaver, result.taxable),
    "3%",
  );
  expectEqual("no taxable profit: no rate", filedRateLabel(0, 0), null);
  expectEqual(
    "same brackets: the saved income tax matches, so the band rows show",
    bracketsMatchFiled(result, BRACKETS),
    true,
  );
  expectEqual(
    "changed brackets: the saved income tax no longer matches, so the band rows hide",
    bracketsMatchFiled(result, laterBrackets),
    false,
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
