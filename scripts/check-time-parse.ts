// scripts/check-time-parse.ts
// How the job calculator reads times: description ranges become the billed session,
// and the parse reply's times become the task window.
// Run with: npm test -- time-parse

import type { JobPromo } from "@/features/business/lib/business";
import { restatesTaskLine } from "@/features/business/lib/business-format";
import {
  buildParseInput,
  parsedJobToLineItems,
  parsedWindow,
} from "@/features/business/lib/parse-hydrate";
import {
  extractRangeStats,
  extractRanges,
  statesTimeRange,
} from "@/features/business/lib/time-parse";
import type { ParseJobResponse } from "@/features/business/types/business";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * Reads a description's ranges as "HH:MM-HH:MM (minutes)" strings for compact fixtures.
 * @param input - Description text.
 * @returns One string per merged range.
 */
function ranges(input: string): string[] {
  return extractRanges(input).map((r) => `${r.startTime}-${r.endTime} (${r.durationMins})`);
}

/**
 * Builds a parse reply with only the time fields set.
 * @param fields - The time fields to set.
 * @returns A parse reply with no tasks.
 */
function reply(fields: Partial<ParseJobResponse>): ParseJobResponse {
  return {
    durationMins: null,
    startTime: null,
    endTime: null,
    tasks: [],
    parts: [],
    ...fields,
  } as ParseJobResponse;
}

/**
 * Re-parses a booked invoice that adds $5 parking but never mentions the drive.
 * @param line - The invoice's existing travel line description.
 * @param lineTotal - That line's total.
 * @returns The new "Round-trip travel" line total, if any.
 */
function travelTotal(line: string, lineTotal: number): number | undefined {
  const booked = {
    calendarEventId: "e1",
    bookingId: null,
    date: "2026-10-08",
    startTime: "16:30",
    endTime: "17:40",
    summary: "Job",
  };
  return parsedJobToLineItems(
    reply({ travelCosts: [{ label: "Parking", cost: 5 }] }),
    [booked],
    "18:00",
    { minBillableMins: 60, travelRatePerHour: 60, minTravelCharge: 10, surcharge: null },
    {
      line: { description: line, qty: 1, unitPrice: lineTotal, lineTotal },
      destination: "1 Queen St",
    },
  ).lineItems.find((l) => l.description.startsWith("Round-trip travel"))?.lineTotal;
}

/**
 * One pinned hour at $80/hr, as the parse route returns it.
 * @param unsuccessful - Whether the hour's problem was not fixed.
 * @returns The parsed task row.
 */
function parsedHour(unsuccessful: boolean): ParseJobResponse["tasks"][number] {
  return {
    rateConfigId: null,
    baseRateId: "r1",
    description: "Labour",
    minutes: 60,
    qty: 1,
    unitPrice: 80,
    isExplicit: true,
    unsuccessful,
  };
}

/**
 * Re-parses a two-hour unbooked job into two $80/hr hours, the second not fixed.
 * @param factor - Share of an unsuccessful line still charged.
 * @param promo - The invoice's promo terms, or null.
 * @param uplift - Weekend or holiday labour uplift for the job date.
 * @param gold - The invoice's Gold Card share off labour, or 0 for none.
 * @returns The parse's line items and discounts.
 */
function reparse(
  factor: number,
  promo: JobPromo | null,
  uplift = 0,
  gold = 0,
): ReturnType<typeof parsedJobToLineItems> {
  return parsedJobToLineItems(
    reply({ durationMins: 120, tasks: [parsedHour(false), parsedHour(true)] }),
    [],
    "18:00",
    {
      minBillableMins: 60,
      travelRatePerHour: 60,
      minTravelCharge: 10,
      surcharge: uplift > 0 ? { label: "Weekend surcharge", uplift } : null,
      unsuccessfulFactor: factor,
      standardRate: 80,
      goldCardPercent: gold,
    },
    { line: null, destination: null },
    promo,
  );
}

/**
 * {@link reparse}'s promo and unsuccessful-work discounts.
 * @param factor - Share of an unsuccessful line still charged.
 * @param promo - The invoice's promo terms, or null.
 * @param uplift - Weekend or holiday labour uplift for the job date.
 * @returns The promo and unsuccessful-work discounts for the new lines.
 */
function repriced(
  factor: number,
  promo: JobPromo | null,
  uplift = 0,
): { promoDiscount: number; unsuccessfulDiscount: number } {
  const { promoDiscount, unsuccessfulDiscount } = reparse(factor, promo, uplift);
  return { promoDiscount, unsuccessfulDiscount };
}

