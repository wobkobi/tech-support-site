// scripts/check-review-asks.ts
// When an invoice's automatic review ask goes out or is skipped: clock start (payment),
// DST-safe due dates, the gap, one Google ask per person, unsuccessful jobs, the address
// used, and stop vs unsubscribe tokens.
// Run with: npm test -- review-asks

import {
  signReviewAskStopToken,
  signUnsubscribeToken,
  verifyReviewAskStopToken,
  verifyUnsubscribeToken,
} from "@/features/mailing/lib/unsubscribe-token";
import {
  askPersonStatus,
  decideReviewAsk,
  GOOGLE_ASKS_FROM,
  jobWhollyFailed,
  pickReviewAskAddress,
  reviewAskClockStart,
  reviewAskDueAt,
  type AskPersonInput,
  type ReviewAskInput,
} from "@/features/reviews/lib/review-ask-rules";
import { expectEqual, finish } from "./lib/harness.js";

process.env.UNSUBSCRIBE_SECRET = "check-review-asks-fixture-secret";

const DAY = 24 * 60 * 60 * 1000;
const TIMING = { delayDays: 2, gapDays: 30 };

/**
 * A ready-to-send input, paid 2026-06-10 10:00 NZST, that each case then bends.
 * @param patch - Fields to override.
 * @returns Rule input.
 */
