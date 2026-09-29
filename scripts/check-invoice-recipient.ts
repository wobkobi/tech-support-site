// scripts/check-invoice-recipient.ts
// Whether an invoice went to a person or to their company, and who its emails greet.
// An invoice addressed to "68 Ltd" on Michael Smith's contact must greet Michael, not "68".
// Run with: npm run check:invoice-recipient

import { invoiceRecipient } from "@/features/business/lib/invoice-recipient";

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
  const michael = { name: "Michael Smith", company: "68 Ltd" };

  expectEqual("company invoice greets the person", invoiceRecipient("68 Ltd", michael), {
    toCompany: true,
    attention: "Michael Smith",
    greetingName: "Michael",
  });
  expectEqual(
    "company match ignores case and punctuation",
    invoiceRecipient("68 LTD.", michael).toCompany,
    true,
  );
  expectEqual("person invoice on the same contact", invoiceRecipient("Michael Smith", michael), {
    toCompany: false,
    attention: null,
    greetingName: "Michael",
  });
  expectEqual(
    "business-looking name on a contact with no stored company",
    invoiceRecipient("Acme Plumbing Ltd", { name: "Jane Doe", company: null }),
    { toCompany: true, attention: "Jane Doe", greetingName: "Jane" },
  );
  expectEqual(
    "shortened person name is still the person",
    invoiceRecipient("Mike", { name: "Michael Smith", company: null }),
    { toCompany: false, attention: null, greetingName: "Mike" },
  );
  expectEqual("no linked contact falls back to the client name", invoiceRecipient("68 Ltd", null), {
    toCompany: false,
    attention: null,
    greetingName: "68",
  });
  expectEqual(
    "contact itself named after the company has no person to greet",
    invoiceRecipient("68 Ltd", { name: "68 Ltd", company: null }),
    { toCompany: false, attention: null, greetingName: "68" },
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
