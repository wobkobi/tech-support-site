// scripts/check-surcharge-copy.ts
// Weekend, holiday and after-hours surcharge rules and copy, the offline holiday fallback and the
// public rate filter: the stated rise matches what calcJobTotal bills under a promo, the eves are
// named as holiday rates (not public holidays), a weekend public holiday bills on its weekday
// off, after hours starts on its hour (6pm counts), and admin-only modifiers never reach the
// public.
// Run with: npm test -- surcharge-copy

import { slotSurcharge } from "@/features/booking/lib/booking";
import { calcJobTotal, type JobPromo } from "@/features/business/lib/business";
import {
  holidayTakenOn,
  offlineHoliday,
  SURCHARGED_OBSERVANCES,
} from "@/features/business/lib/holiday-calendar";
import {
  afterHoursCopy,
  dateSurcharge,
  dateSurchargeNote,
  eveningTickLabel,
  publicHolidayCopy,
  quoteSurchargeNote,
  surchargeCaveat,
  upliftPercent,
  weekendCopy,
  type PricedDateSurcharge,
} from "@/features/business/lib/pricing-policy";

import type { CachedRateRow } from "@/features/business/lib/pricing-policy.server";
import { roundCents } from "@/shared/lib/money";
import { registerHooks } from "node:module";
import { expect, expectEqual, finish } from "./lib/harness.js";

