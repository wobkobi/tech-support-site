// scripts/reconcile-booking-times.ts
// Reports (and optionally applies) the difference between each booking's stored
// times and its live Google Calendar event. Reads the booking calendar and the
// live database, so it costs Calendar quota and needs .env.local.
// Run with: npm run reconcile:times          (dry run, writes nothing)
//           npm run reconcile:times -- --apply
//           npm run reconcile:times -- --days 120

import { reconcileBookingTimes } from "@/features/calendar/lib/reconcile-booking-times";
import { formatDateTimeShort } from "@/shared/lib/date-format";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.indexOf("--days");
const sinceDays = daysArg === -1 ? undefined : Number(args[daysArg + 1]);

if (daysArg !== -1 && (!Number.isFinite(sinceDays) || sinceDays! <= 0)) {
  console.error("--days needs a positive number of days.");
  process.exit(1);
}

console.log(
  `${apply ? "Applying" : "Dry run"} - comparing bookings from the last ${sinceDays ?? 60} days against Google Calendar...\n`,
);

const result = await reconcileBookingTimes({ apply, sinceDays });

if (result.drifted.length === 0) {
  console.log(`No drift. ${result.checked} bookings match their calendar events.`);
} else {
  for (const drift of result.drifted) {
    console.log(`${drift.name}  (${drift.bookingId})`);
    console.log(
      `  site:     ${formatDateTimeShort(drift.from.startAt)} - ${formatDateTimeShort(drift.from.endAt)}`,
    );
    console.log(
      `  calendar: ${formatDateTimeShort(drift.to.startAt)} - ${formatDateTimeShort(drift.to.endAt)}`,
    );
    if (drift.skipped) {
      console.log(`  SKIPPED: ${drift.skipped}`);
    } else if (apply) {
      console.log("  updated to the calendar's times");
    }
    console.log("");
  }
  console.log(
    `${result.drifted.length} of ${result.checked} bookings drifted${apply ? " (see above for any skipped)" : " - re-run with --apply to correct them"}.`,
  );
}

if (result.unreadable > 0) {
  console.log(
    `\n${result.unreadable} booking(s) had no readable event (deleted, all-day, or an API failure) and were left alone.`,
  );
}

process.exit(0);
