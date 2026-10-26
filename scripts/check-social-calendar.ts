// scripts/check-social-calendar.ts
// Social calendar: month grids at their edges (a leap February included), weeks and steps,
// headings, times across daylight saving, where drops land, statuses, colours and the key, the
// figures, reading the address, and the CSV download. Pure logic, no DB.
// Run with: npm test -- social-calendar

import {
  atMinute,
  CALENDAR_STATUS,
  calendarStatus,
  canMove,
  colourOf,
  dropMinute,
  entriesByDay,
  legendOf,
  mondayKey,
  monthGrid,
  onDay,
  rangeStats,
  readColourMode,
  readDayKey,
  readView,
  stepKey,
  timeOfDay,
  viewDays,
  viewTitle,
  weekHours,
  weekKeys,
  type CalendarEntry,
  type ColourContext,
} from "@/features/social/lib/calendar";
import { calendarCsv, calendarCsvName } from "@/features/social/lib/calendar-csv";
import { calendarHref } from "@/features/social/lib/links";
import { POST_STATUS_PILL } from "@/features/social/lib/post-display";
import type { SocialPostStatus } from "@/features/social/lib/post-row";
import { expect, expectEqual, finish } from "./lib/harness.js";

const Q1 = "6650a1b2c3d4e5f6a7b8c9e1";
const TAG = "6650a1b2c3d4e5f6a7b8c9f1";

/**
 * A test entry: a scheduled Facebook post unless told otherwise.
 * @param over - Fields to change.
 * @returns The entry.
 */
function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "post-1",
    at: "2026-10-21T20:00:00.000Z",
    status: "scheduled",
    name: "Tip",
    format: "feed",
    text: "Back up your phone.",
    platforms: ["facebook"],
    queueId: null,
    sourceId: null,
    tagIds: [],
    thumb: null,
    later: false,
    views: null,
    ...over,
  };
}

const CTX: ColourContext = {
  queues: new Map([[Q1, { name: "Weekday tips", colour: "orange" }]]),
  tags: new Map([[TAG, { name: "Scams", colour: "violet" }]]),
};

/** Month grids, weeks, steps and headings. */
function checkDays(): void {
  console.log("Days");
  const oct = monthGrid("2026-10-22");
  expectEqual("Oct 2026 starts on Mon 28 Sep", oct[0]![0], "2026-09-28");
  expectEqual("Oct 2026 takes 5 rows", oct.length, 5);
  expectEqual("Oct 2026 ends on Sun 1 Nov", oct[4]![6], "2026-11-01");
  expectEqual("Feb 2027 (starts Monday, 28 days) takes 4 rows", monthGrid("2027-02-10").length, 4);
  const feb28 = monthGrid("2028-02-01");
  expectEqual("Feb 2028 starts on Mon 31 Jan", feb28[0]![0], "2028-01-31");
  expectEqual("Feb 2028 takes 5 rows", feb28.length, 5);
  expectEqual("Feb 2028's last row holds the 29th", feb28[4]!.slice(0, 3), [
    "2028-02-28",
    "2028-02-29",
    "2028-03-01",
  ]);
  expectEqual("Nov 2026 (starts Sunday) takes 6 rows", monthGrid("2026-11-05").length, 6);
  expect(
    "every row is a Monday-first week",
    [...oct, ...feb28].every((row) => row.length === 7 && mondayKey(row[0]!) === row[0]),
  );

  expectEqual("Monday of a Thursday", mondayKey("2026-10-22"), "2026-10-19");
  expectEqual("Monday of a Monday", mondayKey("2026-10-19"), "2026-10-19");
  expectEqual("Monday of a Sunday", mondayKey("2026-10-25"), "2026-10-19");
  expectEqual("week across a year end", weekKeys("2027-01-01")[0], "2026-12-28");

  expectEqual("month view days", viewDays("month", "2026-10-22"), {
    from: "2026-09-28",
    to: "2026-11-01",
  });
  expectEqual("week view days", viewDays("week", "2026-10-22"), {
    from: "2026-10-19",
    to: "2026-10-25",
  });
  expectEqual("day view days", viewDays("day", "2026-10-22"), {
    from: "2026-10-22",
    to: "2026-10-22",
  });

  expectEqual("month on goes to the 1st", stepKey("month", "2026-10-22", 1), "2026-11-01");
  expectEqual("month back from the 31st", stepKey("month", "2026-01-31", -1), "2025-12-01");
  expectEqual("month on over a year end", stepKey("month", "2026-12-15", 1), "2027-01-01");
  expectEqual("week on", stepKey("week", "2026-10-22", 1), "2026-10-29");
  expectEqual("day back", stepKey("day", "2026-10-01", -1), "2026-09-30");
  expectEqual("the grid doesn't step", stepKey("grid", "2026-10-22", 1), "2026-10-22");

  expectEqual("month heading", viewTitle("month", "2026-10-22"), "October 2026");
  expectEqual("week heading", viewTitle("week", "2026-10-22"), "19-25 Oct 2026");
  expectEqual("week heading across months", viewTitle("week", "2026-10-29"), "26 Oct - 1 Nov 2026");
  expectEqual(
    "week heading across years",
    viewTitle("week", "2026-12-30"),
    "28 Dec 2026 - 3 Jan 2027",
  );
  expectEqual("day heading", viewTitle("day", "2026-10-22"), "Thursday 22 October 2026");
  expectEqual("grid heading", viewTitle("grid", "2026-10-22"), "Instagram grid");
}