// pricing-policy.server.ts sits behind `server-only`, which throws outside a react-server
// build; stub it so the pure rate filter can load without Next.
registerHooks({
  /**
   * Resolves `server-only` to an empty module and leaves every other import alone.
   * @param specifier - The import being resolved.
   * @param context - Node's resolve context, passed through.
   * @param nextResolve - The next resolver in the chain.
   * @returns The empty module for `server-only`, else the default resolution.
   */
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const WEEKEND: PricedDateSurcharge = {
  reason: "Weekend",
  label: "Weekend surcharge",
  uplift: 0.1,
  perHour: 10,
  perHourRemote: 9,
};
const CHRISTMAS_EVE: PricedDateSurcharge = {
  reason: "Christmas Eve",
  label: "Public holiday surcharge",
  uplift: 0.25,
  perHour: 25,
  perHourRemote: 22.5,
};
const AFTER_HOURS: PricedDateSurcharge = {
  reason: "After hours",
  label: "After-hours surcharge",
  uplift: 0.1,
  perHour: 10,
  perHourRemote: 9,
};
// The live defaults: weekend +10%, holiday +25%, after hours from 6pm.
const RULES = { weekendUplift: 0.1, publicHolidayUplift: 0.25, afterHoursFromHour: 18 };

// A $65/hr flat promo, the kind that made a "10% more" note read as $6.50 instead of $10.
const FLAT_PROMO: JobPromo = {
  discountType: "flat_hourly",
  flatHourlyRate: 65,
  percentDiscount: null,
};

/**
 * Bills one hour of Standard labour at $100/hr under the flat promo.
 * @param surchargeUplift - Date surcharge as a fraction (0 for a weekday).
 * @returns The job total.
 */
function oneHourTotal(surchargeUplift: number): number {
  const job = {
    durationMins: 60,
    tasks: [
      {
        rateConfigId: null,
        baseRateId: "base",
        modifierIds: [],
        description: "Task",
        qty: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
    ],
    parts: [],
    travelEntries: [],
    notes: "",
  } as unknown as Parameters<typeof calcJobTotal>[0];
  const pricing = {
    gstRegistered: false,
    minTravelCharge: 0,
    minBillableMins: 0,
    standardRate: 100,
    surchargeUplift,
  };
  return calcJobTotal(job, FLAT_PROMO, pricing).total;
}

/** Runs every fixture group and exits non-zero on any failure. */
async function main(): Promise<void> {
  console.log("Stated rise matches the bill under a promo:");
  const weekendRise = roundCents(oneHourTotal(0.1) - oneHourTotal(0));
  const holidayRise = roundCents(oneHourTotal(0.25) - oneHourTotal(0));
  expectEqual("weekend adds $10/hr to a $65 promo hour", weekendRise, roundCents(100 * 0.1));
  expectEqual("a holiday adds $25/hr to a $65 promo hour", holidayRise, roundCents(100 * 0.25));
  expect(
    "the weekend note states that rise, not a percent of the promo rate",
    dateSurchargeNote(WEEKEND).includes(`$${weekendRise}/hr more`),
    dateSurchargeNote(WEEKEND),
  );

  console.log("\nDay-picker note:");
  expectEqual(
    "weekend, with the remote figure",
    dateSurchargeNote(WEEKEND),
    "Weekend rates: labour costs $10/hr more ($9/hr remote)",
  );
  expectEqual(
    "Christmas Eve says holiday rates, not public holiday",
    dateSurchargeNote(CHRISTMAS_EVE),
    "Christmas Eve: holiday rates, labour costs $25/hr more ($22.50/hr remote)",
  );
  expectEqual(
    "remote figure dropped when it matches",
    dateSurchargeNote({ ...WEEKEND, perHourRemote: 10 }),
    "Weekend rates: labour costs $10/hr more",
  );
  expectEqual(
    "unpriced surcharge falls back to a share of the full rate",
    dateSurchargeNote({ reason: "Weekend", label: "Weekend surcharge", uplift: 0.125 }),
    "Weekend rates: labour costs an extra 12.5% of the full hourly rate",
  );
  expectEqual(
    "estimate line calls a holiday a holiday surcharge",
    quoteSurchargeNote(CHRISTMAS_EVE),
    "Includes the 25% holiday surcharge on labour.",
  );
  expectEqual(
    "the evening tick names the hour and the rise",
    eveningTickLabel(AFTER_HOURS, 18),
    "Show evening times: from 6pm, labour costs $10/hr more ($9/hr remote)",
  );
  expectEqual(
    "an unpriced evening tick falls back to a share of the full rate",
    eveningTickLabel({ reason: "After hours", label: "After-hours surcharge", uplift: 0.1 }, 18),
    "Show evening times: from 6pm, labour costs an extra 10% of the full hourly rate",
  );
  expectEqual(
    "estimate line calls after hours after-hours",
    quoteSurchargeNote(AFTER_HOURS),
    "Includes the 10% after-hours surcharge on labour.",
  );

  console.log("\nWhich surcharge a job bills:");
  // 28 Oct 2026 is a Wednesday, 31 Oct a Saturday.
  expectEqual(
    "a weekday 5:45pm start bills normal rates",
    dateSurcharge(null, 3, RULES, 17 * 60 + 45),
    null,
  );
  expectEqual(
    "a weekday 6pm start bills after hours",
    dateSurcharge(null, 3, RULES, 18 * 60)?.reason,
    "After hours",
  );
  expectEqual("an unknown start bills no after hours", dateSurcharge(null, 3, RULES, null), null);
  expectEqual(
    "a Saturday evening stays weekend",
    dateSurcharge(null, 6, RULES, 19 * 60)?.reason,
    "Weekend",
  );
  expectEqual(
    "a holiday evening stays holiday",
    dateSurcharge("Labour Day", 1, RULES, 19 * 60)?.reason,
    "Labour Day",
  );
  expectEqual(
    "after hours off bills normal rates",
    dateSurcharge(null, 3, { ...RULES, afterHoursFromHour: null }, 19 * 60),
    null,
  );
  expectEqual(
    "a 0% weekend rate leaves evenings at normal rates",
    dateSurcharge(null, 3, { ...RULES, weekendUplift: 0 }, 19 * 60),
    null,
  );
  const weekday = { surcharge: null, afterHours: { fromHour: 18, surcharge: AFTER_HOURS } };
  expectEqual(
    "the booking slot at 5:45pm bills nothing",
    slotSurcharge(weekday, 17 * 60 + 45),
    null,
  );
  expectEqual(
    "the booking slot at 6pm bills after hours",
    slotSurcharge(weekday, 18 * 60),
    AFTER_HOURS,
  );
  expectEqual("no slot picked bills nothing", slotSurcharge(weekday, null), null);
  expectEqual(
    "a weekend slot bills the day's own surcharge",
    slotSurcharge({ surcharge: WEEKEND, afterHours: null }, 19 * 60),
    WEEKEND,
  );

  console.log("\nPricing page copy:");
  const holidayCopy = publicHolidayCopy(0.25, 100);
  for (const { name } of SURCHARGED_OBSERVANCES) {
    expect(`holiday copy names ${name}`, holidayCopy.includes(name), holidayCopy);
  }
  expect(
    "holiday copy names Auckland Anniversary Day",
    holidayCopy.includes("Auckland Anniversary Day"),
  );
  expect("holiday copy states $25/hr", holidayCopy.includes("$25/hr"), holidayCopy);
  expect("12.5% isn't rounded to 13%", weekendCopy(0.125).includes("12.5%"), weekendCopy(0.125));
  expect(
    "a 0% holiday rate says the eves at a weekend bill normal rates",
    weekendCopy(0.1, 100, 0).includes("normal rates"),
    weekendCopy(0.1, 100, 0),
  );
  expect(
    "a holiday rate says the two never add together",
    weekendCopy(0.1, 100, 0.25).includes("never add together"),
  );

  console.log("\nWeekday caveat:");
  expectEqual(
    "both on, in dollars at the remote rate",
    surchargeCaveat({ weekendUplift: 0.1, publicHolidayUplift: 0.25 }, 90),
    "Weekends add $9/hr to labour, and public holidays add $22.50/hr, as do Christmas Eve and New Year's Eve.",
  );
  expectEqual(
    "percents when no rate is given",
    surchargeCaveat({ weekendUplift: 0.1, publicHolidayUplift: 0.25 }),
    "Weekends add 10% to labour, and public holidays add 25%, as do Christmas Eve and New Year's Eve.",
  );
  expectEqual(
    "weekend only",
    surchargeCaveat({ weekendUplift: 0.1, publicHolidayUplift: 0 }, 100),
    "Weekends add $10/hr to labour.",
  );
  expectEqual(
    "holiday only",
    surchargeCaveat({ weekendUplift: 0, publicHolidayUplift: 0.25 }, 100),
    "Public holidays add $25/hr to labour, as do Christmas Eve and New Year's Eve.",
  );
  expectEqual(
    "both off says nothing",
    surchargeCaveat({ weekendUplift: 0, publicHolidayUplift: 0 }, 100),
    null,
  );
  expectEqual(
    "after hours joins the weekend subject",
    surchargeCaveat(RULES, 100),
    "Weekends and weekday visits starting from 6pm add $10/hr to labour, and public holidays add $25/hr, as do Christmas Eve and New Year's Eve.",
  );
  expectEqual(
    "after hours with the weekend rate alone",
    surchargeCaveat({ ...RULES, publicHolidayUplift: 0 }, 100),
    "Weekends and weekday visits starting from 6pm add $10/hr to labour.",
  );

  console.log("\nAfter-hours pricing copy:");
  expectEqual(
    "names the hour, the rise in dollars and the booking tick",
    afterHoursCopy(18, 0.1, 100),
    "Weekday visits starting from **6pm** add **10% of the full hourly rate** to labour (**$10/hr** for an on-site visit). To book one online, tick **Show evening times** when you choose a start time. **Travel and parts are unchanged.**",
  );
  expectEqual("upliftPercent keeps a half percent", upliftPercent(0.125), 12.5);
  expectEqual("upliftPercent drops float noise", upliftPercent(0.07), 7);

  console.log("\nOffline holiday fallback agrees with the cron's table:");
  expectEqual("Christmas Eve 2026", offlineHoliday("2026-12-24"), {
    name: "Christmas Eve",
    region: "NZ",
  });
  expectEqual("New Year's Eve 2027", offlineHoliday("2027-12-31"), {
    name: "New Year's Eve",
    region: "NZ",
  });
  expectEqual("Christmas Day stays a public holiday", offlineHoliday("2026-12-25"), {
    name: "Christmas Day",
    region: "NZ",
  });
  expectEqual("Auckland Anniversary Day is named", offlineHoliday("2026-01-26"), {
    name: "Auckland Anniversary Day",
    region: "Auckland",
  });
  expectEqual("Auckland Anniversary Day follows its Monday rule", offlineHoliday("2027-02-01"), {
    name: "Auckland Anniversary Day",
    region: "Auckland",
  });
  expectEqual("an ordinary day is no holiday", offlineHoliday("2026-12-23"), null);
  expectEqual("a malformed key is no holiday", offlineHoliday("not-a-date"), null);

  console.log("\nA weekend public holiday bills on its weekday off:");
  expectEqual(
    "ANZAC Day on Sat 25 Apr 2026 is taken Mon 27",
    holidayTakenOn("2026-04-25"),
    "2026-04-27",
  );
  expectEqual("the Monday itself isn't moved again", holidayTakenOn("2026-04-27"), null);
  expectEqual(
    "Boxing Day on Sat 26 Dec 2026 is taken Mon 28",
    holidayTakenOn("2026-12-26"),
    "2026-12-28",
  );
  expectEqual("Christmas on a Friday stays put", holidayTakenOn("2026-12-25"), null);
  expectEqual(
    "Christmas on Sat 25 Dec 2027 is taken Mon 27",
    holidayTakenOn("2027-12-25"),
    "2027-12-27",
  );
  expectEqual(
    "Boxing Day on Sun 26 Dec 2027 is taken Tue 28",
    holidayTakenOn("2027-12-26"),
    "2027-12-28",
  );
  expectEqual(
    "New Year's Day on Sat 1 Jan 2028 is taken Mon 3",
    holidayTakenOn("2028-01-01"),
    "2028-01-03",
  );
  expectEqual(
    "Waitangi Day on Sun 6 Feb 2028 is taken Mon 7",
    holidayTakenOn("2028-02-06"),
    "2028-02-07",
  );
  expectEqual("Waitangi Day on a Friday stays put", holidayTakenOn("2026-02-06"), null);
  expectEqual("Christmas Eve on a weekend isn't moved", holidayTakenOn("2028-12-24"), null);
  expectEqual("a malformed key isn't moved", holidayTakenOn("not-a-date"), null);
  expect(
    "the pricing copy says a weekend holiday bills weekend rates on the day",
    weekendCopy(0.1, 100, 0.25).includes("weekend rates on the day") &&
      publicHolidayCopy(0.25, 100).includes("weekday it's observed"),
    `${weekendCopy(0.1, 100, 0.25)}\n        ${publicHolidayCopy(0.25, 100)}`,
  );

  console.log("\nPublic rate filter:");
  const { toPublicRates } = await import("@/features/business/lib/pricing-policy.server");
  /**
   * Builds a cached rate row with only the fields the filter reads set.
   * @param label - Rate label, as stored.
   * @param unit - "hour" for a base rate, "modifier" for a modifier.
   * @param hourlyDelta - Modifier's $/hr change, or null.
   * @returns The rate row.
   */
  const row = (label: string, unit: string, hourlyDelta: number | null): CachedRateRow => ({
    label,
    ratePerHour: unit === "hour" ? 100 : null,
    flatRate: null,
    hourlyDelta,
    percentDelta: null,
    unit,
    isDefault: unit === "hour",
    updatedAt: null,
  });
  const publicLabels = toPublicRates([
    row("Standard", "hour", null),
    row("At home", "modifier", -30),
    row("Remote", "modifier", -10),
    row("Phone", "modifier", -35),
    row("Business", "modifier", 40),
    row("After hours / weekend", "modifier", 20),
    row("Public Holiday", "modifier", null),
  ]).map((r) => r.label);
  expectEqual("only the rate and the listed modifiers go out", publicLabels, [
    "Standard",
    "At home",
    "Remote",
    "Phone",
  ]);

  finish();
}

void main();
