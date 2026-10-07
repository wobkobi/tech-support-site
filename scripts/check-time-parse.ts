// scripts/check-time-parse.ts
// How the job calculator reads times. The description's ranges become the billed
// session, and the parse reply's start/end/duration become the window the tasks are
// fitted to, so a misread here changes what an invoice charges for labour.
// Run with: npm run check:time-parse

import {
  buildParseInput,
  parsedJobToLineItems,
  parsedWindow,
} from "@/features/business/lib/parse-hydrate";
import { extractRanges, statesTimeRange } from "@/features/business/lib/time-parse";
import type { ParseJobResponse } from "@/features/business/types/business";

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
 * Re-parses a booked invoice whose description adds $5 parking and never mentions the
 * drive, and reads back the travel line.
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
    { minBillableMins: 60, travelRatePerHour: 60, minTravelCharge: 10, holidayUplift: 0 },
    {
      line: { description: line, qty: 1, unitPrice: lineTotal, lineTotal },
      destination: "1 Queen St",
    },
  ).lineItems.find((l) => l.description.startsWith("Round-trip travel"))?.lineTotal;
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

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
