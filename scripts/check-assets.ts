// scripts/check-assets.ts
// Asset register helpers: request-body validation for the assets API, the schedule wiring
// (low-value grouping across the whole register, filed closing values carried forward),
// the expense prefill and link list, the view shape the Assets page hands the browser, the
// asset form's round trip through parseAssetBody and its cost label's GST side.
// Run with: npm run check:assets

import {
  costFieldText,
  CUSTOM_CLASS_KEY,
  emptyAssetForm,
  formFromAsset,
  formFromPrefill,
  formToBody,
  toPctString,
  withClass,
  withMethod,
  withOrigin,
} from "@/features/business/components/assets/asset-form-state";
import {
  assetPrefillFromExpense,
  assetSchedules,
  expenseOptions,
  isVehicleClass,
  parseAssetBody,
  toAssetView,
  type AssetBodyResult,
  type AssetRecord,
} from "@/features/business/lib/assets";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import {
  ASSET_CLASSES,
  filedAtvFor,
  toTaxFy,
  type AssetInput,
  type LedgerExpense,
} from "@/features/business/lib/tax";
import { formatDollars, formatRatePct } from "@/features/business/lib/tax/workings";
import { parseDateKey } from "@/shared/lib/date-format";

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
 * The error a parse produced, or "ok", so a case compares as one string.
 * @param result - Outcome of parseAssetBody.
 * @returns "ok" or the error message.
 */
function errorOf(result: AssetBodyResult): string {
  return result.ok ? "ok" : result.error;
}

/** A real-looking ObjectId for the car expense. */
const EXPENSE_ID = "66cc00000000000000000c01";

/** The 2026-08-26 car from Kevin, as the tax loader hands expenses over. */
const CAR: LedgerExpense = {
  id: EXPENSE_ID,
  date: "2026-08-26T00:00:00.000Z",
  category: "Other",
  amountIncl: 4500,
  amountExcl: 3913.04,
  supplier: "Kevin",
  description: "Car",
};

/**
 * A valid brought-in laptop request body, with overrides on top.
 * @param classKey - Asset class key to use.
 * @param overrides - Fields to add or replace.
 * @returns The body.
 */
function laptopBody(
  classKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Laptop",
    classKey,
    origin: "introduced",
    inServiceDate: "2025-10-01",
    costBase: 1200,
    method: "DV",
    businessUsePct: 80,
    ...overrides,
  };
}

/**
 * A bought, wholly-business, 50% DV asset first used 13 Nov 2025, with overrides.
 * @param overrides - Fields to change.
 * @returns The asset as the tax maths reads it.
 */
