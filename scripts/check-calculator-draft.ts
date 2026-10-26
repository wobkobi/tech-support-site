// scripts/check-calculator-draft.ts
// Calculator draft scopes: a calendar job keys on its event set in any order, a re-issue
// keys on the voided invoice, and the plain calculator has no scope.
// Run with: npm test -- calculator-draft

import { draftScopeFor } from "@/features/business/lib/calculator-draft";
import { expectEqual, finish } from "./lib/harness.js";

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("calculator draft fixtures\n");

  expectEqual("the plain calculator has no scope", draftScopeFor([], null), null);
  expectEqual("one event", draftScopeFor(["abc"], null), "events:abc");
  expectEqual(
    "event order doesn't change the scope",
    draftScopeFor(["b2", "a1"], null),
    draftScopeFor(["a1", "b2"], null),
  );
  expectEqual(
    "a re-issue keys on the voided invoice",
    draftScopeFor(["a1"], "TTP-202627-0001"),
    "reissue:TTP-202627-0001",
  );
  const ids = ["b2", "a1"];
  draftScopeFor(ids, null);
  expectEqual("the caller's ids aren't reordered", ids.join(","), "b2,a1");

  finish();
}

main();