/** NZ times of day across daylight saving, and where drops land. */
function checkTimes(): void {
  console.log("Times");
  // Daylight saving starts at 2am on Sun 27 Sep 2026 (+12 > +13).
  expectEqual(
    "9am the day DST starts",
    atMinute("2026-09-27", 540).toISOString(),
    "2026-09-26T20:00:00.000Z",
  );
  expectEqual(
    "9am the day before",
    atMinute("2026-09-26", 540).toISOString(),
    "2026-09-25T21:00:00.000Z",
  );
  expectEqual(
    "dragging 9am Saturday to Sunday keeps 9am",
    onDay(new Date("2026-09-25T21:00:00.000Z"), "2026-09-27").toISOString(),
    "2026-09-26T20:00:00.000Z",
  );
  // It ends at 3am on Sun 4 Apr 2027 (+13 > +12).
  expectEqual(
    "9am the day DST ends",
    atMinute("2027-04-04", 540).toISOString(),
    "2027-04-03T21:00:00.000Z",
  );
  expectEqual(
    "dragging 9am Saturday to Sunday as DST ends keeps 9am",
    onDay(new Date("2027-04-02T20:00:00.000Z"), "2027-04-04").toISOString(),
    "2027-04-03T21:00:00.000Z",
  );
  expectEqual("time of day in NZ", timeOfDay("2026-10-21T20:00:00.000Z"), "9:00am");

  const byDay = entriesByDay([
    entry({ id: "late", at: "2026-10-22T09:00:00.000Z", name: "B" }),
    entry({ id: "just-after-midnight", at: "2026-10-21T11:30:00.000Z", name: "A" }),
    entry({ id: "early", at: "2026-10-21T20:00:00.000Z", name: "C" }),
  ]);
  expectEqual(
    "00:30 NZ goes on the NZ day, in time order",
    byDay.get("2026-10-22")?.map((e) => e.id),
    ["just-after-midnight", "early", "late"],
  );

  const hours = { start: 6, end: 22 };
  expectEqual("drop at the top is 6am", dropMinute(0, 1, hours), 360);
  expectEqual("drop snaps to 15 minutes", dropMinute(187, 1, hours), 540);
  expectEqual("drop above the grid stays at 6am", dropMinute(-50, 1, hours), 360);
  expectEqual("drop below the grid stays at 9:45pm", dropMinute(2000, 1, hours), 1305);
  expectEqual("drop on a half scale", dropMinute(90, 0.5, hours), 540);

  expectEqual("week hours by default", weekHours([]), { start: 6, end: 22 });
  expectEqual(
    "week hours widen to fit",
    weekHours([
      entry({ at: "2026-10-21T16:30:00.000Z" }), // 5:30am NZ
      entry({ at: "2026-10-22T09:15:00.000Z" }), // 10:15pm NZ
    ]),
    { start: 5, end: 23 },
  );
}

