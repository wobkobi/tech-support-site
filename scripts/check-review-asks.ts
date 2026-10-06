// scripts/check-review-asks.ts
// When an invoice's automatic review ask goes out, and why it doesn't: every skip reason,
// waiting before skipping, the paid-without-emailing clock, due dates across the NZ
// daylight-saving changes, the gap boundary, which address the ask goes to, and that a
// "stop asking me" link and a mailing unsubscribe link can't stand in for each other.
// Run with: npm run check:review-asks

import {
  signReviewAskStopToken,
  signUnsubscribeToken,
  verifyReviewAskStopToken,
  verifyUnsubscribeToken,
} from "@/features/mailing/lib/unsubscribe-token";
import {
  decideReviewAsk,
  pickReviewAskAddress,
  reviewAskClockStart,
  reviewAskDueAt,
  type ReviewAskInput,
} from "@/features/reviews/lib/review-ask-rules";

process.env.UNSUBSCRIBE_SECRET = "check-review-asks-fixture-secret";

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

const DAY = 24 * 60 * 60 * 1000;
const TIMING = { delayDays: 2, gapDays: 30 };

/**
 * A ready-to-send input, sent 2026-06-10 10:00 NZST, that each case then bends.
 * @param patch - Fields to override.
 * @returns Rule input.
 */
function input(patch: Partial<ReviewAskInput> = {}): ReviewAskInput {
  return {
    status: "SENT",
    clockStart: new Date("2026-06-09T22:00:00Z"),
    hasContact: true,
    address: "sam@example.com",
    reviewOptOut: false,
    mailingOptOut: false,
    lastAskedAt: null,
    ...patch,
  };
}

/**
 * The decision's action plus its reason or forecast, for compact comparison.
 * @param i - Rule input.
 * @param now - Instant to decide at.
 * @param gapDays - Optional gap override.
 * @returns Summary string.
 */
