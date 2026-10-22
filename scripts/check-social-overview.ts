// scripts/check-social-overview.ts
// Social Overview: the set-up list's steps, counts and skipping, and the short day labels the
// next seven days use. Pure logic, no DB.
// Run with: npm test -- social-overview

import { shortDay } from "@/features/social/lib/calendar";
import {
  CHECKLIST_ITEMS,
  CHECKLIST_KEYS,
  checklistOf,
  isChecklistKey,
  type ChecklistFacts,
} from "@/features/social/lib/checklist";
import { expect, expectEqual, finish } from "./lib/harness.js";

const NOTHING: ChecklistFacts = {
  connected: 0,
  brand: false,
  items: 0,
  schedules: 0,
  recycling: false,
  emailed: false,
};

const EVERYTHING: ChecklistFacts = {
  connected: 3,
  brand: true,
  items: CHECKLIST_ITEMS,
  schedules: 1,
  recycling: true,
  emailed: true,
};

/** Steps, counts, skipping and the done rules. */
function checkChecklist(): void {
  const empty = checklistOf(NOTHING, []);
  expectEqual(
    "every step, in order",
    empty.steps.map((s) => s.key),
    [...CHECKLIST_KEYS],
  );
  expectEqual("nothing done", empty.done, 0);
  expectEqual("every step counted", empty.total, CHECKLIST_KEYS.length);
  expect("not complete", !empty.complete);

  const full = checklistOf(EVERYTHING, []);
  expectEqual("all done", full.done, CHECKLIST_KEYS.length);
  expect("complete", full.complete);

  /**
   * Whether one step is done, with every other fact at nothing.
   * @param facts - The facts to set.
   * @param key - The step.
   * @returns Its done flag.
   */
  const doneOf = (facts: Partial<ChecklistFacts>, key: string): boolean | undefined =>
    checklistOf({ ...NOTHING, ...facts }, []).steps.find((s) => s.key === key)?.done;
  expect("two of three apps isn't connected", doneOf({ connected: 2 }, "connect") === false);
  expect("three apps is", doneOf({ connected: 3 }, "connect") === true);
  expect("still checking isn't", doneOf({ connected: null }, "connect") === false);
  expect(
    "one short of the items isn't",
    doneOf({ items: CHECKLIST_ITEMS - 1 }, "content") === false,
  );
  expect("more than enough items is", doneOf({ items: CHECKLIST_ITEMS + 4 }, "content") === true);
  expect("one schedule is enough", doneOf({ schedules: 1 }, "schedule") === true);
  expect("brand", doneOf({ brand: true }, "brand") === true);
  expect("recycling", doneOf({ recycling: true }, "recycle") === true);
  expect("email", doneOf({ emailed: true }, "email") === true);

  const checking = checklistOf({ ...NOTHING, connected: null }, []);
  expect(
    "checking says so",
    checking.steps[0]!.detail.startsWith("Checking"),
    checking.steps[0]!.detail,
  );
  expect(
    "a count says how many",
    checklistOf({ ...NOTHING, connected: 2 }, []).steps[0]!.detail.startsWith("2 of 3"),
  );
  expect(
    "one item reads as one",
    checklistOf({ ...NOTHING, items: 1 }, []).steps[2]!.detail.startsWith("1 item so far"),
  );

  // Skipped steps stay in the list but leave the counts.
  const skipped = checklistOf({ ...NOTHING, brand: true }, ["brand", "email"]);
  expectEqual("skipped steps still listed", skipped.steps.length, CHECKLIST_KEYS.length);
  expectEqual(
    "marked skipped",
    skipped.steps.filter((s) => s.skipped).map((s) => s.key),
    ["brand", "email"],
  );
  expectEqual("skipped leave the total", skipped.total, CHECKLIST_KEYS.length - 2);
  expectEqual("a done step skipped isn't counted done", skipped.done, 0);

  const rest = checklistOf(
    { ...NOTHING, connected: 3, items: CHECKLIST_ITEMS, schedules: 2, recycling: true },
    ["brand", "email"],
  );
  expect("complete once everything not skipped is done", rest.complete);

  const allSkipped = checklistOf(NOTHING, [...CHECKLIST_KEYS]);
  expectEqual("all skipped counts nothing", allSkipped.total, 0);
  expect("all skipped is complete", allSkipped.complete);

  expect("unknown skip ignored", checklistOf(NOTHING, ["nope"]).total === CHECKLIST_KEYS.length);

  expect("a key is a key", isChecklistKey("schedule"));
  expect("an unknown word isn't", !isChecklistKey("nope"));
  expect("a number isn't", !isChecklistKey(3));
  expect("nothing isn't", !isChecklistKey(undefined));
}

/** Short day labels, at month and year edges. */
function checkShortDay(): void {
  expectEqual("a Thursday", shortDay("2026-10-22"), "Thu 22");
  expectEqual("a Monday", shortDay("2026-10-26"), "Mon 26");
  expectEqual("first of the month, no leading zero", shortDay("2026-11-01"), "Sun 1");
  expectEqual("new year's eve", shortDay("2026-12-31"), "Thu 31");
  expectEqual("new year", shortDay("2027-01-01"), "Fri 1");
  expectEqual("leap day", shortDay("2028-02-29"), "Tue 29");
}

checkChecklist();
checkShortDay();
finish();