/** Statuses, what can move, colours, the key and the figures. */
function checkLooks(): void {
  console.log("Statuses and colours");
  const statuses = Object.keys(POST_STATUS_PILL) as SocialPostStatus[];
  expectEqual("a draft isn't on the calendar", calendarStatus("draft"), null);
  expectEqual("taking down shows as taken down", calendarStatus("removing"), "removed");
  expect(
    "every other status has a label and colour",
    statuses
      .filter((s) => s !== "draft")
      .every((s) => {
        const c = calendarStatus(s);
        return c !== null && Boolean(CALENDAR_STATUS[c]?.label);
      }),
  );

  const now = new Date("2026-10-21T19:00:00.000Z");
  expect("a scheduled post an hour out can move", canMove(entry(), now));
  expect("one going in 30 seconds can't", !canMove(entry({ at: "2026-10-21T19:00:30.000Z" }), now));
  expect("a posted one can't", !canMove(entry({ status: "posted" }), now));

  expectEqual("status colour", colourOf(entry({ status: "failed" }), "status", CTX), "orange");
  expectEqual("schedule colour", colourOf(entry({ queueId: Q1 }), "schedule", CTX), "orange");
  expectEqual("no schedule is grey", colourOf(entry(), "schedule", CTX), "grey");
  expectEqual("one app", colourOf(entry({ platforms: ["instagram"] }), "app", CTX), "violet");
  expectEqual(
    "several apps",
    colourOf(entry({ platforms: ["facebook", "google"] }), "app", CTX),
    "teal",
  );
  expectEqual(
    "first known tag",
    colourOf(entry({ tagIds: ["6650a1b2c3d4e5f6a7b8c9f9", TAG] }), "tag", CTX),
    "violet",
  );
  expectEqual("no tag is grey", colourOf(entry(), "tag", CTX), "grey");

  const mix = [
    entry({ id: "a", status: "posted", platforms: ["facebook", "instagram"], tagIds: [TAG] }),
    entry({ id: "b", queueId: Q1 }),
    entry({ id: "c", status: "open", queueId: Q1, platforms: ["google"] }),
  ];
  expectEqual("status key leaves out open times", legendOf(mix, "status", CTX), [
    { label: "Scheduled", colour: "blue" },
    { label: "Posted", colour: "teal" },
  ]);
  expectEqual("schedule key", legendOf(mix, "schedule", CTX), [
    { colour: "orange", label: "Weekday tips" },
    { colour: "grey", label: "Not from a schedule" },
  ]);
  expectEqual("app key", legendOf(mix, "app", CTX), [
    { colour: "blue", label: "Facebook" },
    { colour: "teal", label: "More than one app" },
  ]);
  expectEqual("tag key", legendOf(mix, "tag", CTX), [
    { colour: "violet", label: "Scams" },
    { colour: "grey", label: "No tag" },
  ]);

  const stats = rangeStats([
    ...mix,
    entry({ id: "d", status: "failed", views: 40 }),
    entry({ id: "e", status: "removed", views: 2 }),
    entry({ id: "f", status: "open", later: true, platforms: ["google"] }),
  ]);
  expectEqual("figures", stats, {
    scheduled: 1,
    posted: 1,
    problems: 1,
    removed: 1,
    open: 1,
    later: 1,
    byApp: { facebook: 4, instagram: 1, google: 0 },
    views: 42,
    viewed: 2,
  });
}

/** Reading the address, and building it. */
function checkAddress(): void {
  console.log("Address");
  expectEqual("view", readView("week"), "week");
  expectEqual("unknown view", readView("year"), "month");
  expectEqual("repeated view", readView(["week", "day"]), "month");
  expectEqual("colour", readColourMode("tag"), "tag");
  expectEqual("unknown colour", readColourMode(undefined), "status");
  const today = "2026-10-22";
  expectEqual("day", readDayKey("2026-11-03", today), "2026-11-03");
  expectEqual("not a real day", readDayKey("2026-02-30", today), today);
  expectEqual("leap day", readDayKey("2028-02-29", today), "2028-02-29");
  expectEqual("not a leap year", readDayKey("2027-02-29", today), today);
  expectEqual("short year", readDayKey("26-10-01", today), today);

  expectEqual(
    "defaults left out",
    calendarHref({ view: "month", colour: "status" }),
    "/admin/social/calendar",
  );
  expectEqual(
    "everything set",
    calendarHref({ view: "week", date: "2026-10-22", colour: "app" }),
    "/admin/social/calendar?view=week&date=2026-10-22&colour=app",
  );
}

/** The CSV download. */
function checkCsv(): void {
  console.log("CSV");
  const csv = calendarCsv(
    [
      entry({
        id: "b",
        at: "2026-10-22T07:30:00.000Z",
        name: "=SUM(A1)",
        text: 'He said "hi"\nthen left',
        platforms: ["facebook", "instagram"],
        queueId: Q1,
        tagIds: [TAG],
      }),
      entry({
        id: "open:q:1",
        at: "2026-10-21T20:00:00.000Z",
        status: "open",
        name: "Weekday tips",
        text: "",
        queueId: Q1,
        later: true,
      }),
    ],
    CTX,
  );
  expect("starts with a byte-order mark", csv.charCodeAt(0) === 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  expectEqual("header", lines[0], '"Date","Time","Status","Post","Apps","Schedule","Tags","Words"');
  expectEqual(
    "open time first, with no post",
    lines[1],
    '"22/10/2026","9:00am","Fills nearer the time","","Facebook","Weekday tips","",""',
  );
  expect(
    "a formula is defused and quotes doubled",
    csv.includes('"\'=SUM(A1)"') && csv.includes('"He said ""hi""\nthen left"'),
  );
  expect("tags and apps by name", csv.includes('"Facebook, Instagram","Weekday tips","Scams"'));
  expect("ends with a line ending", csv.endsWith("\r\n"));

  expectEqual("month file", calendarCsvName("month", "2026-10-22"), "social-calendar-2026-10.csv");
  expectEqual(
    "week file",
    calendarCsvName("week", "2026-10-22"),
    "social-calendar-week-of-2026-10-19.csv",
  );
  expectEqual("day file", calendarCsvName("day", "2026-10-22"), "social-calendar-2026-10-22.csv");
}

checkDays();
checkTimes();
checkLooks();
checkAddress();
checkCsv();
finish();
