// scripts/check-social-queue.ts
// Social schedules: time labels and summaries, where weekly slots land in NZ time across
// daylight saving, which content item fills a slot under each order and rule, what the editor's
// Upcoming list says, and reading a schedule from a request. Pure logic, no DB.
// Run with: npm test -- social-queue

import {
  canFill,
  describeSlots,
  isQueueSlot,
  minuteLabel,
  nextSlotInstants,
  rankCandidates,
  slotInstants,
  slotMinutes,
  slotOf,
  sortSlots,
  upcomingSlots,
  type PickRules,
  type QueueCandidate,
} from "@/features/social/lib/queue-slots";
import { fillSummary, itemHold, parseQueueInput } from "@/features/social/lib/queues";
import { expect, expectEqual, finish } from "./lib/harness.js";

const DAY = 86_400_000;
const ID_A = "6650a1b2c3d4e5f6a7b8c9e1";
const ID_B = "6650a1b2c3d4e5f6a7b8c9e2";

/**
 * Instants as ISO strings, for comparing.
 * @param dates - The instants.
 * @returns ISO strings.
 */
function iso(dates: readonly Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

/** Time labels, the picker's times and the one-line summary. */
function checkLabels(): void {
  console.log("Labels");
  expectEqual("9am", minuteLabel(540), "9:00am");
  expectEqual("noon", minuteLabel(720), "12:00pm");
  expectEqual("12:45pm", minuteLabel(765), "12:45pm");
  expectEqual("earliest", minuteLabel(300), "5:00am");
  expectEqual("latest", minuteLabel(1425), "11:45pm");
  const minutes = slotMinutes();
  expectEqual(
    "picker runs 5:00am to 11:45pm in 15s",
    [minutes[0], minutes.at(-1), minutes.length],
    [300, 1425, 76],
  );

  expectEqual("no times", describeSlots([]), "No times yet");
  /**
   * 9am slots on these days.
   * @param days - Weekday numbers.
   * @returns The slots.
   */
  const at9 = (days: number[]): { weekday: number; minute: number }[] =>
    days.map((weekday) => ({ weekday, minute: 540 }));
  expectEqual("weekdays", describeSlots(at9([5, 1, 2, 3, 4])), "Weekdays at 9:00am");
  expectEqual("every day", describeSlots(at9([0, 1, 2, 3, 4, 5, 6])), "Every day at 9:00am");
  expectEqual("weekends", describeSlots(at9([6, 0])), "Weekends at 9:00am");
  expectEqual(
    "two times of day, Monday first",
    describeSlots([...at9([5, 1, 3]), { weekday: 2, minute: 1170 }]),
    "Mon, Wed, Fri at 9:00am; Tue at 7:30pm",
  );
  expectEqual(
    "Sunday sorts last and repeats drop",
    sortSlots([
      { weekday: 0, minute: 540 },
      { weekday: 1, minute: 600 },
      { weekday: 1, minute: 540 },
      { weekday: 1, minute: 540 },
    ]),
    [
      { weekday: 1, minute: 540 },
      { weekday: 1, minute: 600 },
      { weekday: 0, minute: 540 },
    ],
  );
  expect("a 9am Monday slot is valid", isQueueSlot({ weekday: 1, minute: 540 }));
  expect("before 5am isn't", !isQueueSlot({ weekday: 1, minute: 285 }));
  expect("after 11:45pm isn't", !isQueueSlot({ weekday: 1, minute: 1440 }));
  expect("off the 15-minute steps isn't", !isQueueSlot({ weekday: 1, minute: 541 }));
  expect("weekday 7 isn't", !isQueueSlot({ weekday: 7, minute: 540 }));
  expect("a string isn't", !isQueueSlot("1:540"));
}

/** Where slots land, through both daylight saving changes. */
function checkInstants(): void {
  console.log("Slot times");
  const weekend = [
    { weekday: 6, minute: 540 },
    { weekday: 0, minute: 540 },
  ];
  // Clocks go forward at 2am on Sunday 27 September 2026: Saturday is +12, Sunday +13.
  expectEqual(
    "DST start keeps 9am on both days",
    iso(slotInstants(weekend, new Date("2026-09-25T00:00:00Z"), 3)),
    ["2026-09-25T21:00:00.000Z", "2026-09-26T20:00:00.000Z"],
  );
  // Clocks go back at 3am on Sunday 4 April 2027: Saturday is +13, Sunday +12.
  expectEqual(
    "DST end keeps 9am on both days",
    iso(slotInstants(weekend, new Date("2027-04-02T00:00:00Z"), 3)),
    ["2027-04-02T20:00:00.000Z", "2027-04-03T21:00:00.000Z"],
  );
  expectEqual("slotOf reads NZ time after the change", slotOf(new Date("2026-09-26T20:00:00Z")), {
    weekday: 0,
    minute: 540,
  });

  const monday9 = [{ weekday: 1, minute: 540 }];
  const at = new Date("2026-11-01T20:00:00Z"); // Mon 2 Nov, 9:00am NZDT
  expectEqual("a slot at the start time counts", iso(slotInstants(monday9, at, 1)), [
    at.toISOString(),
  ]);
  expectEqual(
    "a slot a minute before the start doesn't",
    iso(slotInstants(monday9, new Date(at.getTime() + 60_000), 6)),
    [],
  );
  expectEqual("the window's end is left out", slotInstants(monday9, at, 14).length, 2);
  expectEqual("no days, no slots", slotInstants(monday9, at, 0), []);
  expectEqual("no times, no slots", slotInstants([], at, 14), []);
  expectEqual(
    "next 3 run week to week",
    iso(nextSlotInstants(monday9, new Date(at.getTime() - 3_600_000), 3)),
    [at.toISOString(), new Date(at.getTime() + 7 * DAY).toISOString(), "2026-11-15T20:00:00.000Z"],
  );
}

/**
 * A content item as the picker sees it.
 * @param id - Its id.
 * @param over - Fields to change.
 * @returns The candidate.
 */
function cand(id: string, over: Partial<QueueCandidate> = {}): QueueCandidate {
  return {
    id,
    platforms: ["facebook", "google"],
    recycle: true,
    expiresAt: null,
    maxPosts: null,
    times: [],
    ...over,
  };
}

/** Which item fills a slot, under each order and rule. */
function checkPicking(): void {
  console.log("Picking");
  const at = new Date("2026-11-01T20:00:00Z");
  const ms = at.getTime();
  const rules: PickRules = {
    order: "oldest_first",
    itemIds: ["a", "b", "c"],
    platforms: ["facebook", "google"],
    minGapDays: 14,
    lastItemId: null,
  };
  /**
   * The ids a slot's ranking gives.
   * @param cs - The candidates.
   * @param over - Rules to change.
   * @returns Ids, best first.
   */
  const pick = (cs: QueueCandidate[], over: Partial<PickRules> = {}): string[] =>
    rankCandidates(cs, { ...rules, ...over }, at);

  const spread = [
    cand("a", { times: [ms - 30 * DAY] }),
    cand("b"),
    cand("c", { times: [ms - 20 * DAY] }),
  ];
  expectEqual("oldest first: never posted, then longest ago", pick(spread), ["b", "a", "c"]);
  expectEqual(
    "oldest first: a tie goes to the list order",
    pick([cand("c"), cand("b"), cand("a")]),
    ["a", "b", "c"],
  );
  expectEqual("not in the schedule: left out", pick([cand("a"), cand("z")]), ["a"]);

  expect(
    "posted 10 days back: inside a 14-day gap",
    !canFill(cand("a", { times: [ms - 10 * DAY] }), rules, at),
  );
  expect(
    "posted 14 days back: just clear",
    canFill(cand("a", { times: [ms - 14 * DAY] }), rules, at),
  );
  expect(
    "lined up 5 days later: inside the gap too",
    !canFill(cand("a", { times: [ms + 5 * DAY] }), rules, at),
  );
  const noGap = { ...rules, minGapDays: 0 };
  expect("gap 0: posted yesterday is fine", canFill(cand("a", { times: [ms - DAY] }), noGap, at));
  expect("gap 0: never two at once", !canFill(cand("a", { times: [ms] }), noGap, at));
  expect(
    "recycling off and posted: no more",
    !canFill(cand("a", { recycle: false, times: [ms - 60 * DAY] }), rules, at),
  );
  expect("recycling off and never posted: once", canFill(cand("a", { recycle: false }), rules, at));
  expect(
    "at its limit: no more",
    !canFill(cand("a", { maxPosts: 2, times: [ms - 60 * DAY, ms - 40 * DAY] }), rules, at),
  );
  expect(
    "under its limit: fine",
    canFill(cand("a", { maxPosts: 3, times: [ms - 60 * DAY, ms - 40 * DAY] }), rules, at),
  );
  // Last day 1 Nov in NZ; the slot is 2 Nov.
  expect(
    "past its last day: no more",
    !canFill(cand("a", { expiresAt: new Date("2026-11-01T00:00:00Z") }), rules, at),
  );
  expect(
    "on its last day: fine",
    canFill(cand("a", { expiresAt: new Date("2026-11-02T00:00:00Z") }), rules, at),
  );
  expect("no app in common: no", !canFill(cand("a", { platforms: ["instagram"] }), rules, at));
  expect(
    "one app in common: yes",
    canFill(cand("a", { platforms: ["instagram", "google"] }), rules, at),
  );

  const three = [cand("a"), cand("b"), cand("c")];
  expectEqual("in order: from the top", pick(three, { order: "in_order" }), ["a", "b", "c"]);
  expectEqual(
    "in order: after the last one used",
    pick(three, { order: "in_order", lastItemId: "a" }),
    ["b", "c", "a"],
  );
  expectEqual(
    "in order: round to the top after the last",
    pick(three, { order: "in_order", lastItemId: "c" }),
    ["a", "b", "c"],
  );
  expectEqual(
    "in order: skips one that can't go",
    pick([cand("a"), cand("b", { recycle: false, times: [ms - 60 * DAY] }), cand("c")], {
      order: "in_order",
      lastItemId: "a",
    }),
    ["c", "a"],
  );
  expectEqual(
    "in order: a last item since taken out starts at the top",
    pick(three, { order: "in_order", lastItemId: "gone" }),
    ["a", "b", "c"],
  );

  const mixed = pick(three, { order: "shuffle" });
  expectEqual(
    "mixed up: the same slot picks the same way",
    pick(three, { order: "shuffle" }),
    mixed,
  );
  expectEqual("mixed up: every item that can go", [...mixed].sort(), ["a", "b", "c"]);
  expectEqual(
    "mixed up: still keeps the gap",
    pick([cand("a", { times: [ms - DAY] }), cand("b")], { order: "shuffle" }),
    ["b"],
  );
  expectEqual("nothing can go", pick([cand("a", { times: [ms] })]), []);
}

/** What the editor's Upcoming list says for each slot. */
function checkUpcoming(): void {
  console.log("Upcoming");
  const now = new Date("2026-11-01T19:00:00Z"); // Mon 2 Nov, 8:00am NZDT
  const first = new Date("2026-11-01T20:00:00Z");
  const second = new Date(first.getTime() + 7 * DAY);
  const queue = {
    slots: [{ weekday: 1, minute: 540 }],
    paused: false,
    itemIds: ["a"],
    skipped: [second],
  };
  const postings = [
    { id: "p1", name: "Backups", status: "scheduled", scheduledAt: first, captionIndex: 1 },
  ];
  // 15 days ahead reaches the third Monday's 9am but not the fourth's.
  const slots = upcomingSlots(queue, postings, now, 15);
  expectEqual("ten slots", slots.length, 10);
  expectEqual(
    "lined up, taken off by hand, empty, then later",
    slots.slice(0, 4).map((s) => s.state),
    ["lined-up", "skipped", "empty", "later"],
  );
  expectEqual("the lined-up post", slots[0]?.post, {
    id: "p1",
    name: "Backups",
    status: "scheduled",
    captionIndex: 1,
  });
  expectEqual(
    "paused: empty slots say so",
    upcomingSlots({ ...queue, paused: true }, [], now, 14)
      .slice(0, 3)
      .map((s) => s.state),
    ["paused", "skipped", "paused"],
  );
  expectEqual(
    "no content: says so",
    upcomingSlots({ ...queue, itemIds: [], skipped: [] }, [], now, 14)[0]?.state,
    "no-items",
  );
  expectEqual("no times: nothing to show", upcomingSlots({ ...queue, slots: [] }, [], now, 14), []);
}

/** Reading a schedule from a request. */
function checkParse(): void {
  console.log("Parsing");
  expectEqual("a new one needs a name", parseQueueInput({}, false), {
    error: "Give the schedule a name.",
  });
  const made = parseQueueInput({ name: "  Tech   tips " }, false);
  expectEqual("a new one fills in the rest", made, {
    data: {
      name: "Tech tips",
      colour: "violet",
      paused: false,
      platforms: ["facebook", "google"],
      slots: [],
      order: "oldest_first",
      minGapDays: 14,
      itemIds: [],
    },
  });
  expectEqual("a change keeps only what's sent", parseQueueInput({}, true), { data: {} });
  expect("not an object", "error" in parseQueueInput("x", true));
  expect("a blank name", "error" in parseQueueInput({ name: "  " }, true));
  expect("a name too long", "error" in parseQueueInput({ name: "x".repeat(61) }, true));
  expect("an unknown colour", "error" in parseQueueInput({ colour: "pink" }, true));
  expect("no apps", "error" in parseQueueInput({ platforms: [] }, true));
  expect("an unknown app", "error" in parseQueueInput({ platforms: ["tiktok"] }, true));
  expectEqual(
    "apps in the usual order, once each",
    parseQueueInput({ platforms: ["google", "facebook", "google"] }, true),
    { data: { platforms: ["facebook", "google"] } },
  );
  expectEqual(
    "times sorted and repeats dropped",
    parseQueueInput(
      {
        slots: [
          { weekday: 0, minute: 600, extra: 1 },
          { weekday: 2, minute: 540 },
          { weekday: 2, minute: 540 },
        ],
      },
      true,
    ),
    {
      data: {
        slots: [
          { weekday: 2, minute: 540 },
          { weekday: 0, minute: 600 },
        ],
      },
    },
  );
  expect(
    "a time off the steps",
    "error" in parseQueueInput({ slots: [{ weekday: 1, minute: 541 }] }, true),
  );
  const tooMany = Array.from({ length: 29 }, (_, i) => ({ weekday: i % 7, minute: 300 + 15 * i }));
  expect("more than 28 times", "error" in parseQueueInput({ slots: tooMany }, true));
  expect("an unknown order", "error" in parseQueueInput({ order: "random" }, true));
  expect("a part-day gap", "error" in parseQueueInput({ minGapDays: 1.5 }, true));
  expect("a gap over a year", "error" in parseQueueInput({ minGapDays: 366 }, true));
  expectEqual("a gap of 0", parseQueueInput({ minGapDays: 0 }, true), { data: { minGapDays: 0 } });
  expect("a bad item id", "error" in parseQueueInput({ itemIds: ["nope"] }, true));
  expectEqual(
    "item ids once each, in order",
    parseQueueInput({ itemIds: [ID_B, ID_A, ID_B] }, true),
    { data: { itemIds: [ID_B, ID_A] } },
  );
  expect("paused must be true or false", "error" in parseQueueInput({ paused: "yes" }, true));
}

/** The warnings beside items and the toast after a save. */
function checkWords(): void {
  console.log("Words");
  const base = { spent: false, recycle: true, posted: 3, platforms: ["facebook" as const] };
  expectEqual("an item that can go", itemHold(base, ["facebook", "google"]), null);
  expect(
    "finished",
    itemHold({ ...base, spent: true }, ["facebook"])?.startsWith("Finished") === true,
  );
  expect(
    "recycling off after a posting",
    itemHold({ ...base, recycle: false }, ["facebook"])?.includes("Recycling is off") === true,
  );
  expectEqual(
    "recycling off, never posted: fine",
    itemHold({ ...base, recycle: false, posted: 0 }, ["facebook"]),
    null,
  );
  expectEqual(
    "no app in common names the schedule's apps",
    itemHold(base, ["instagram", "google"]),
    "It isn't switched on for Instagram or Google.",
  );

  expectEqual("nothing changed", fillSummary(0, null), "");
  expectEqual(
    "made and cleared",
    fillSummary(2, { made: 1, queues: [{ empty: 0 }] }),
    "2 posts that no longer fit taken off. 1 post lined up.",
  );
  expectEqual(
    "empty slots",
    fillSummary(0, { made: 0, queues: [{ empty: 1 }, { empty: 2 }] }),
    "3 times left empty: nothing could go out then.",
  );
}

/** Runs every check. */
function main(): void {
  checkLabels();
  checkInstants();
  checkPicking();
  checkUpcoming();
  checkParse();
  checkWords();
  finish();
}

main();
