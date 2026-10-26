// scripts/check-bank-fields.ts
// The invoice's bank-transfer Particulars, which names the payer on the statement
// ("68 Ltd" cut to "68" wouldn't).
// Run with: npm test -- bank-fields

import { bankCode, bankParticulars } from "@/features/business/lib/payment-fields";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  expectEqual("person > surname", bankParticulars("Michael Smith"), "Smith");
  expectEqual("single name", bankParticulars("Wendy"), "Wendy");
  expectEqual("short business keeps its whole name", bankParticulars("68 Ltd"), "68 Ltd");
  expectEqual("business trimmed to whole words", bankParticulars("Acme Plumbing Ltd"), "Acme");
  expectEqual("leading article dropped", bankParticulars("The Rose Trust"), "Rose Trust");
  expectEqual("ampersand stripped", bankParticulars("Smith & Co"), "Smith Co");
  expectEqual(
    "overlong first word truncated",
    bankParticulars("Supercalifragilistic Ltd"),
    "Supercalifra",
  );
  expectEqual("macrons fold to plain letters", bankParticulars("Hēmi Pōhatu"), "Pohatu");
  expectEqual("empty name", bankParticulars("  "), "Payment");
  expectEqual("code drops the prefix", bankCode("TTP-202627-0078"), "202627-0078");

  finish();
}

main();
