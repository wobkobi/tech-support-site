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

if (result.rearmed.length > 0) {
  console.log(
    `\n${result.rearmed.length} booking(s) carry send stamps from times they no longer have, so the email never fires again:`,
  );
  for (const r of result.rearmed) {
    const labels = r.stamps
      .map((s) => (s === "reminder" ? "24h reminder" : "review request"))
      .join(" + ");
    console.log(
      `  ${r.name}  (${r.bookingId})  booked ${formatDateTimeShort(r.startAt)}  >  ${labels}`,
    );
  }
  console.log(
    apply
      ? "  cleared - each will be emailed against its real times"
      : "  re-run with --apply to clear them",
  );
}

if (result.missing.length > 0) {
  console.log(
    `\n${result.missing.length} booking(s) own an event Calendar no longer has - the job was called off there and the row was left behind:`,
  );
  for (const gone of result.missing) {
    console.log(
      `  ${gone.name}  (${gone.bookingId})  still booked ${formatDateTimeShort(gone.startAt)}`,
    );
  }
  console.log(
    apply
      ? "  flagged - reminder and review emails are paused until each row is cancelled properly"
      : "  re-run with --apply to pause their reminder and review emails",
  );
}

if (result.restored > 0) {
  console.log(
    `\n${result.restored} previously flagged booking(s) read back again and were cleared.`,
  );
}

if (result.unreadable > 0) {
  console.log(
    `\n${result.unreadable} booking(s) had no readable event (all-day, or an API failure) and were left alone.`,
  );
}

process.exit(0);
