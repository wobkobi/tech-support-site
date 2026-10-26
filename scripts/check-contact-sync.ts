// scripts/check-contact-sync.ts
// Pure parts of the contact sync and merge: People API error reading and retry rules, open
// conflict holds, the merged-id list unsubscribe links follow, and the CSV export's cells.
// Run with: npm test -- contact-sync

import { csvCell, csvPhone } from "@/features/contacts/lib/contacts-csv";
import {
  googleErrorStatus,
  holdOpenConflict,
  isRetryableStatus,
} from "@/features/contacts/lib/google-contacts";
import { mergedIdsAfter } from "@/features/contacts/lib/merge-links";
import { expectEqual, finish } from "./lib/harness.js";

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("contact sync fixtures\n");

  // The status sits in different places depending on which layer threw.
  expectEqual("status from response", googleErrorStatus({ response: { status: 429 } }), 429);
  expectEqual("status from .status", googleErrorStatus({ status: 404 }), 404);
  expectEqual("numeric .code", googleErrorStatus({ code: 503 }), 503);
  expectEqual("string .code is no status", googleErrorStatus({ code: "ECONNRESET" }), null);
  expectEqual("null error", googleErrorStatus(null), null);

  // Only a rate limit or a server error is worth the wait.
  expectEqual("429 retries", isRetryableStatus(429), true);
  expectEqual("500 retries", isRetryableStatus(500), true);
  expectEqual("404 doesn't retry", isRetryableStatus(404), false);
  expectEqual("network error doesn't retry", isRetryableStatus(null), false);

  // A field with an open conflict moves neither way until the operator picks.
  expectEqual("open conflict holds a pull", holdOpenConflict(true, "pull"), "held");
  expectEqual("open conflict holds a push", holdOpenConflict(true, "push"), "held");
  expectEqual("open conflict holds a re-conflict", holdOpenConflict(true, "conflict"), "held");
  expectEqual("values that now agree clear it", holdOpenConflict(true, "noop"), "noop");
  expectEqual("no conflict passes through", holdOpenConflict(false, "pull"), "pull");

  // A chain of merges still resolves in one lookup.
  expectEqual(
    "takes the dup and everything merged into it",
    mergedIdsAfter(["a"], { id: "b", mergedContactIds: ["c"] }),
    ["a", "c", "b"],
  );
  expectEqual("no repeats", mergedIdsAfter(["a", "b"], { id: "b", mergedContactIds: ["a"] }), [
    "a",
    "b",
  ]);

  // E.164 numbers go out as is; anything else that starts like a formula is defused.
  expectEqual("E.164 phone has no quote", csvPhone("+64 21 123 4567"), '"+64 21 123 4567"');
  expectEqual("formula in a phone is defused", csvPhone("+1+cmd"), `"'+1+cmd"`);
  expectEqual("formula cell is defused", csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  expectEqual("quotes are doubled", csvCell('Bob "the" Builder'), '"Bob ""the"" Builder"');
  expectEqual("null is empty", csvCell(null), '""');

  finish();
}

main();
