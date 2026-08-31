// scripts/check-contact-emails.ts
// Unioning a contact's email addresses across the site and Google. The import
// used to read only emailAddresses[0] and the push used to write a
// single-element array, so every address after the first was dropped one way
// and deleted the other. These cases pin both directions.
// Run with: npm run check:emails-merge

import { mergeEmails } from "@/features/contacts/lib/merge-emails";

let failures = 0;

/**
 * Compares a merged list against its expectation, recording rather than
 * throwing so every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - List produced by the code under test.
 * @param expected - List the case should produce.
 */
function expectList(label: string, actual: string[], expected: string[]): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label} > ${a}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${e}, got ${a}`);
    failures++;
  }
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("contact email merge fixtures\n");

  expectList("nothing anywhere", mergeEmails([], [], null), []);

  expectList("primary only", mergeEmails(["a@x.co.nz"], [], "a@x.co.nz"), ["a@x.co.nz"]);

  // The case that started this: Google holds both, the site imported one.
  expectList(
    "google's extra address is kept",
    mergeEmails(
      ["bryan.leyland@icloud.com"],
      ["bryan.leyland@icloud.com", "bryan.leyland@gmail.com"],
      "bryan.leyland@icloud.com",
    ),
    ["bryan.leyland@icloud.com", "bryan.leyland@gmail.com"],
  );

  // The push direction: an address the site knows must not be dropped from
  // Google just because Google has not seen it yet.
  expectList(
    "site-only address survives",
    mergeEmails(["a@x.co.nz", "b@x.co.nz"], ["a@x.co.nz"], "a@x.co.nz"),
    ["a@x.co.nz", "b@x.co.nz"],
  );

  expectList(
    "primary leads even when Google lists it second",
    mergeEmails(["b@x.co.nz"], ["a@x.co.nz", "b@x.co.nz"], "b@x.co.nz"),
    ["b@x.co.nz", "a@x.co.nz"],
  );

  // Stored lowercased, and a case-only difference is the same address - the
  // sync already compares emails lowercased for exactly this reason.
  expectList(
    "case-only duplicates collapse",
    mergeEmails(["A@X.co.nz"], ["a@x.CO.NZ"], "A@X.co.nz"),
    ["a@x.co.nz"],
  );

  expectList(
    "blanks and nulls are dropped",
    mergeEmails([null, "  ", "a@x.co.nz"], ["", "b@x.co.nz"], "a@x.co.nz"),
    ["a@x.co.nz", "b@x.co.nz"],
  );

  // No primary yet (a contact with alts but no primary email set).
  expectList("no primary keeps Google's order", mergeEmails([], ["a@x.co.nz", "b@x.co.nz"], null), [
    "a@x.co.nz",
    "b@x.co.nz",
  ]);

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
