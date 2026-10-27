// scripts/check-invoice-status.ts
// An invoice turns OVERDUE at NZ midnight after its due day, whatever zone the server runs
// in (UTC on Vercel), and quotes and paid invoices never do.
// Run with: npm test -- invoice-status

import {
  deriveInvoiceDisplayStatus,
  isInvoiceOverdue,
} from "@/features/business/lib/invoice-status";
import { expectEqual, finish } from "./lib/harness.js";

/** Due 27 Oct 2026, stored as the date input saves it (UTC midnight). */
const DUE = "2026-10-27T00:00:00.000Z";

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  const sent = { status: "SENT" as const, dueDate: DUE };

  expectEqual(
    "due day itself, 11:30pm NZ: not yet",
    isInvoiceOverdue(sent, new Date("2026-10-27T10:30:00.000Z")),
    false,
  );
  // UTC midnight logic left this false until 1pm NZ on the 28th.
  expectEqual(
    "next day, 12:30am NZ (still the 27th in UTC): overdue",
    isInvoiceOverdue(sent, new Date("2026-10-27T11:30:00.000Z")),
    true,
  );
  expectEqual(
    "due date saved as NZ midnight reads as the same day",
    isInvoiceOverdue(
      { status: "SENT", dueDate: "2026-10-26T11:00:00.000Z" },
      new Date("2026-10-27T10:30:00.000Z"),
    ),
    false,
  );
  expectEqual(
    "paid: never overdue",
    isInvoiceOverdue({ status: "PAID", dueDate: DUE }, new Date("2026-11-30T00:00:00.000Z")),
    false,
  );
  expectEqual(
    "quote: never overdue",
    isInvoiceOverdue({ ...sent, isQuote: true }, new Date("2026-11-30T00:00:00.000Z")),
    false,
  );
  expectEqual(
    "bad due date: not overdue",
    isInvoiceOverdue({ status: "SENT", dueDate: "not a date" }),
    false,
  );
  expectEqual(
    "display status follows",
    deriveInvoiceDisplayStatus(sent, new Date("2026-10-27T11:30:00.000Z")),
    "OVERDUE",
  );

  finish();
}

main();
