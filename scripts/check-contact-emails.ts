// scripts/check-contact-emails.ts
// Union a contact's email addresses across the site and Google, so no address after the
// first is dropped on import or deleted on push.
// Run with: npm test -- contact-emails

import { mergeEmails } from "@/features/contacts/lib/merge-emails";
import { expectEqual, finish } from "./lib/harness.js";

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("contact email merge fixtures\n");

  expectEqual("nothing anywhere", mergeEmails([], [], null), []);

  expectEqual("primary only", mergeEmails(["a@x.co.nz"], [], "a@x.co.nz"), ["a@x.co.nz"]);

  // Google holds both addresses, the site imported only one.
  expectEqual(
    "google's extra address is kept",
    mergeEmails(
      ["pat.lee@example.com"],
      ["pat.lee@example.com", "pat.lee@example.net"],
      "pat.lee@example.com",
    ),
    ["pat.lee@example.com", "pat.lee@example.net"],
  );

  // Push direction: a site-only address must not be dropped
  expectEqual(
    "site-only address survives",
    mergeEmails(["a@x.co.nz", "b@x.co.nz"], ["a@x.co.nz"], "a@x.co.nz"),
    ["a@x.co.nz", "b@x.co.nz"],
  );

  expectEqual(
    "primary leads even when Google lists it second",
    mergeEmails(["b@x.co.nz"], ["a@x.co.nz", "b@x.co.nz"], "b@x.co.nz"),
    ["b@x.co.nz", "a@x.co.nz"],
  );

  // Stored lowercased; a case-only difference is the same address
  expectEqual(
    "case-only duplicates collapse",
    mergeEmails(["A@X.co.nz"], ["a@x.CO.NZ"], "A@X.co.nz"),
    ["a@x.co.nz"],
  );

  expectEqual(
    "blanks and nulls are dropped",
    mergeEmails([null, "  ", "a@x.co.nz"], ["", "b@x.co.nz"], "a@x.co.nz"),
    ["a@x.co.nz", "b@x.co.nz"],
  );

  // No primary yet (a contact with alts but no primary email set).
  expectEqual(
    "no primary keeps Google's order",
    mergeEmails([], ["a@x.co.nz", "b@x.co.nz"], null),
    ["a@x.co.nz", "b@x.co.nz"],
  );

  finish();
}

main();