function makeAsset(overrides: Partial<AssetInput>): AssetInput {
  return {
    id: "a",
    name: "Item",
    classKey: "custom",
    origin: "purchased",
    inServiceDate: "2025-11-13T00:00:00.000Z",
    costBase: 600,
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

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  const vehicle = ASSET_CLASSES.find((c) => isVehicleClass(c.key));
  const other = ASSET_CLASSES.find((c) => !isVehicleClass(c.key));
  if (!vehicle || !other) {
    console.error("  FAIL  ASSET_CLASSES needs a motor vehicle class and at least one other class");
    process.exit(1);
  }

  console.log("parseDateKey:");
  expectEqual(
    "2025-10-01 > UTC midnight",
    parseDateKey("2025-10-01")?.toISOString(),
    "2025-10-01T00:00:00.000Z",
  );
  expectEqual("2026-02-30 refused", parseDateKey("2026-02-30"), null);
  expectEqual("26/08/2026 refused", parseDateKey("26/08/2026"), null);
  expectEqual("full ISO instant refused", parseDateKey("2025-10-01T00:00:00Z"), null);

  console.log("\nparseAssetBody, accepted:");
  const laptop = parseAssetBody(laptopBody(other.key));
  expectEqual("brought-in laptop parses", errorOf(laptop), "ok");
  if (laptop.ok) {
    expectEqual("DV rate from the class table", laptop.data.rate, other.dv);
    expectEqual(
      "ledger-scale date",
      laptop.data.inServiceDate.toISOString(),
      "2025-10-01T00:00:00.000Z",
    );
    expectEqual(
      "brought in: no supplier, link or boost; not disposed",
      [
        laptop.data.supplier,
        laptop.data.expenseId,
        laptop.data.investmentBoost,
        laptop.data.disposedAt,
        laptop.data.disposalAmount,
      ],
      [null, null, false, null, null],
    );
  }
  const sl = parseAssetBody(laptopBody(other.key, { method: "SL" }));
  expectEqual("SL picks the SL rate", sl.ok && sl.data.rate, other.sl);
  const noMethod = parseAssetBody(laptopBody(other.key, { method: undefined }));
  expectEqual(
    "missing method defaults to DV",
    noMethod.ok && [noMethod.data.method, noMethod.data.rate],
    ["DV", other.dv],
  );
  const custom = parseAssetBody(laptopBody("custom", { rate: 0.25 }));
  expectEqual("unlisted class with a typed rate", custom.ok && custom.data.rate, 0.25);
  const noPct = parseAssetBody(laptopBody(other.key, { businessUsePct: "" }));
  expectEqual("blank business use defaults to 100", noPct.ok && noPct.data.businessUsePct, 100);
  const cents = parseAssetBody(laptopBody(other.key, { costBase: "254.356" }));
  expectEqual("cost rounds to cents", cents.ok && cents.data.costBase, 254.36);
  const droppedSupplier = parseAssetBody(
    laptopBody(other.key, { supplier: "PB Tech", valuationNote: "  Trade Me sold listings " }),
  );
  expectEqual(
    "brought in keeps the valuation note, drops the supplier",
    droppedSupplier.ok && [droppedSupplier.data.supplier, droppedSupplier.data.valuationNote],
    [null, "Trade Me sold listings"],
  );
  const binned = parseAssetBody(laptopBody(other.key, { disposedAt: "2026-06-30" }));
  expectEqual(
    "disposal with no price is a $0 sale",
    binned.ok && [binned.data.disposedAt?.toISOString(), binned.data.disposalAmount],
    ["2026-06-30T00:00:00.000Z", 0],
  );
  const sold = parseAssetBody(
    laptopBody(other.key, { disposedAt: "2026-06-30", disposalAmount: "350.5" }),
  );
  expectEqual("disposal with a price", sold.ok && sold.data.disposalAmount, 350.5);
  const bought = parseAssetBody(
    laptopBody(other.key, {
      origin: "purchased",
      supplier: "PB Tech",
      valuationNote: "x",
      expenseId: EXPENSE_ID,
    }),
  );
  expectEqual(
    "bought keeps supplier and link, drops the valuation note",
    bought.ok && [bought.data.supplier, bought.data.expenseId, bought.data.valuationNote],
    ["PB Tech", EXPENSE_ID, null],
  );
  const kmCar = parseAssetBody(
    laptopBody(vehicle.key, {
      origin: "purchased",
      vehicleMethod: "km",
      costBase: 4500,
      inServiceDate: "2026-08-26",
    }),
  );
  expectEqual("km-rate vehicle", kmCar.ok && [kmCar.data.vehicleMethod, kmCar.data.rate], [
    "km",
    vehicle.dv,
  ]);

  console.log("\nparseAssetBody, refused:");
  const refused: Array<[string, unknown, string]> = [
    ["null body", null, "Expected a JSON object"],
    ["array body", [], "Expected a JSON object"],
    [
      "blank name",
      laptopBody(other.key, { name: "  " }),
      "Name is required (up to 120 characters)",
    ],
    ["no class", laptopBody(other.key, { classKey: "" }), "Asset class is required"],
    [
      "bad origin",
      laptopBody(other.key, { origin: "gift" }),
      "Origin must be introduced or purchased",
    ],
    ["bad method", laptopBody(other.key, { method: "XX" }), "Method must be DV or SL"],
    [
      "impossible date",
      laptopBody(other.key, { inServiceDate: "2026-02-30" }),
      "In-service date must be a real date (YYYY-MM-DD)",
    ],
    [
      "zero cost",
      laptopBody(other.key, { costBase: 0 }),
      "Cost or market value must be more than $0",
    ],
    [
      "text cost",
      laptopBody(other.key, { costBase: "abc" }),
      "Cost or market value must be more than $0",
    ],
    [
      "cost rounds to $0",
      laptopBody(other.key, { costBase: 0.004 }),
      "Cost or market value must be more than $0",
    ],
    [
      "unlisted class, no rate",
      laptopBody("custom"),
      "Pick an asset class from the list, or enter a rate",
    ],
    ["rate 0", laptopBody(other.key, { rate: 0 }), "Rate must be more than 0% and at most 100%"],
    [
      "rate 1.5",
      laptopBody(other.key, { rate: 1.5 }),
      "Rate must be more than 0% and at most 100%",
    ],
    [
      "business use 101",
      laptopBody(other.key, { businessUsePct: 101 }),
      "Business use must be between 0% and 100%",
    ],
    [
      "business use -1",
      laptopBody(other.key, { businessUsePct: -1 }),
      "Business use must be between 0% and 100%",
    ],
    [
      "business use true",
      laptopBody(other.key, { businessUsePct: true }),
      "Business use must be between 0% and 100%",
    ],
    [
      "cost true",
      laptopBody(other.key, { costBase: true }),
      "Cost or market value must be more than $0",
    ],
    [
      "rate true",
      laptopBody(other.key, { rate: true }),
      "Rate must be more than 0% and at most 100%",
    ],
    [
      "sale amount true",
      laptopBody(other.key, { disposedAt: "2026-06-30", disposalAmount: true }),
      "Sale amount must be $0 or more",
    ],
    [
      "sale amount as an object",
      laptopBody(other.key, { disposedAt: "2026-06-30", disposalAmount: { n: 5 } }),
      "Sale amount must be $0 or more",
    ],
    [
      "vehicle method fuel",
      laptopBody(vehicle.key, { vehicleMethod: "fuel" }),
      "Vehicle method must be km or blank",
    ],
    [
      "km on a laptop",
      laptopBody(other.key, { vehicleMethod: "km" }),
      "Kilometre rates only apply to the motor vehicle class",
    ],
    [
      "boost as text",
      laptopBody(other.key, { investmentBoost: "yes" }),
      "Investment Boost must be true or false",
    ],
    [
      "boost on brought in",
      laptopBody(other.key, { investmentBoost: true }),
      "Investment Boost only applies to brand-new items you bought",
    ],
    [
      "boost on a km vehicle",
      laptopBody(vehicle.key, {
        origin: "purchased",
        vehicleMethod: "km",
        investmentBoost: true,
        inServiceDate: "2026-08-26",
      }),
      "A vehicle on kilometre rates isn't depreciated, so Investment Boost doesn't apply",
    ],
    [
      "boost before 22 May 2025",
      laptopBody(other.key, {
        origin: "purchased",
        investmentBoost: true,
        inServiceDate: "2025-05-21",
      }),
      "Investment Boost only covers items first used on or after 22 May 2025",
    ],
    [
      "malformed expense id",
      laptopBody(other.key, { origin: "purchased", expenseId: "abc" }),
      "Linked expense id isn't valid",
    ],
    [
      "link on brought in",
      laptopBody(other.key, { expenseId: EXPENSE_ID }),
      "Only a bought asset can be linked to an expense",
    ],
    [
      "bad disposal date",
      laptopBody(other.key, { disposedAt: "soon" }),
      "Disposal date must be a real date (YYYY-MM-DD)",
    ],
    [
      "disposed before in use",
      laptopBody(other.key, { disposedAt: "2025-09-30" }),
      "Disposal date can't be before the in-service date",
    ],
    [
      "sale price, no date",
      laptopBody(other.key, { disposalAmount: 100 }),
      "A sale amount needs a disposal date",
    ],
    [
      "negative sale price",
      laptopBody(other.key, { disposedAt: "2026-06-30", disposalAmount: -5 }),
      "Sale amount must be $0 or more",
    ],
  ];
  for (const [label, body, error] of refused) {
    expectEqual(label, errorOf(parseAssetBody(body)), error);
  }

  console.log("\nassetSchedules (low-value grouping across the register):");
  const fys = listFinancialYears(
    new Date("2026-10-09T00:00:00.000Z"),
    new Date("2025-10-01T00:00:00.000Z"),
  )
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(toTaxFy);
  const businessStart = new Date("2025-10-01T00:00:00.000Z");
  const brought = makeAsset({
    id: "brought",
    origin: "introduced",
    supplier: null,
    costBase: 400,
    inServiceDate: "2025-10-01T00:00:00.000Z",
  });
  const schedules = assetSchedules(
    [
      makeAsset({ id: "psu", costBase: 254.36 }),
      makeAsset({ id: "pair-1", supplier: "Computer Lounge", costBase: 600 }),
      makeAsset({ id: "pair-2", supplier: " computer lounge ", costBase: 600 }),
      brought,
    ],
    fys,
    { businessStart, lowValueThreshold: 1000, filed: new Map() },
  );
  expectEqual(
    "one schedule per asset",
    [...schedules.keys()],
    ["psu", "pair-1", "pair-2", "brought"],
  );
  expectEqual("first row is FY 2025-26", schedules.get("psu")?.[0]?.fyKey, "2025-26");
  expectEqual("lone $254.36 item written off", schedules.get("psu")?.[0]?.writtenOff, true);
  expectEqual(
    "two $600 items, same supplier and day ($1,200 together): neither written off",
    [
      schedules.get("pair-1")?.some((r) => r.writtenOff),
      schedules.get("pair-2")?.some((r) => r.writtenOff),
    ],
    [false, false],
  );
  expectEqual(
    "brought-in $400 item is depreciated, not written off",
    schedules.get("brought")?.some((r) => r.writtenOff),
    false,
  );

  console.log("\nFiled closing values:");
  const filed = new Map([
    [
      "2025-26",
      new Map([
        ["x", 123.45],
        ["y", 9],
      ]),
    ],
    ["2026-27", new Map([["y", 1]])],
  ]);
  expectEqual("one asset's filed values", [...filedAtvFor("x", filed)], [["2025-26", 123.45]]);
  expectEqual("asset in no filed year", [...filedAtvFor("z", filed)], []);
  const carried = assetSchedules([brought], fys, {
    businessStart,
    lowValueThreshold: 1000,
    filed: new Map([["2025-26", new Map([["brought", 100]])]]),
  });
  expectEqual(
    "filed 2025-26 closing value opens 2026-27",
    carried.get("brought")?.[1]?.openingAtv,
    100,
  );

  console.log("\nExpense prefill and link list:");
  expectEqual(
    "unregistered: cost is the GST-inclusive amount",
    assetPrefillFromExpense(CAR, { registered: false, registeredFrom: null }),
    {
      name: "Car",
      supplier: "Kevin",
      costBase: 4500,
      inServiceDate: "2026-08-26",
      expenseId: EXPENSE_ID,
    },
  );
  expectEqual(
    "registered before the purchase: GST-exclusive",
    assetPrefillFromExpense(CAR, { registered: true, registeredFrom: "2026-01-01" }).costBase,
    3913.04,
  );
  expectEqual(
    "registered after the purchase: still inclusive",
    assetPrefillFromExpense(CAR, { registered: true, registeredFrom: "2026-09-01" }).costBase,
    4500,
  );
  const psu: LedgerExpense = {
    ...CAR,
    id: "66cc00000000000000000c02",
    date: "2025-11-13T00:00:00.000Z",
    supplier: "PB Tech",
    description: "PSU",
    amountIncl: 254.36,
    amountExcl: 221.18,
  };
  const opts = expenseOptions([psu, CAR], [{ id: "asset-1", expenseId: EXPENSE_ID }]);
  expectEqual(
    "newest first, linked asset noted",
    opts.map((o) => [o.id, o.linkedAssetId]),
    [
      [EXPENSE_ID, "asset-1"],
      [psu.id, null],
    ],
  );
  expectEqual("option label", opts[0]?.label, "26 Aug 2026 - Kevin: Car ($4,500.00)");

  console.log("\nView shape and formatting:");
  const row: AssetRecord = {
    id: "asset-1",
    name: "Car",
    classKey: vehicle.key,
    origin: "purchased",
    inServiceDate: new Date("2026-08-26T00:00:00.000Z"),
    costBase: 4500,
    supplier: "Kevin",
    valuationNote: null,
    method: "DV",
    rate: vehicle.dv,
    businessUsePct: 100,
    investmentBoost: false,
    vehicleMethod: "km",
    expenseId: EXPENSE_ID,
    disposedAt: null,
    disposalAmount: null,
    notes: null,
  };
  const view = toAssetView(row, [], "2026-27", new Map(opts.map((o) => [o.id, o.label])));
  expectEqual(
    "view date, class label, expense label, no current row",
    [view.inServiceDate, view.classLabel, view.expenseLabel, view.current, view.vehicleMethod],
    ["2026-08-26", vehicle.label, "26 Aug 2026 - Kevin: Car ($4,500.00)", null, "km"],
  );
  expectEqual(
    "unlisted class label",
    toAssetView({ ...row, classKey: "custom" }, [], "2026-27", new Map()).classLabel,
    "Custom rate",
  );
  expectEqual("rate 0.105 shows as 10.5%", formatRatePct(0.105), "10.5%");
  expectEqual("threshold drops .00", formatDollars(1000), "$1,000");
  expectEqual("threshold keeps cents", formatDollars(999.5), "$999.50");

  console.log("\nForm state round trip:");
  const prefill = assetPrefillFromExpense(CAR, { registered: false, registeredFrom: null });
  const carForm = { ...withClass(formFromPrefill(prefill), vehicle.key), kmVehicle: true };
  expectEqual("vehicle class fills its DV rate", carForm.ratePct, toPctString(vehicle.dv));
  const carBody = parseAssetBody(formToBody(carForm));
  expectEqual("car form parses", errorOf(carBody), "ok");
  expectEqual(
    "car saves as a linked km-rate vehicle at the inclusive cost",
    carBody.ok && [
      carBody.data.origin,
      carBody.data.vehicleMethod,
      carBody.data.expenseId,
      carBody.data.costBase,
      carBody.data.supplier,
    ],
    ["purchased", "km", EXPENSE_ID, 4500, "Kevin"],
  );
  expectEqual(
    "SL swaps in the SL rate",
    withMethod(carForm, "SL").ratePct,
    toPctString(vehicle.sl),
  );
  expectEqual(
    "leaving the vehicle class drops km rates",
    withClass(carForm, other.key).kmVehicle,
    false,
  );
  expectEqual(
    "an unlisted class keeps a typed rate",
    withClass({ ...carForm, ratePct: "33" }, CUSTOM_CLASS_KEY).ratePct,
    "33",
  );
  const broughtIn = withOrigin({ ...carForm, investmentBoost: true }, "introduced");
  expectEqual(
    "brought in clears the link and boost",
    [broughtIn.expenseId, broughtIn.investmentBoost],
    ["", false],
  );
  expectEqual(
    "unlisted class with no rate is refused",
    errorOf(
      parseAssetBody(
        formToBody({
          ...emptyAssetForm(),
          name: "Desk",
          classKey: CUSTOM_CLASS_KEY,
          costBase: "300",
        }),
      ),
    ),
    "Pick an asset class from the list, or enter a rate",
  );
  expectEqual(
    "unreadable rate is refused, not defaulted",
    errorOf(
      parseAssetBody(
        formToBody({
          ...emptyAssetForm(),
          name: "Desk",
          classKey: CUSTOM_CLASS_KEY,
          costBase: "300",
          ratePct: "abc",
        }),
      ),
    ),
    "Rate must be more than 0% and at most 100%",
  );
  expectEqual("saved car reopens with km rates ticked", formFromAsset(view).kmVehicle, true);
  expectEqual(
    "percent strings",
    [toPctString(0.105), toPctString(0.67), toPctString(0.3)],
    ["10.5", "67", "30"],
  );

  console.log("\nCost label on the GST basis for the in-service date:");
  const unregistered = { registered: false, registeredFrom: null };
  const fromSept = { registered: true, registeredFrom: "2026-09-01" };
  const boughtForm = {
    ...emptyAssetForm(),
    origin: "purchased" as const,
    inServiceDate: "2026-08-26",
  };
  expectEqual(
    "unregistered: incl. GST, hint says to include it",
    costFieldText(boughtForm, unregistered),
    {
      label: "Cost (incl. GST)",
      hint: "What you paid, including GST. You weren't GST-registered on that date, so the GST is part of the cost.",
      gstInclusive: true,
    },
  );
  expectEqual(
    "in use the day before registration: incl. GST",
    costFieldText(boughtForm, fromSept).label,
    "Cost (incl. GST)",
  );
  expectEqual(
    "in use on the registration day: excl. GST, hint says to leave it out",
    costFieldText({ ...boughtForm, inServiceDate: "2026-09-01" }, fromSept),
    {
      label: "Cost (excl. GST)",
      hint: "What you paid, less GST. You were GST-registered on that date, so the GST is claimed back in your GST return instead.",
      gstInclusive: false,
    },
  );
  expectEqual(
    "registered from the business start: excl. GST",
    costFieldText(boughtForm, { registered: true, registeredFrom: null }).label,
    "Cost (excl. GST)",
  );
  expectEqual(
    "brought in before registration: no GST suffix, hint says not to add GST",
    costFieldText({ ...boughtForm, origin: "introduced" }, fromSept),
    {
      label: "Market value on that date",
      hint: "What it would have sold for second-hand that day. Don't add GST.",
      gstInclusive: true,
    },
  );
  expectEqual(
    "brought in after registration: no GST suffix, hint covers a GST claim",
    costFieldText({ ...boughtForm, origin: "introduced", inServiceDate: "2026-09-02" }, fromSept),
    {
      label: "Market value on that date",
      hint: "What it would have sold for second-hand that day. If you claim GST back on it in a GST return, enter the value less that GST.",
      gstInclusive: false,
    },
  );
  expectEqual(
    "blank date reads as today: registered long ago > excl.",
    costFieldText(
      { ...boughtForm, inServiceDate: "" },
      { registered: true, registeredFrom: "2000-01-01" },
    ).label,
    "Cost (excl. GST)",
  );
  expectEqual(
    "blank date reads as today: registering far ahead > incl.",
    costFieldText(
      { ...boughtForm, inServiceDate: "" },
      { registered: true, registeredFrom: "2999-01-01" },
    ).label,
    "Cost (incl. GST)",
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
