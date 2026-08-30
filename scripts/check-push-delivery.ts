// scripts/check-push-delivery.ts
// Exercises the pure parts of the push helper: which push-service status codes
// retire a device, and the payload the service worker receives. No network and
// no database - the send path itself is covered by the manual checklist.
// Run with: npm run check:push

import { buildPushPayload, isGoneStatus } from "@/features/notifications/lib/push";

let failures = 0;

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - Value produced by the code under test.
 * @param expected - Value the case should produce.
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

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("push delivery fixtures\n");

  // A gone endpoint must retire the device. Leaving 404/410 rows in place is
  // how the table rots into a set of permanently failing sends.
  expectEqual("410 Gone retires the device", isGoneStatus(410), true);
  expectEqual("404 Not Found retires the device", isGoneStatus(404), true);

  // Everything else is transient and must keep the row: a 500 from the push
  // service, or a rate limit, is not evidence the browser is gone.
  expectEqual("500 keeps the device", isGoneStatus(500), false);
  expectEqual("429 keeps the device", isGoneStatus(429), false);
  expectEqual("201 keeps the device", isGoneStatus(201), false);
  expectEqual("undefined status keeps the device", isGoneStatus(undefined), false);

  // The payload is the exact contract the service worker parses.
  expectEqual(
    "payload carries title, body, url and tag",
    JSON.parse(
      buildPushPayload({
        title: "New booking",
        body: "Jane Smith - Tue 2 Sep, 10:00am",
        url: "/admin/bookings/abc123",
        tag: "booking-abc123",
      }),
    ),
    {
      title: "New booking",
      body: "Jane Smith - Tue 2 Sep, 10:00am",
      url: "/admin/bookings/abc123",
      tag: "booking-abc123",
    },
  );

  // Tag is optional and must fall back to the url, so two pushes about the
  // same booking collapse into one notification instead of stacking.
  expectEqual(
    "tag falls back to the url",
    JSON.parse(
      buildPushPayload({
        title: "New review",
        body: "Jane S. - waiting on approval",
        url: "/admin/reviews",
      }),
    ).tag,
    "/admin/reviews",
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
