// scripts/backfill-review-ask-outcomes.ts
// Marks every invoice sent before automatic review asks started as already decided
// (skipped, "before_auto"), so switching the job on doesn't email a review ask about
// every past job at once. Run once against production right after the deploy, before
// turning on Settings > Reviews > Automatic review asks. Also the safety step before
// testing the job locally against a database full of real invoices.
// Run with: npm run backfill:review-asks:dry      (writes nothing)
//           npm run backfill:review-asks:apply    (writes)
//
// The cut-off defaults to now. Pass --before=<ISO date> to pick another one - from
// PowerShell quote the separator: npm run backfill:review-asks:dry '--' --before=2026-10-07

import { NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
import { reviewAskClockStart } from "@/features/reviews/lib/review-ask-rules";
import { prisma } from "@/shared/lib/prisma";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const beforeArg = args.find((a) => a.startsWith("--before="))?.slice("--before=".length);
const before = beforeArg ? new Date(beforeArg) : new Date();
if (Number.isNaN(before.getTime())) {
  console.error(`--before isn't a date: ${beforeArg}`);
  process.exit(1);
}

console.log(
  `${apply ? "Applying" : "Dry run"} - invoices whose review-ask clock started before ${before.toISOString()}\n`,
);

// Undecided real invoices that have been emailed or paid. NOT_A_QUOTE_FILTER is itself
// an OR, so it has to sit inside the AND next to the outcome OR.
const invoices = await prisma.invoice.findMany({
  where: {
    status: { in: ["SENT", "PAID", "VOIDED"] },
    AND: [
      NOT_A_QUOTE_FILTER,
      { OR: [{ reviewAskOutcome: null }, { reviewAskOutcome: { isSet: false } }] },
      { OR: [{ sentAt: { not: null } }, { paidAt: { not: null } }] },
    ],
  },
  select: { id: true, number: true, status: true, sentAt: true, paidAt: true },
});

const due = invoices.filter((inv) => {
  const start = reviewAskClockStart(inv);
  return start !== null && start < before;
});

console.log(`${invoices.length} undecided invoice(s); ${due.length} started before the cut-off.`);
for (const inv of due.slice(0, 20)) {
  const start = reviewAskClockStart(inv)!;
  console.log(`  ${inv.number}  ${inv.status}  ${start.toISOString().slice(0, 10)}`);
}
if (due.length > 20) console.log(`  ...and ${due.length - 20} more`);

if (apply && due.length > 0) {
  const decidedAt = new Date();
  const { count } = await prisma.invoice.updateMany({
    where: {
      id: { in: due.map((inv) => inv.id) },
      OR: [{ reviewAskOutcome: null }, { reviewAskOutcome: { isSet: false } }],
    },
    data: {
      reviewAskOutcome: "skipped",
      reviewAskNote: "before_auto",
      reviewAskDecidedAt: decidedAt,
    },
  });
  console.log(`\nStamped ${count} invoice(s) skipped: before_auto.`);
} else if (!apply) {
  console.log("\nNothing written. Run backfill:review-asks:apply to stamp them.");
}

await prisma.$disconnect();
