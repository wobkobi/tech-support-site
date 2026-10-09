// scripts/check-tax-settings.ts
// Tax and GST settings validation: the shipped defaults pass, and each new rule rejects a
// shape the Tax page couldn't use (unordered bands, an open-ended middle band, an IETC
// range out of order, a business-use share over 100%, a bad registration date).
// Run with: npm run check:tax-settings

import type { VehicleFuel } from "@/features/business/lib/tax/types";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import type { PricingSettings, TaxSettings } from "@/shared/lib/settings/types";
import { validateGroup } from "@/shared/lib/settings/validate";

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
 * Field paths the tax validator rejects for the defaults with a patch applied.
 * @param patch - Tax fields to override.
 * @returns Rejected field paths, in validator order.
 */
function taxErrors(patch: Partial<TaxSettings>): string[] {
  return validateGroup("tax", { ...DEFAULT_SETTINGS.tax, ...patch }).map((e) => e.field);
}

/**
 * Field paths the pricing validator rejects for the defaults with a patch applied.
 * @param patch - Pricing fields to override.
 * @returns Rejected field paths, in validator order.
 */
function pricingErrors(patch: Partial<PricingSettings>): string[] {
  return validateGroup("pricing", { ...DEFAULT_SETTINGS.pricing, ...patch }).map((e) => e.field);
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  const ietc = DEFAULT_SETTINGS.tax.ietc;

  console.log("Defaults:");
  expectEqual("default tax settings pass", taxErrors({}), []);
  expectEqual("default pricing settings pass", pricingErrors({}), []);
  expectEqual("default brackets", DEFAULT_SETTINGS.tax.brackets, [
    { upTo: 15600, rate: 0.105 },
    { upTo: 53500, rate: 0.175 },
    { upTo: 78100, rate: 0.3 },
    { upTo: 180000, rate: 0.33 },
    { upTo: null, rate: 0.39 },
  ]);
  expectEqual("default IETC", ietc, {
    enabled: true,
    annual: 520,
    from: 24000,
    fullTo: 66000,
    cutoff: 70000,
    abatementPerDollar: 0.13,
  });
  expectEqual("default ACC is the 2026-27 earners' levy", DEFAULT_SETTINGS.tax.acc, 0.0175);
  expectEqual(
    "default thresholds, fuel and business use",
    [
      DEFAULT_SETTINGS.tax.lowValueThreshold,
      DEFAULT_SETTINGS.tax.provisionalThreshold,
      DEFAULT_SETTINGS.tax.vehicleFuel,
      DEFAULT_SETTINGS.tax.categoryBusinessUse,
    ],
    [1000, 5000, "petrol", {}],
  );
  expectEqual(
    "default GST registered from is blank",
    DEFAULT_SETTINGS.pricing.gstRegisteredFrom,
    "",
  );

  console.log("\nBrackets:");
  expectEqual("no bands", taxErrors({ brackets: [] }), ["brackets"]);
  expectEqual(
    "limits must rise",
    taxErrors({
      brackets: [
        { upTo: 50000, rate: 0.105 },
        { upTo: 40000, rate: 0.175 },
        { upTo: null, rate: 0.39 },
      ],
    }),
    ["brackets.1.upTo"],
  );
  expectEqual(
    "top band is open-ended",
    taxErrors({
      brackets: [
        { upTo: 15600, rate: 0.105 },
        { upTo: 53500, rate: 0.175 },
      ],
    }),
    ["brackets.1.upTo"],
  );
  expectEqual(
    "a middle band needs a limit",
    taxErrors({
      brackets: [
        { upTo: null, rate: 0.105 },
        { upTo: null, rate: 0.39 },
      ],
    }),
    ["brackets.0.upTo"],
  );
  expectEqual("rate is a fraction", taxErrors({ brackets: [{ upTo: null, rate: 39 }] }), [
    "brackets.0.rate",
  ]);
  expectEqual(
    "one open-ended band is fine",
    taxErrors({ brackets: [{ upTo: null, rate: 0.2 }] }),
    [],
  );
  // A thrown TypeError would surface as a 500 from the settings route, so record it as
  // a result instead of letting it end the run.
  let nullBand: string[] | string;
  try {
    nullBand = taxErrors({
      brackets: [null, { upTo: null, rate: 0.39 }] as unknown as TaxSettings["brackets"],
    });
  } catch (err) {
    nullBand = `threw: ${(err as Error).message}`;
  }
  expectEqual("a null band is a field error, not a crash", nullBand, ["brackets"]);

  console.log("\nIETC:");
  expectEqual(
    "full-credit limit above the cut-off",
    taxErrors({ ietc: { ...ietc, fullTo: 80000 } }),
    ["ietc.cutoff"],
  );
  expectEqual("abatement is per dollar", taxErrors({ ietc: { ...ietc, abatementPerDollar: 13 } }), [
    "ietc.abatementPerDollar",
  ]);
  expectEqual(
    "enabled is on or off",
    taxErrors({ ietc: { ...ietc, enabled: "yes" as unknown as boolean } }),
    ["ietc.enabled"],
  );

  console.log("\nThresholds, fuel and business use:");
  expectEqual("negative low-value limit", taxErrors({ lowValueThreshold: -1 }), [
    "lowValueThreshold",
  ]);
  expectEqual("negative provisional threshold", taxErrors({ provisionalThreshold: -5 }), [
    "provisionalThreshold",
  ]);
  expectEqual("unknown fuel", taxErrors({ vehicleFuel: "lpg" as unknown as VehicleFuel }), [
    "vehicleFuel",
  ]);
  expectEqual(
    "business use is 0-100",
    taxErrors({ categoryBusinessUse: { Fuel: 50, "Phone/Internet": 120 } }),
    ["categoryBusinessUse.Phone/Internet"],
  );
  expectEqual(
    "business use is an object",
    taxErrors({ categoryBusinessUse: [] as unknown as Record<string, number> }),
    ["categoryBusinessUse"],
  );

  console.log("\nGST registered from:");
  expectEqual("blank = from the business start", pricingErrors({ gstRegisteredFrom: "" }), []);
  expectEqual("a real date", pricingErrors({ gstRegisteredFrom: "2026-11-01" }), []);
  expectEqual("an impossible date", pricingErrors({ gstRegisteredFrom: "2026-02-30" }), [
    "gstRegisteredFrom",
  ]);
  expectEqual("NZ-style date text", pricingErrors({ gstRegisteredFrom: "1/11/2026" }), [
    "gstRegisteredFrom",
  ]);
  expectEqual("not a string", pricingErrors({ gstRegisteredFrom: 5 as unknown as string }), [
    "gstRegisteredFrom",
  ]);

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
