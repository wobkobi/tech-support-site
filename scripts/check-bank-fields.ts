// scripts/check-bank-fields.ts
// The Particulars value on the invoice's bank-transfer call-out, which is what names the payer
// on the operator's statement. A business reference must still identify it: "68 Ltd" as "68"
// alone doesn't.
// Run with: npm run check:bank-fields

import { bankCode, bankParticulars } from "@/features/business/lib/payment-fields";

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
  expectEqual("empty name", bankParticulars("  "), "Payment");
  expectEqual("code drops the prefix", bankCode("TTP-202627-0078"), "202627-0078");

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
