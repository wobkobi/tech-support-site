// scripts/check-push-delivery.ts
// Pure parts of the push helper: which status codes retire a device, and the payload shape.
// Run with: npm test -- push-delivery

import { buildPushPayload, isGoneStatus } from "@/features/notifications/lib/push";
import { expectEqual, finish } from "./lib/harness.js";

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("push delivery fixtures\n");

  // A gone endpoint (404/410) must retire the device.
  expectEqual("410 Gone retires the device", isGoneStatus(410), true);
  expectEqual("404 Not Found retires the device", isGoneStatus(404), true);

  // Everything else (500s, rate limits) is transient and keeps the row.
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

  // Tag falls back to the url so pushes about one booking collapse into one notification.
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

  finish();
}

main();
