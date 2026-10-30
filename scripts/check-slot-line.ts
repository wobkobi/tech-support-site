// scripts/check-slot-line.ts
// An admin move rewrites the notes' slot line: a customer booking's "[2pm - Standard (60 min)]"
// takes the new NZ start and length, a manual entry's line the new length, and the customer's
// own text and the rest of the metadata stay as they were.
// Run with: npm test -- slot-line

import { parseBookingNotes, replaceSlotLine } from "@/features/booking/lib/booking";
import { expectEqual, finish } from "./lib/harness.js";

const DURATIONS = { short: 60, long: 120 };
const META = "Meeting type: In-person\nAddress: 1 Queen Street, Auckland\nQuoted: $64 - $121";

/**
 * NZ wall-clock time on 30 Oct 2026 (NZDT, UTC+13) as a UTC instant.
 * @param hour - NZ hour.
 * @param minute - NZ minute.
 * @returns The instant.
 */
function nz(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 9, 30, hour - 13, minute));
}

/** Runs every slot line fixture and reports the tally. */
function main(): void {
  console.log("slot line fixtures\n");

  const booked = `Modem keeps dropping out\n[Not urgent - any time]\n\n[2pm - Standard (60 min)]\n${META}`;

  expectEqual(
    "a move to 6:30pm rewrites the time",
    replaceSlotLine(booked, nz(18, 30), nz(19, 30), DURATIONS),
    `Modem keeps dropping out\n[Not urgent - any time]\n\n[6:30pm - Standard (60 min)]\n${META}`,
  );
  expectEqual(
    "a two-hour span reads as Extended",
    replaceSlotLine(booked, nz(10), nz(12), DURATIONS)?.split("\n\n")[1]?.split("\n")[0],
    "[10am - Extended (120 min)]",
  );
  expectEqual(
    "any other span is just minutes",
    replaceSlotLine(booked, nz(12), nz(13, 30), DURATIONS)?.split("\n\n")[1]?.split("\n")[0],
    "[12pm - 90 min]",
  );
  expectEqual(
    "the parsed parts survive the rewrite",
    parseBookingNotes(replaceSlotLine(booked, nz(18, 30), nz(19, 30), DURATIONS)),
    parseBookingNotes(booked),
  );

  expectEqual(
    "a manual entry takes the new length",
    replaceSlotLine(
      "Printer\n\n[Manual entry by admin - 60 min]\nMeeting type: Remote",
      nz(9),
      nz(11),
      DURATIONS,
    ),
    "Printer\n\n[Manual entry by admin - 120 min]\nMeeting type: Remote",
  );
  expectEqual(
    "metadata with no free text still rewrites",
    replaceSlotLine(`[2pm - Standard (60 min)]\n${META}`, nz(15, 15), nz(16, 15), DURATIONS),
    `[3:15pm - Standard (60 min)]\n${META}`,
  );

  expectEqual(
    "notes with no slot line are left alone",
    replaceSlotLine("Just a note", nz(9), nz(10), DURATIONS),
    null,
  );
  expectEqual("empty notes are left alone", replaceSlotLine(null, nz(9), nz(10), DURATIONS), null);

  finish();
}

main();
