// scripts/check-job-modifiers.ts
// Job-wide modifiers: Remote on channel-less tasks of a remote booking, Business on every
// task of a business job.
// Run with: npm test -- job-modifiers

import { isBusinessModifier, withJobModifiers } from "@/features/business/lib/job-modifiers";
import { expectEqual, finish } from "./lib/harness.js";

// The live modifier rows, as of 2026-10-12.
const RATES = [
  { id: "home", label: "At home", hourlyDelta: -30 },
  { id: "remote", label: "Remote", hourlyDelta: -10 },
  { id: "holiday", label: "Public Holiday", hourlyDelta: null },
  { id: "phone", label: "Phone", hourlyDelta: -35 },
  { id: "business", label: "Business", hourlyDelta: 40 },
  { id: "research", label: "Research", hourlyDelta: 10 },
];

const NONE = { remoteBooking: false, business: false };
const REMOTE = { remoteBooking: true, business: false };
const BUSINESS = { remoteBooking: false, business: true };
const BOTH = { remoteBooking: true, business: true };

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("Nothing known:");
  expectEqual("ids pass through", withJobModifiers(["research"], RATES, NONE), {
    ids: ["research"],
    addedRemote: false,
    addedBusiness: false,
  });

  console.log("\nRemote booking:");
  expectEqual("no channel gets Remote", withJobModifiers([], RATES, REMOTE).ids, ["remote"]);
  expectEqual(
    "Research stays and Remote joins it",
    withJobModifiers(["research"], RATES, REMOTE).ids,
    ["research", "remote"],
  );
  expectEqual("a phone task stays Phone", withJobModifiers(["phone"], RATES, REMOTE), {
    ids: ["phone"],
    addedRemote: false,
    addedBusiness: false,
  });
  expectEqual("an at-home task stays At home", withJobModifiers(["home"], RATES, REMOTE).ids, [
    "home",
  ]);
  expectEqual("Remote already there is not doubled", withJobModifiers(["remote"], RATES, REMOTE), {
    ids: ["remote"],
    addedRemote: false,
    addedBusiness: false,
  });
  expectEqual(
    "no Remote row adds nothing",
    withJobModifiers(
      [],
      RATES.filter((r) => r.id !== "remote"),
      REMOTE,
    ),
    { ids: [], addedRemote: false, addedBusiness: false },
  );
  expectEqual(
    "a renamed Remote row adds nothing",
    withJobModifiers(
      [],
      RATES.map((r) => (r.id === "remote" ? { ...r, label: "Screen share" } : r)),
      REMOTE,
    ).ids,
    [],
  );

  console.log("\nBusiness job:");
  expectEqual("on-site task gets Business", withJobModifiers([], RATES, BUSINESS), {
    ids: ["business"],
    addedRemote: false,
    addedBusiness: true,
  });
  expectEqual("stacks with a channel", withJobModifiers(["phone"], RATES, BUSINESS).ids, [
    "phone",
    "business",
  ]);
  expectEqual(
    "Business already there is not doubled",
    withJobModifiers(["business"], RATES, BUSINESS).addedBusiness,
    false,
  );
  expectEqual(
    "no Business row adds nothing",
    withJobModifiers(
      [],
      RATES.filter((r) => r.id !== "business"),
      BUSINESS,
    ).ids,
    [],
  );

  console.log("\nRemote booking for a business:");
  expectEqual("both added", withJobModifiers([], RATES, BOTH), {
    ids: ["remote", "business"],
    addedRemote: true,
    addedBusiness: true,
  });
  expectEqual("phone task only gains Business", withJobModifiers(["phone"], RATES, BOTH), {
    ids: ["phone", "business"],
    addedRemote: false,
    addedBusiness: true,
  });

  console.log("\nBusiness label match:");
  expectEqual("exact", isBusinessModifier({ label: "Business" }), true);
  expectEqual("case and spaces", isBusinessModifier({ label: " business " }), true);
  expectEqual("other label", isBusinessModifier({ label: "After hours / weekend" }), false);

  finish();
}

main();
