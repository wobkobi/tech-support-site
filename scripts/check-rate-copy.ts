// scripts/check-rate-copy.ts
// Public rate copy and the estimate band's minimum-charge floor: the rate list and sentences
// quote every rate (not one flat figure), and an estimate's low end never drops under what the
// minimum billable time bills at that rate.
// Run with: npm test -- rate-copy

import { priceRangeFor } from "@/features/business/lib/estimate-range";
import {
  RATE_SLOT,
  rateSentencesCopy,
  ratesListCopy,
  type RateCopyLine,
} from "@/features/business/lib/pricing-policy";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { expect, expectEqual, finish } from "./lib/harness.js";

const onSite: RateCopyLine = {
  price: 100,
  shortPhrase: "at your place",
  sentence: `Work at your place is ${RATE_SLOT}.`,
};
const remote: RateCopyLine = {
  price: 75,
  shortPhrase: "remote or by phone",
  sentence: `Remote or phone help is ${RATE_SLOT}.`,
};
const takeAway: RateCopyLine = {
  price: 70,
  shortPhrase: "for work I take away",
  sentence: `Bigger jobs I take back to my place, like data recovery or hardware repairs, are ${RATE_SLOT}.`,
};

console.log("Rate list and sentences");
expectEqual(
  "three rates read as one list",
  ratesListCopy([onSite, remote, takeAway]),
  "$100/hr at your place, $75/hr remote or by phone and $70/hr for work I take away",
);
expectEqual(
  "two rates join with and",
  ratesListCopy([onSite, remote]),
  "$100/hr at your place and $75/hr remote or by phone",
);
expectEqual("one rate stands alone", ratesListCopy([onSite]), "$100/hr at your place");
expectEqual("no rates is empty", ratesListCopy([]), "");
expectEqual(
  "a promo's cents show in full",
  ratesListCopy([{ ...onSite, price: 85.5 }]),
  "$85.50/hr at your place",
);
expectEqual(
  "sentences fill the figure in each",
  rateSentencesCopy([onSite, remote, takeAway]),
  "Work at your place is $100/hr. Remote or phone help is $75/hr. Bigger jobs I take back to my place, like data recovery or hardware repairs, are $70/hr.",
);

console.log("Estimate band floors at the minimum charge");
const { range, lowEndFloorFactor } = DEFAULT_SETTINGS.estimator;
for (const confidence of ["high", "medium", "low"] as const) {
  for (const [rate, minCharge] of [
    [100, 50],
    [75, 40],
    [70, 35],
    [85.5, 45],
  ] as const) {
    const band = priceRangeFor(30, rate, confidence, range, lowEndFloorFactor, 30);
    expect(
      `${confidence}, $${rate}/hr, 30 min: low ${band.low} >= ${minCharge}, high ${band.high} >= low + spread`,
      band.low >= minCharge && band.high >= band.low + range.minSpread,
    );
  }
}
expectEqual(
  "30 min on site at $100 starts at the $50 minimum",
  priceRangeFor(30, 100, "high", range, lowEndFloorFactor, 30),
  { low: 50, high: 70 },
);
expectEqual(
  "remote's $37.50 minimum rounds up to the next $5",
  priceRangeFor(30, 75, "low", range, lowEndFloorFactor, 30).low,
  40,
);
expectEqual(
  "a long job's band is untouched by the floor",
  priceRangeFor(120, 100, "medium", range, lowEndFloorFactor, 30),
  priceRangeFor(120, 100, "medium", range, lowEndFloorFactor),
);
expectEqual(
  "no minimum keeps the plain band",
  priceRangeFor(30, 100, "high", range, lowEndFloorFactor, 0),
  { low: 40, high: 60 },
);

finish();
