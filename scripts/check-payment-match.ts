// scripts/check-payment-match.ts
// Whether a Cashbook row counts as an overdue invoice's payment: exact full name on or after
// the issue day, else a shared first or last name a few days either side, plus the owner push.
// Run with: npm test -- payment-match

import {
  heldReminderPush,
  nameTokens,
  pickPaymentEntry,
  sharesNameToken,
  type PaymentEntryCandidate,
} from "@/features/business/lib/invoice-payment-match";
import { expectEqual, finish } from "./lib/harness.js";

const ISSUE_DAY = new Date("2026-05-06T00:00:00Z");

/**
 * A Cashbook row for the amount owing.
 * @param customer - Name as typed in the Cashbook.
 * @param dayOffset - Days from the issue day (negative is before).
 * @returns Candidate entry.
 */
function entry(customer: string, dayOffset: number): PaymentEntryCandidate {
  return {
    id: `${customer}@${dayOffset}`,
    date: new Date(ISSUE_DAY.getTime() + dayOffset * 86_400_000),
    amount: 25,
    method: "Bank",
    customer,
  };
}

/**
 * The picked entry's id and strength, for compact comparison.
 * @param clientName - Invoice client name.
 * @param entries - Candidates, earliest first.
 * @returns "id:strength", or "none".
 */
function pick(clientName: string, entries: PaymentEntryCandidate[]): string {
  const m = pickPaymentEntry(clientName, ISSUE_DAY, entries);
  return m ? `${m.entry.id}:${m.strength}` : "none";
}

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  console.log("Name tokens");
  expectEqual("couple", nameTokens("Joan & John Martin"), ["joan", "john", "martin"]);
  expectEqual("company suffix dropped", nameTokens("68 Ltd"), ["68"]);
  expectEqual("macrons and case", nameTokens("  HĒMI  Te-Rangi "), ["hemi", "terangi"]);
  expectEqual("first name in Cashbook", sharesNameToken("Carol", "Carol Bearsley"), true);
  expectEqual("surname counts too", sharesNameToken("Bearsley", "Carol Bearsley"), true);
  expectEqual("different people", sharesNameToken("Victoria", "Mars Salt and Sweet"), false);
  expectEqual("Ltd alone shares nothing", sharesNameToken("Acme Ltd", "68 Ltd"), false);
  expectEqual("blank shares nothing", sharesNameToken("", "Carol Bearsley"), false);

  console.log("Picking the payment");
  expectEqual(
    "exact name same day",
    pick("Carol Bearsley", [entry("Carol Bearsley", 0)]),
    "Carol Bearsley@0:likely",
  );
  expectEqual(
    "first name same day",
    pick("Carol Bearsley", [entry("Carol", 0)]),
    "Carol@0:possible",
  );
  expectEqual(
    "first name a week later",
    pick("Geoff Sheehan", [entry("Geoff", 7)]),
    "Geoff@7:possible",
  );
  expectEqual(
    "first name 3 days early",
    pick("Justine Francis", [entry("Justine", -3)]),
    "Justine@-3:possible",
  );
  expectEqual(
    "first name 4 days early is too early",
    pick("Justine Francis", [entry("Justine", -4)]),
    "none",
  );
  expectEqual(
    "exact name a day early is only possible",
    pick("Carol Bearsley", [entry("Carol Bearsley", -1)]),
    "Carol Bearsley@-1:possible",
  );
  expectEqual(
    "exact name beats an earlier first-name row",
    pick("Carol Bearsley", [entry("Carol", 0), entry("Carol Bearsley", 2)]),
    "Carol Bearsley@2:likely",
  );
  expectEqual(
    "no shared name",
    pick("Mars Salt and Sweet Limited", [entry("Victoria", 0)]),
    "none",
  );
  expectEqual(
    "earliest loose row wins",
    pick("Sue Everett", [entry("Sue", 1), entry("Sue", 5)]),
    "Sue@1:possible",
  );

  console.log("Owner push");
  const inv = { id: "abc123", number: "TTP-202627-0060", clientName: "Yeen Lim" };
  const date = new Date("2026-08-14T00:00:00Z");
  const possible = heldReminderPush(inv, {
    amount: 80,
    date,
    customer: "Yeen",
    strength: "possible",
  });
  expectEqual("possible title", possible.title, "Check a payment for TTP-202627-0060");
  expectEqual("one tag per invoice", possible.tag, "invoice-paid:abc123");
  expectEqual("opens the invoice", possible.url, "/admin/business/invoices/abc123");
  expectEqual(
    "possible body names the Cashbook row",
    possible.body,
    '"Yeen" paid $80.00 on 14 Aug 2026, the amount Yeen Lim owes. No reminder sent. If it\'s theirs, mark the invoice paid.',
  );
  expectEqual(
    "likely title",
    heldReminderPush(inv, { amount: 80, date, customer: "Yeen Lim", strength: "likely" }).title,
    "TTP-202627-0060 looks paid",
  );
  expectEqual(
    "nothing owing",
    heldReminderPush(inv, null).body,
    "No reminder sent to Yeen Lim. Mark the invoice paid.",
  );

  finish();
}

main();