/**
 * {@link reparse} on a 10% Gold Card invoice, at half price for the unfixed hour.
 * @param promo - The invoice's promo terms, or null.
 * @returns All three discounts for the new lines.
 */
function repricedGold(promo: JobPromo | null): {
  promoDiscount: number;
  goldCardDiscount: number;
  unsuccessfulDiscount: number;
} {
  const { promoDiscount, goldCardDiscount, unsuccessfulDiscount } = reparse(0.5, promo, 0, 0.1);
  return { promoDiscount, goldCardDiscount, unsuccessfulDiscount };
}

/**
 * Promo terms for the fixtures.
 * @param terms - The discount fields that differ from none.
 * @returns A promo with only those terms set.
 */
function terms(terms: Partial<JobPromo>): JobPromo {
  return { flatHourlyRate: null, percentDiscount: null, ...terms };
}

/** Runs every fixture and exits non-zero on any failure. */
function main(): void {
  console.log("Reading ranges from a description");
  expectEqual("4.30-5.40 reads as the afternoon", ranges("4.30-5.40"), ["16:30-17:40 (70)"]);
  expectEqual("9-11 reads as the morning", ranges("9-11"), ["09:00-11:00 (120)"]);
  expectEqual("11-1pm runs late morning to 1pm", ranges("11-1pm"), ["11:00-13:00 (120)"]);
  expectEqual("10:30-12:30pm stays daytime", ranges("10:30-12:30pm"), ["10:30-12:30 (120)"]);
  expectEqual("9-1pm stays daytime", ranges("9-1pm"), ["09:00-13:00 (240)"]);
  expectEqual("11-1am runs overnight", ranges("11-1am"), ["23:00-01:00 (120)"]);
  expectEqual("2pm-9am with both stated runs overnight", ranges("2pm-9am"), ["14:00-09:00 (1140)"]);
  expectEqual("zero-padded 06:00-08:00 is 24-hour", ranges("06:00-08:00"), ["06:00-08:00 (120)"]);
  expectEqual("zero-padded 00:30-01:30 is 24-hour", ranges("00:30-01:30"), ["00:30-01:30 (60)"]);
  expectEqual("compact 0900-1100", ranges("0900-1100"), ["09:00-11:00 (120)"]);
  expectEqual("prose-led line is not read", ranges("Fixed printer 9-11"), []);
  expectEqual("dashed date is not a range", ranges("2026-08-25 printer"), []);
  expectEqual("undated mid-line range is not read", ranges("TV setup 4:30-5:40"), []);
  expectEqual(
    "mid-line range on a named day is read",
    ranges("MacBook printer set up Friday, 1:46 pm to 2:05 pm"),
    ["13:46-14:05 (19)"],
  );
  expectEqual(
    "a named day in prose opens its own day",
    ranges("Printer on Wednesday, 1:00-2:00pm\nBack Friday, 1:00-2:00pm for the scanner"),
    ["13:00-14:00 (60)", "13:00-14:00 (60)"],
  );
  expectEqual(
    "booked window plus a later named-day visit",
    ranges(
      "2026-10-07\n16:30-17:30\nTV setup\nPrinter setup\n\nMacBook printer set up Friday, 1:46 pm to 2:05 pm",
    ),
    ["16:30-17:30 (60)", "13:46-14:05 (19)"],
  );
  expectEqual(
    "only the later visit is a task-line range",
    extractRangeStats("2026-10-07\n16:30-17:30\nMacBook printer set up Friday, 1:46 pm to 2:05 pm")
      .taskLineRanges,
    [{ startTime: "13:46", endTime: "14:05", durationMins: 19 }],
  );

  console.log("\nWhether a description states its own range");
  expectEqual("mid-line clock range", statesTimeRange("TV setup 4:30-5:40"), true);
  expectEqual("mid-line range with meridiem", statesTimeRange("was there 4-6pm"), true);
  expectEqual("time-line range", statesTimeRange("9-11\nprinter"), true);
  expectEqual("a count is not a range", statesTimeRange("took 2-3 hours"), false);
  expectEqual("a price is not a range", statesTimeRange("cable $50-60"), false);
  expectEqual("a dashed date is not a range", statesTimeRange("on 2026-08-25 fixed it"), false);
  expectEqual("a lone time is not a range", statesTimeRange("drove to PB Tech @ 10:30 am"), false);

  console.log("\nSending a known window with the description");
  const slot = [{ date: "2026-10-08", startTime: "16:30", endTime: "17:40" }];
  expectEqual(
    "no times in the text: window goes first",
    buildParseInput("TV and printer setup", slot),
    "2026-10-08\n16:30-17:40\nTV and printer setup",
  );
  expectEqual(
    "text states its own range: sent as-is",
    buildParseInput("TV setup 4:30-6:00", slot),
    "TV setup 4:30-6:00",
  );
  expectEqual("no window: sent as-is", buildParseInput("TV setup", []), "TV setup");
  // 2026-10-07 is a Wednesday.
  const wednesday = [{ date: "2026-10-07", startTime: "16:30", endTime: "17:30" }];
  const laterVisit =
    "TV setup\nPrinter setup\n\nAlready paid $47.00\n\nMacBook printer set up Friday, 1:46 pm to 2:05 pm";
  expectEqual(
    "times on another named day: window kept alongside them",
    buildParseInput(laterVisit, wednesday),
    `2026-10-07\n16:30-17:30\n${laterVisit}`,
  );
  expectEqual(
    "times on the booked day: sent as-is",
    buildParseInput("Printer setup Wednesday, 4:30-6:00pm", wednesday),
    "Printer setup Wednesday, 4:30-6:00pm",
  );
  expectEqual(
    "one dated and one undated range: sent as-is",
    buildParseInput("TV setup 4:30-5:30\nPrinter Friday, 1:46-2:05pm", wednesday),
    "TV setup 4:30-5:30\nPrinter Friday, 1:46-2:05pm",
  );
  expectEqual(
    "a digit-led line after a named-day visit is not on that day: sent as-is",
    buildParseInput("Printer Friday, 1:46-2:05pm\n9:00-9:45 visit", wednesday),
    "Printer Friday, 1:46-2:05pm\n9:00-9:45 visit",
  );
  expectEqual(
    "re-parse does not send the later visit twice",
    buildParseInput(laterVisit, [
      ...wednesday,
      { date: "2026-10-07", startTime: "13:46", endTime: "14:05" },
    ]),
    `2026-10-07\n16:30-17:30\n${laterVisit}`,
  );

  console.log("\nWindow from a parse reply");
  expectEqual(
    "ranges are stated",
    parsedWindow(
      reply({ ranges: [{ startTime: "16:30", endTime: "17:40", durationMins: 70 }] }),
      [],
      "12:00",
    ),
    {
      timeRanges: [{ startTime: "16:30", endTime: "17:40" }],
      stated: true,
      windowMins: 70,
      followUpMins: 0,
    },
  );
  expectEqual(
    "bare duration builds an unstated window ending now",
    parsedWindow(reply({ durationMins: 120 }), [], "12:00"),
    {
      timeRanges: [{ startTime: "10:00", endTime: "12:00" }],
      stated: false,
      windowMins: 120,
      followUpMins: 0,
    },
  );
  expectEqual(
    "start with no end closes at now",
    parsedWindow(reply({ startTime: "10:00" }), [], "12:00"),
    {
      timeRanges: [{ startTime: "10:00", endTime: "12:00" }],
      stated: false,
      windowMins: 120,
      followUpMins: 0,
    },
  );
  expectEqual(
    "start after now does not roll overnight",
    parsedWindow(reply({ startTime: "15:00", durationMins: 60 }), [], "09:00"),
    {
      timeRanges: [{ startTime: "08:00", endTime: "09:00" }],
      stated: false,
      windowMins: 60,
      followUpMins: 0,
    },
  );
  expectEqual(
    "start after now with no duration sets nothing",
    parsedWindow(reply({ startTime: "15:00" }), [], "09:00"),
    { timeRanges: null, stated: false, windowMins: 0, followUpMins: 0 },
  );
  expectEqual(
    "a non-number duration reads as none",
    parsedWindow(reply({ durationMins: "90" as unknown as number }), [], "12:00"),
    { timeRanges: null, stated: false, windowMins: 0, followUpMins: 0 },
  );
  const twoSlots = [
    { date: "2026-10-08", startTime: "09:00", endTime: "10:00" },
    { date: "2026-10-08", startTime: "14:00", endTime: "15:00" },
  ];
  expectEqual(
    "merged booking keeps its slots",
    parsedWindow(reply({ durationMins: 90 }), twoSlots, "16:00"),
    { timeRanges: null, stated: false, windowMins: 120, followUpMins: 0 },
  );
  expectEqual(
    "merged booking bills a later visit on top of its slots",
    parsedWindow(
      reply({
        durationMins: 139,
        ranges: [
          { startTime: "09:00", endTime: "10:00", durationMins: 60 },
          { startTime: "14:00", endTime: "15:00", durationMins: 60 },
          { startTime: "13:46", endTime: "14:05", durationMins: 19 },
        ],
      }),
      twoSlots,
      "16:00",
    ),
    {
      timeRanges: [
        { startTime: "09:00", endTime: "10:00" },
        { startTime: "14:00", endTime: "15:00" },
        { startTime: "13:46", endTime: "14:05" },
      ],
      stated: false,
      windowMins: 139,
      followUpMins: 0,
    },
  );
  expectEqual(
    "merged booking with restated times keeps only its slots",
    parsedWindow(
      reply({
        durationMins: 80,
        ranges: [{ startTime: "09:00", endTime: "10:20", durationMins: 80 }],
      }),
      twoSlots,
      "16:00",
    ),
    { timeRanges: null, stated: false, windowMins: 120, followUpMins: 0 },
  );
  expectEqual(
    "typed slots are not merged: duration clamps the window",
    parsedWindow(
      reply({
        durationMins: 90,
        ranges: [
          { startTime: "09:00", endTime: "10:00", durationMins: 60 },
          { startTime: "14:00", endTime: "15:00", durationMins: 60 },
        ],
      }),
      twoSlots,
      "16:00",
      false,
    ),
    {
      timeRanges: [
        { startTime: "09:00", endTime: "10:00" },
        { startTime: "14:00", endTime: "15:00" },
      ],
      stated: true,
      windowMins: 90,
      followUpMins: 0,
    },
  );

  console.log("\nRe-parsing an existing invoice's travel");
  expectEqual(
    "measured drive is kept and parking added once",
    travelTotal("Round-trip travel (30 min drive)", 35),
    35,
  );
  expectEqual(
    "a line with no drive is not kept on top of parking",
    travelTotal("Round-trip travel", 15),
    5,
  );

  console.log("\nDiscounts on a re-parsed invoice");
  expectEqual("half price on the unfixed hour", repriced(0.5, null).unsuccessfulDiscount, 40);
  expectEqual("follows the live factor", repriced(0.75, null).unsuccessfulDiscount, 20);
  expectEqual(
    "a kept $32 spreads over the labour, then the unfixed hour is halved",
    repriced(0.5, terms({ discountType: "fixed_amount", fixedAmount: 32 })),
    { promoDiscount: 32, unsuccessfulDiscount: 32 },
  );
  expectEqual(
    "a $65 flat rate re-prices per hour, then the unfixed hour is halved",
    repriced(0.5, terms({ discountType: "flat_hourly", flatHourlyRate: 65 })),
    { promoDiscount: 30, unsuccessfulDiscount: 32.5 },
  );
  expectEqual(
    "free travel takes no share of the labour",
    repriced(0.5, terms({ discountType: "free_travel", travelPercent: 0 })).unsuccessfulDiscount,
    40,
  );
  expectEqual(
    "a +25% day's surcharge on the unfixed hour is halved too",
    repriced(0.5, null, 0.25).unsuccessfulDiscount,
    50,
  );
  expectEqual(
    "a Gold Card invoice takes 10% off, then halves the unfixed hour",
    repricedGold(null),
    {
      promoDiscount: 0,
      goldCardDiscount: 16,
      unsuccessfulDiscount: 36,
    },
  );
  expectEqual(
    "a $65 flat rate, then 10% off, then half",
    repricedGold(terms({ discountType: "flat_hourly", flatHourlyRate: 65 })),
    { promoDiscount: 30, goldCardDiscount: 13, unsuccessfulDiscount: 29.25 },
  );
  expectEqual("no Gold Card on the invoice, no line", reparse(0.5, null).goldCardDiscount, 0);

  console.log("\nDetails that only repeat the line");
  expectEqual(
    "'new printer' on Printer setup",
    restatesTaskLine("new printer", "Printer", "Setup"),
    true,
  );
  expectEqual(
    "'Brand new TVs' on TV setup",
    restatesTaskLine("Brand new TVs", "TV", "Setup"),
    true,
  );
  expectEqual("bare 'new' on a Setup line", restatesTaskLine("new", "Laptop", "Setup"), true);
  expectEqual(
    "'printer setup' on Printer setup",
    restatesTaskLine("printer setup", "Printer", "Setup"),
    true,
  );
  expectEqual(
    "'new Canon printer' keeps the brand",
    restatesTaskLine("new Canon printer", "Printer", "Setup"),
    false,
  );
  expectEqual(
    "'new' is real wording off a Setup line",
    restatesTaskLine("new", "Email account", "Configuration"),
    false,
  );
  expectEqual(
    "'from old laptop' is kept",
    restatesTaskLine("from old laptop", "Laptop", "Data transfer"),
    false,
  );
  expectEqual(
    "multi-word device",
    restatesTaskLine("email account", "Email account", "Troubleshooting"),
    true,
  );

  finish();
}

main();
