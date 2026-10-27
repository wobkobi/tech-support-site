// scripts/check-invoice-numbering.ts
// Invoice and quote numbers restart at 0001 each financial year, and neither the saved rows
// nor the sheet counter can hand out a number twice.
// Run with: npm test -- invoice-numbering

import { nextInvoiceNumber, numberSequence } from "@/features/business/lib/invoice-maths";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  expectEqual("sequence of a saved number", numberSequence("TTP-202627-0097"), 97);
  expectEqual("sequence of a legacy number", numberSequence("TTP-0021"), 21);
  expectEqual("no number", numberSequence(null), 0);

  expectEqual(
    "mid-year: sheet and saved rows agree",
    nextInvoiceNumber("TTP", "202627", 97, 97).number,
    "TTP-202627-0098",
  );
  expectEqual(
    "a stale sheet can't reuse a saved number",
    nextInvoiceNumber("TTP", "202627", 97, 90).number,
    "TTP-202627-0098",
  );
  expectEqual(
    "a sheet bumped ahead skips forward",
    nextInvoiceNumber("TTP", "202627", 97, 120).number,
    "TTP-202627-0121",
  );
  expectEqual(
    "1 April: last year's count in the sheet doesn't carry over",
    nextInvoiceNumber("TTP", "202728", 0, 97),
    { number: "TTP-202728-0001", sequence: 1 },
  );
  expectEqual(
    "second invoice of the year follows the sheet",
    nextInvoiceNumber("TTP", "202728", 1, 1).number,
    "TTP-202728-0002",
  );
  expectEqual(
    "Sheets down: saved rows alone",
    nextInvoiceNumber("TTP", "202728", 4, null).number,
    "TTP-202728-0005",
  );
  expectEqual(
    "first quote of the year",
    nextInvoiceNumber("Q", "202728", 0, 12).number,
    "Q-202728-0001",
  );

  finish();
}

main();