function decide(i: ReviewAskInput, now: Date, gapDays = TIMING.gapDays): string {
  const d = decideReviewAsk(i, { ...TIMING, gapDays }, now);
  if (d.action === "skip") return `skip:${d.reason}`;
  if (d.action === "wait") return `wait:${d.forecast ?? "-"}`;
  return "send";
}

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  // Due 2026-06-12 00:00 NZST = 2026-06-11T12:00Z
  const due = new Date("2026-06-11T12:00:00Z");
  const after = new Date("2026-06-11T22:00:00Z");
  const before = new Date("2026-06-11T11:59:00Z");

  console.log("Decisions");
  expectEqual("ready and due sends", decide(input(), after), "send");
  expectEqual("not due yet waits", decide(input(), before), "wait:-");
  expectEqual("due exactly at NZ midnight sends", decide(input(), due), "send");
  expectEqual(
    "voided skips even before due",
    decide(input({ status: "VOIDED" }), before),
    "skip:voided",
  );
  expectEqual(
    "no contact skips once due",
    decide(input({ hasContact: false, address: null }), after),
    "skip:no_contact",
  );
  expectEqual("no email skips", decide(input({ address: null }), after), "skip:no_email");
  expectEqual(
    "review opt-out skips",
    decide(input({ reviewOptOut: true }), after),
    "skip:review_opt_out",
  );
  expectEqual(
    "mailing opt-out skips",
    decide(input({ mailingOptOut: true }), after),
    "skip:mailing_opt_out",
  );
  expectEqual(
    "review opt-out wins over mailing opt-out",
    decide(input({ reviewOptOut: true, mailingOptOut: true }), after),
    "skip:review_opt_out",
  );
  expectEqual(
    "asked 10 days ago skips",
    decide(input({ lastAskedAt: new Date(after.getTime() - 10 * DAY) }), after),
    "skip:asked_recently",
  );
  expectEqual(
    "asked exactly 30 days ago sends",
    decide(input({ lastAskedAt: new Date(after.getTime() - 30 * DAY) }), after),
    "send",
  );
  expectEqual(
    "asked a minute short of 30 days skips",
    decide(input({ lastAskedAt: new Date(after.getTime() - 30 * DAY + 60_000) }), after),
    "skip:asked_recently",
  );
  expectEqual(
    "gap 0 asks after every invoice",
    decide(input({ lastAskedAt: new Date(after.getTime() - DAY) }), after, 0),
    "send",
  );

  console.log("Waiting before skipping");
  expectEqual(
    "no contact while waiting is a forecast, not a skip",
    decide(input({ hasContact: false, address: null }), before),
    "wait:no_contact",
  );
  expectEqual(
    "opt-out while waiting is a forecast",
    decide(input({ reviewOptOut: true }), before),
    "wait:review_opt_out",
  );
  expectEqual(
    "gap forecast is judged at the due date",
    decide(input({ lastAskedAt: new Date(due.getTime() - 30 * DAY) }), before),
    "wait:-",
  );
  expectEqual(
    "gap still blocking at the due date forecasts it",
    decide(input({ lastAskedAt: new Date(due.getTime() - 5 * DAY) }), before),
    "wait:asked_recently",
  );

  console.log("Clock start");
  const sent = new Date("2026-06-01T00:00:00Z");
  const paid = new Date("2026-06-05T00:00:00Z");
  expectEqual(
    "emailed invoice starts at sentAt",
    reviewAskClockStart({ status: "PAID", sentAt: sent, paidAt: paid }),
    sent,
  );
  expectEqual(
    "paid without emailing starts at paidAt",
    reviewAskClockStart({ status: "PAID", sentAt: null, paidAt: paid }),
    paid,
  );
  expectEqual(
    "sent without a stamp has no clock",
    reviewAskClockStart({ status: "SENT", sentAt: null, paidAt: null }),
    null,
  );
  expectEqual(
    "paidAt on a non-PAID row is ignored",
    reviewAskClockStart({ status: "SENT", sentAt: null, paidAt: paid }),
    null,
  );

  console.log("Due dates (NZ calendar days, DST-safe)");
  expectEqual(
    "sent 23:59 NZST is still that day",
    reviewAskDueAt(new Date("2026-06-10T11:59:00Z"), 2).toISOString(),
    "2026-06-11T12:00:00.000Z",
  );
  expectEqual(
    "sent 00:01 NZST next day moves a day",
    reviewAskDueAt(new Date("2026-06-10T12:01:00Z"), 2).toISOString(),
    "2026-06-12T12:00:00.000Z",
  );
  expectEqual(
    "due on the April changeover day (still NZDT at midnight)",
    reviewAskDueAt(new Date("2026-04-02T21:00:00Z"), 2).toISOString(),
    "2026-04-04T11:00:00.000Z",
  );
  expectEqual(
    "due the day after the April change (NZST)",
    reviewAskDueAt(new Date("2026-04-03T21:00:00Z"), 2).toISOString(),
    "2026-04-05T12:00:00.000Z",
  );
  expectEqual(
    "due on the September changeover day (still NZST at midnight)",
    reviewAskDueAt(new Date("2026-09-24T22:00:00Z"), 2).toISOString(),
    "2026-09-26T12:00:00.000Z",
  );
  expectEqual(
    "due the day after the September change (NZDT)",
    reviewAskDueAt(new Date("2026-09-25T22:00:00Z"), 2).toISOString(),
    "2026-09-27T11:00:00.000Z",
  );

  console.log("Address");
  const contact = { email: "Sam@Example.com", altEmails: ["sam.work@example.com"] };
  expectEqual(
    "invoice address that is the contact's",
    pickReviewAskAddress("SAM@example.com ", contact),
    "sam@example.com",
  );
  expectEqual(
    "invoice to an alternate address",
    pickReviewAskAddress("sam.work@example.com", contact),
    "sam.work@example.com",
  );
  expectEqual(
    "invoice to a company address falls back",
    pickReviewAskAddress("accounts@68ltd.co.nz", contact),
    "sam@example.com",
  );
  expectEqual(
    "contact with no email",
    pickReviewAskAddress("x@y.z", { email: null, altEmails: [] }),
    null,
  );

  // Stop tokens: same secret as unsubscribe links, different purpose prefix
  const contactId = "64b7f0c2a1b2c3d4e5f60718";
  const stopToken = signReviewAskStopToken(contactId);
  const unsubToken = signUnsubscribeToken(contactId);
  expectEqual("stop token round-trips", verifyReviewAskStopToken(stopToken), contactId);
  expectEqual("unsubscribe token round-trips", verifyUnsubscribeToken(unsubToken), contactId);
  expectEqual("stop token is not an unsubscribe", verifyUnsubscribeToken(stopToken), null);
  expectEqual("unsubscribe token is not a stop", verifyReviewAskStopToken(unsubToken), null);
  expectEqual("tampered stop token", verifyReviewAskStopToken(`${stopToken}x`), null);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll review-ask checks passed.");
}

main();