function input(patch: Partial<ReviewAskInput> = {}): ReviewAskInput {
  return {
    status: "PAID",
    clockStart: new Date("2026-06-09T22:00:00Z"),
    unsuccessful: false,
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
 * @param manual - Send now.
 * @returns Summary string; an unpaid wait reads `unpaid:<forecast>`.
 */
function decide(i: ReviewAskInput, now: Date, gapDays = TIMING.gapDays, manual = false): string {
  const d = decideReviewAsk(i, { ...TIMING, gapDays, manual }, now);
  if (d.action === "skip") return `skip:${d.reason}`;
  if (d.action === "wait") return `${d.dueAt ? "wait" : "unpaid"}:${d.forecast ?? "-"}`;
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

  console.log("Waiting for payment");
  expectEqual(
    "unpaid invoice waits with no due date",
    decide(input({ status: "SENT", clockStart: null }), after),
    "unpaid:-",
  );
  expectEqual(
    "unpaid wait still forecasts an opt-out",
    decide(input({ status: "SENT", clockStart: null, reviewOptOut: true }), after),
    "unpaid:review_opt_out",
  );
  expectEqual(
    "voided unpaid invoice skips",
    decide(input({ status: "VOIDED", clockStart: null }), after),
    "skip:voided",
  );
  expectEqual(
    "Send now on an unpaid invoice sends",
    decide(input({ status: "SENT", clockStart: null }), after, 0, true),
    "send",
  );

  console.log("One Google ask per person");
  const googleAsk = new Date(GOOGLE_ASKS_FROM.getTime() + 60_000);
  const lateNow = new Date("2027-03-01T00:00:00Z");
  const lateInput = { clockStart: new Date("2027-02-20T00:00:00Z") };
  expectEqual(
    "a Google ask months ago still skips",
    decide(input({ ...lateInput, lastAskedAt: googleAsk }), lateNow),
    "skip:google_asked",
  );
  expectEqual(
    "an ask at the switch instant counts",
    decide(input({ ...lateInput, lastAskedAt: GOOGLE_ASKS_FROM }), lateNow),
    "skip:google_asked",
  );
  expectEqual(
    "a site-form ask before the switch doesn't count",
    decide(input({ ...lateInput, lastAskedAt: new Date(GOOGLE_ASKS_FROM.getTime() - 1) }), lateNow),
    "send",
  );
  expectEqual(
    "the Google-ask skip holds with the gap off",
    decide(input({ ...lateInput, lastAskedAt: googleAsk }), lateNow, 0),
    "skip:google_asked",
  );
  expectEqual(
    "Google ask forecast while waiting",
    decide(
      input({ clockStart: new Date("2027-02-28T22:00:00Z"), lastAskedAt: googleAsk }),
      lateNow,
    ),
    "wait:google_asked",
  );
  expectEqual(
    "Send now ignores the one-ask limit",
    decide(input({ ...lateInput, lastAskedAt: googleAsk }), lateNow, 0, true),
    "send",
  );
  expectEqual(
    "Send now still respects an opt-out",
    decide(input({ ...lateInput, lastAskedAt: googleAsk, reviewOptOut: true }), lateNow, 0, true),
    "skip:review_opt_out",
  );

  console.log("Unsuccessful jobs");
  expectEqual(
    "unsuccessful job skips even before due",
    decide(input({ unsuccessful: true }), before),
    "skip:unsuccessful",
  );
  expectEqual(
    "unsuccessful unpaid job skips straight away",
    decide(input({ unsuccessful: true, status: "SENT", clockStart: null }), before),
    "skip:unsuccessful",
  );
  expectEqual(
    "Send now on an unsuccessful job sends",
    decide(input({ unsuccessful: true }), after, 0, true),
    "send",
  );

  console.log("Clock start");
  const sent = new Date("2026-06-01T00:00:00Z");
  const paid = new Date("2026-06-05T00:00:00Z");
  expectEqual(
    "paid after the email starts at payment",
    reviewAskClockStart({ status: "PAID", sentAt: sent, paidAt: paid }),
    paid,
  );
  expectEqual(
    "paid on the day, emailed later, starts at the email",
    reviewAskClockStart({ status: "PAID", sentAt: paid, paidAt: sent }),
    paid,
  );
  expectEqual(
    "paid without emailing starts at paidAt",
    reviewAskClockStart({ status: "PAID", sentAt: null, paidAt: paid }),
    paid,
  );
  expectEqual(
    "emailed but unpaid has no clock",
    reviewAskClockStart({ status: "SENT", sentAt: sent, paidAt: null }),
    null,
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
    pickReviewAskAddress("accounts@company.example", contact),
    "sam@example.com",
  );
  expectEqual(
    "contact with no email takes the invoice address",
    pickReviewAskAddress("X@y.z ", { email: null, altEmails: [] }),
    "x@y.z",
  );
  expectEqual(
    "neither has an email",
    pickReviewAskAddress("", { email: null, altEmails: [] }),
    null,
  );

  // Hand-sent ask list: opt-outs block, a mailing unsubscribe falls back to a text
  const listNow = new Date("2026-10-07T00:00:00Z");
  /**
   * A contact with an email and nothing else going on, plus overrides.
   * @param over - Fields to change.
   * @returns Status input.
   */
  function person(over: Partial<AskPersonInput> = {}): AskPersonInput {
    return {
      hasEmail: true,
      hasPhone: false,
      lastAskedAt: null,
      reviewed: false,
      reviewOptOut: false,
      mailingOptOut: false,
      ...over,
    };
  }
  /**
   * The instant a whole number of days before the list's "now".
   * @param n - Days back.
   * @returns That instant.
   */
  function daysBefore(n: number): Date {
    return new Date(listNow.getTime() - n * 86_400_000);
  }
  expectEqual("never asked is ready", askPersonStatus(person(), 30, listNow), "ready");
  expectEqual(
    "asked 29 days ago is recent",
    askPersonStatus(person({ lastAskedAt: daysBefore(29) }), 30, listNow),
    "recent",
  );
  expectEqual(
    "asked exactly 30 days ago is ready",
    askPersonStatus(person({ lastAskedAt: daysBefore(30) }), 30, listNow),
    "ready",
  );
  expectEqual(
    "gap 0 never marks recent",
    askPersonStatus(person({ lastAskedAt: daysBefore(1) }), 0, listNow),
    "ready",
  );
  expectEqual(
    "reviewed beats recent",
    askPersonStatus(person({ reviewed: true, lastAskedAt: daysBefore(1) }), 30, listNow),
    "reviewed",
  );
  expectEqual(
    "review opt-out blocks even with a phone",
    askPersonStatus(person({ reviewOptOut: true, hasPhone: true }), 30, listNow),
    "review_opt_out",
  );
  expectEqual(
    "mailing opt-out with a phone is text only",
    askPersonStatus(person({ mailingOptOut: true, hasPhone: true }), 30, listNow),
    "text_only",
  );
  expectEqual(
    "mailing opt-out without a phone blocks",
    askPersonStatus(person({ mailingOptOut: true }), 30, listNow),
    "mailing_opt_out",
  );
  expectEqual(
    "phone only is text only",
    askPersonStatus(person({ hasEmail: false, hasPhone: true }), 30, listNow),
    "text_only",
  );
  expectEqual(
    "no email or phone",
    askPersonStatus(person({ hasEmail: false }), 30, listNow),
    "no_details",
  );
  const pastSwitch = new Date("2027-01-10T00:00:00Z");
  expectEqual(
    "had their Google ask, long ago",
    askPersonStatus(person({ lastAskedAt: GOOGLE_ASKS_FROM }), 30, pastSwitch),
    "google_asked",
  );
  expectEqual(
    "Google ask outranks reviewed",
    askPersonStatus(person({ reviewed: true, lastAskedAt: GOOGLE_ASKS_FROM }), 30, pastSwitch),
    "google_asked",
  );
  expectEqual(
    "site-form ask before the switch is ready once past the gap",
    askPersonStatus(person({ lastAskedAt: new Date("2026-09-01T00:00:00Z") }), 30, pastSwitch),
    "ready",
  );
  expectEqual(
    "Google ask with no email still offers a text",
    askPersonStatus(
      person({ hasEmail: false, hasPhone: true, lastAskedAt: GOOGLE_ASKS_FROM }),
      30,
      pastSwitch,
    ),
    "text_only",
  );

  // Whole-job failure, weighed from the real invoices that carry the flag
  interface Line {
    description: string;
    lineTotal: number;
    minutes?: number;
  }
  /**
   * An hourly labour line.
   * @param description - Task description.
   * @param lineTotal - Line total in dollars.
   * @returns The line, with minutes set as hourly rows have.
   */
  const timed = (description: string, lineTotal: number): Line => ({
    description,
    lineTotal,
    minutes: 15,
  });
  /**
   * A flat travel line.
   * @param lineTotal - Line total in dollars.
   * @returns The line, with no minutes.
   */
  const travel = (lineTotal: number): Line => ({ description: "Round-trip travel", lineTotal });
  expectEqual(
    "every task failed after a 35% promo (0083)",
    jobWhollyFailed(
      {
        unsuccessful: true,
        unsuccessfulDiscount: 48.75,
        promoDiscount: 52.5,
        goldCardDiscount: null,
        lineItems: [timed("Other setup - landline phone", 150), travel(25)],
      },
      0.5,
    ),
    true,
  );
  expectEqual(
    "one $25 task of five failed (0102)",
    jobWhollyFailed(
      {
        unsuccessful: true,
        unsuccessfulDiscount: 12.5,
        promoDiscount: null,
        goldCardDiscount: null,
        lineItems: [
          timed("Software setup", 33.33),
          timed("Printer configuration", 41.67),
          timed("Cloud data transfer", 25),
          timed("Software troubleshooting", 8.33),
          timed("Phone troubleshooting", 25),
          travel(10),
        ],
      },
      0.5,
    ),
    false,
  );
  expectEqual(
    "no discount means not failed",
    jobWhollyFailed(
      {
        unsuccessful: false,
        unsuccessfulDiscount: null,
        promoDiscount: null,
        goldCardDiscount: null,
        lineItems: [timed("Laptop repair", 100)],
      },
      0.5,
    ),
    false,
  );
  expectEqual(
    "lines without minutes fall back to the non-travel rows",
    jobWhollyFailed(
      {
        unsuccessful: true,
        unsuccessfulDiscount: 50,
        promoDiscount: null,
        goldCardDiscount: null,
        lineItems: [
          { description: "Laptop repair", lineTotal: 100 },
          { description: "Round-trip travel (8 min drive)", lineTotal: 10 },
        ],
      },
      0.5,
    ),
    true,
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

  finish();
}

main();
