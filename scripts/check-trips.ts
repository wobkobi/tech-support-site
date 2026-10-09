// scripts/check-trips.ts
// Fixtures for the trips log helpers in src/features/business/lib/trips.ts: request-body
// parsing (km rounding and limits, real calendar dates, ObjectId guard), the half-open FY
// window, km totals against the tier split, the add-form default date, and which bookings
// become "jobs without a trip" (status, remote, already linked, NZ-day FY boundary, one
// round trip per job, km reused from an earlier trip to the same address).
// Run with: npm run check:trips

import { listFinancialYears } from "@/features/business/lib/financial-year";
import { kmClaim, splitTripKm } from "@/features/business/lib/tax/vehicle";
import {
  addressKey,
  defaultTripDate,
  formatKm,
  isInWindow,
  kmByAddressFrom,
  kmDraftsFor,
  parseKm,
  parseTripInput,
  pickFy,
  sortTrips,
  suggestTrips,
  sumTripKm,
  type TripCandidate,
  type TripRow,
} from "@/features/business/lib/trips";
import { parseDateKey } from "@/shared/lib/date-format";

let failures = 0;

/** FY 2026-27 on the ledger scale. */
const FY_START = "2026-04-01T00:00:00.000Z";
const FY_END = "2027-04-01T00:00:00.000Z";

/** A well-formed ObjectId for the booking link cases. */
const BOOKING_ID = "0123456789abcdef01234567";

/** "Now" for every eligibility case: 9 Oct 2026. */
const NOW = new Date("2026-10-09T00:00:00.000Z");

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - What the call produced.
 * @param expected - What it should have produced.
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

/**
 * A completed in-person booking on 11 Sep 2026 (NZ), overridden per case.
 * @param overrides - Fields that differ from the base booking, always including the id.
 * @returns The candidate booking.
 */
function candidate(overrides: Partial<TripCandidate> & { id: string }): TripCandidate {
  return {
    name: "Jane Smith",
    address: "1 Queen St Auckland",
    // 22:00Z on 10 Sep is 10am on 11 Sep in NZST (+12; NZDT starts 27 Sep 2026).
    startAt: new Date("2026-09-10T22:00:00.000Z"),
    endAt: new Date("2026-09-10T23:00:00.000Z"),
    status: "completed",
    meetingType: "in_person",
    noShow: false,
    calendarEventMissingAt: null,
    travelMinsAtBooking: 25,
    travelMinsBackAtBooking: 28,
    ...overrides,
  };
}

/**
 * A minimal trip row for the sort case.
 * @param id - Row id.
 * @param date - Ledger date ISO string.
 * @returns The trip row.
 */
function trip(id: string, date: string): TripRow {
  return { id, date, km: 1, purpose: "x", bookingId: null, notes: null };
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("Km parsing:");
  expectEqual("whole number", parseKm(42), 42);
  expectEqual("numeric string rounds to 0.1 km", parseKm("18.25"), 18.3);
  expectEqual("12.34 rounds down", parseKm(12.34), 12.3);
  expectEqual("blank", parseKm(""), null);
  expectEqual("not a number", parseKm("12km"), null);
  expectEqual("zero", parseKm(0), null);
  expectEqual("rounds to zero", parseKm(0.04), null);
  expectEqual("negative", parseKm(-5), null);
  expectEqual("at the limit", parseKm(2000), 2000);
  expectEqual("over the limit", parseKm(2000.1), null);
  expectEqual("object", parseKm({}), null);

  console.log("\nLedger dates:");
  expectEqual(
    "valid day is UTC midnight",
    parseDateKey("2026-10-09")?.toISOString() ?? null,
    "2026-10-09T00:00:00.000Z",
  );
  expectEqual("30 Feb is rejected, not rolled into March", parseDateKey("2026-02-30"), null);
  expectEqual("month 13", parseDateKey("2026-13-01"), null);
  expectEqual("NZ-style date", parseDateKey("9/10/2026"), null);
  expectEqual("number", parseDateKey(20261009), null);
  expectEqual("full ISO instant", parseDateKey("2026-10-09T00:00:00Z"), null);

  console.log("\nRequest bodies:");
  expectEqual(
    "full body from a job",
    parseTripInput({
      date: "2026-10-09",
      km: "24.5",
      purpose: "  Job: Jane Smith  ",
      notes: "   ",
      bookingId: BOOKING_ID,
    }),
    {
      ok: true,
      value: {
        date: "2026-10-09T00:00:00.000Z",
        km: 24.5,
        purpose: "Job: Jane Smith",
        notes: null,
        bookingId: BOOKING_ID,
      },
    },
  );
  expectEqual(
    "manual trip, no booking",
    parseTripInput({ date: "2026-10-09", km: 12, purpose: "Parts run", notes: "PB Tech" }),
    {
      ok: true,
      value: {
        date: "2026-10-09T00:00:00.000Z",
        km: 12,
        purpose: "Parts run",
        notes: "PB Tech",
        bookingId: null,
      },
    },
  );
  expectEqual(
    "empty bookingId means none",
    parseTripInput({ date: "2026-10-09", km: 12, purpose: "Parts run", bookingId: "" }),
    {
      ok: true,
      value: {
        date: "2026-10-09T00:00:00.000Z",
        km: 12,
        purpose: "Parts run",
        notes: null,
        bookingId: null,
      },
    },
  );
  expectEqual("not an object", parseTripInput(null), {
    ok: false,
    error: "Expected a JSON object",
  });
  expectEqual("an array", parseTripInput([]), { ok: false, error: "Expected a JSON object" });
  expectEqual("bad date", parseTripInput({ date: "2026-13-01", km: 12, purpose: "x" }), {
    ok: false,
    error: "Enter a valid date",
  });
  expectEqual("zero km", parseTripInput({ date: "2026-10-09", km: 0, purpose: "x" }), {
    ok: false,
    error: "Enter the round-trip km, more than 0 and up to 2,000",
  });
  expectEqual("blank purpose", parseTripInput({ date: "2026-10-09", km: 5, purpose: "   " }), {
    ok: false,
    error: "Enter what the trip was for, up to 200 characters",
  });
  expectEqual(
    "long notes",
    parseTripInput({ date: "2026-10-09", km: 5, purpose: "x", notes: "n".repeat(1001) }),
    { ok: false, error: "Notes can be up to 1,000 characters" },
  );
  expectEqual(
    "malformed booking id",
    parseTripInput({ date: "2026-10-09", km: 5, purpose: "x", bookingId: "abc" }),
    { ok: false, error: "Invalid booking id" },
  );
  expectEqual(
    "filter object as booking id",
    parseTripInput({ date: "2026-10-09", km: 5, purpose: "x", bookingId: { not: "" } }),
    { ok: false, error: "Invalid booking id" },
  );

  console.log("\nFY window and picking:");
  expectEqual("1 April is in", isInWindow(FY_START, FY_START, FY_END), true);
  expectEqual("31 March is in", isInWindow("2027-03-31T00:00:00.000Z", FY_START, FY_END), true);
  expectEqual("next 1 April is out (half-open)", isInWindow(FY_END, FY_START, FY_END), false);
  expectEqual("day before is out", isInWindow("2026-03-31T00:00:00.000Z", FY_START, FY_END), false);
  const fys = listFinancialYears(NOW, new Date("2025-10-01T00:00:00.000Z"));
  expectEqual("?fy=2025-26", pickFy(fys, "2025-26")?.label ?? null, "FY 2025-26 (partial)");
  expectEqual("no ?fy= picks the current FY", pickFy(fys, undefined)?.label ?? null, "FY 2026-27");
  expectEqual("unknown ?fy=", pickFy(fys, "2019-20")?.label ?? null, null);
  expectEqual("no FYs at all", pickFy([] as typeof fys, undefined)?.label ?? null, null);

  console.log("\nTotals and order:");
  expectEqual("km sum", sumTripKm([{ km: 12.4 }, { km: 20 }, { km: 7.6 }]), 40);
  expectEqual("float noise rounded to 0.1", sumTripKm([{ km: 0.1 }, { km: 0.2 }]), 0.3);
  expectEqual("no trips", sumTripKm([]), 0);
  const claim = kmClaim(sumTripKm([{ km: 13990 }, { km: 20 }]), { tier1: 1.2, tier2: 0.37 });
  expectEqual("tier 1 km stops at 14,000", claim.tier1Km, 14000);
  expectEqual("tier 2 km is the rest", claim.tier2Km, 10);
  expectEqual("claim at 2025-26 petrol rates", claim.amount, 16803.7);
  // The page's claim rule (splitTripKm, shared with the Tax page): a trip before the
  // km-rate car's in-service day earns nothing. 40.5 x 1.20 = 48.60. The page passes the
  // FY's total vehicle km as the third argument, null while it is unset.
  const split = splitTripKm(
    [
      { ...trip("early", "2026-07-15T00:00:00.000Z"), km: 25 },
      { ...trip("late", "2026-09-01T00:00:00.000Z"), km: 40.5 },
    ],
    [{ from: "2026-08-26T00:00:00.000Z", to: null }],
  );
  expectEqual(
    "trip rows split by the car's period, only the covered km claimed",
    [
      split.claimableKm,
      split.outsideKm,
      kmClaim(split.claimableKm, { tier1: 1.2, tier2: 0.37 }, null).amount,
    ],
    [40.5, 25, 48.6],
  );
  expectEqual(
    "newest first, id breaks ties",
    sortTrips([
      trip("a", "2026-05-01T00:00:00.000Z"),
      trip("c", "2026-06-01T00:00:00.000Z"),
      trip("b", "2026-05-01T00:00:00.000Z"),
    ]).map((t) => t.id),
    ["c", "b", "a"],
  );
  expectEqual("format thousands", formatKm(14000), "14,000 km");
  expectEqual("format one decimal", formatKm(12.3), "12.3 km");
  expectEqual("format zero", formatKm(0), "0 km");

  console.log("\nAdd-form default date:");
  expectEqual("today inside the FY", defaultTripDate(FY_START, FY_END, "2026-10-09"), "2026-10-09");
  expectEqual(
    "past FY gets its last day",
    defaultTripDate("2025-04-01T00:00:00.000Z", FY_START, "2026-10-09"),
    "2026-03-31",
  );
  expectEqual(
    "FY not started gets its first day",
    defaultTripDate(FY_START, FY_END, "2026-03-15"),
    "2026-04-01",
  );

  console.log("\nKm from earlier trips to the same address:");
  expectEqual("address key", addressKey("  12/160 Kepa Road   Orakei "), "12/160 kepa road orakei");
  const kmByAddress = kmByAddressFrom(
    [
      { bookingId: "b1", km: 18, date: "2026-05-01T00:00:00.000Z" },
      { bookingId: "b2", km: 22, date: "2026-07-01T00:00:00.000Z" },
      { bookingId: null, km: 99, date: "2026-08-01T00:00:00.000Z" },
      { bookingId: "b3", km: 30, date: "2026-06-01T00:00:00.000Z" },
    ],
    new Map<string, string | null>([
      ["b1", "1 Queen St Auckland"],
      ["b2", " 1 queen st  Auckland"],
      ["b3", null],
    ]),
  );
  expectEqual("latest trip per address wins", [...kmByAddress], [["1 queen st auckland", 22]]);

  console.log("\nJobs without a trip:");
  const suggestions = suggestTrips(
    [
      candidate({ id: "b-done" }),
      candidate({
        id: "b-past",
        name: "Past Confirmed",
        address: "5 Other Rd",
        status: "confirmed",
        // 20:00Z on 1 Oct is 9am on 2 Oct in NZDT (+13).
        startAt: new Date("2026-10-01T20:00:00.000Z"),
        endAt: new Date("2026-10-01T21:00:00.000Z"),
        travelMinsAtBooking: 20,
        travelMinsBackAtBooking: null,
      }),
      candidate({
        id: "b-future",
        status: "confirmed",
        startAt: new Date("2026-10-20T20:00:00.000Z"),
        endAt: new Date("2026-10-20T21:00:00.000Z"),
      }),
      candidate({ id: "b-remote", meetingType: "remote" }),
      candidate({ id: "b-linked" }),
      candidate({
        id: "b-missing",
        status: "confirmed",
        calendarEventMissingAt: new Date("2026-09-12T00:00:00.000Z"),
      }),
      candidate({
        id: "b-noshow",
        name: "No Show",
        address: null,
        status: "cancelled",
        noShow: true,
        meetingType: null,
        startAt: new Date("2026-08-05T01:00:00.000Z"),
        endAt: new Date("2026-08-05T02:00:00.000Z"),
        travelMinsAtBooking: null,
        travelMinsBackAtBooking: null,
      }),
      candidate({ id: "b-cancelled", status: "cancelled" }),
      candidate({ id: "b-held", status: "held" }),
      // 12:30Z on 31 Mar 2027 is 1:30am on 1 Apr in NZDT: next FY.
      candidate({
        id: "b-nextfy",
        startAt: new Date("2027-03-31T12:30:00.000Z"),
        endAt: new Date("2027-03-31T13:30:00.000Z"),
      }),
      // 10:00Z on 31 Mar 2027 is 11pm on 31 Mar in NZDT: still this FY.
      candidate({
        id: "b-lastday",
        name: "Late Job",
        address: null,
        startAt: new Date("2027-03-31T10:00:00.000Z"),
        endAt: new Date("2027-03-31T10:30:00.000Z"),
      }),
    ],
    {
      linkedBookingIds: new Set(["b-linked"]),
      kmByAddress,
      startISO: FY_START,
      endISO: FY_END,
      now: NOW,
    },
  );
  expectEqual(
    "eligible jobs, newest first",
    suggestions.map((s) => s.bookingId),
    ["b-lastday", "b-past", "b-done", "b-noshow"],
  );
  expectEqual(
    "completed job: NZ day, both legs, km from the last trip there",
    suggestions.find((s) => s.bookingId === "b-done"),
    {
      bookingId: "b-done",
      date: "2026-09-11",
      name: "Jane Smith",
      address: "1 Queen St Auckland",
      travelMins: 53,
      suggestedKm: 22,
      purpose: "Job: Jane Smith",
      noShow: false,
    },
  );
  expectEqual(
    "past confirmed job: missing return leg mirrors the outbound",
    suggestions.find((s) => s.bookingId === "b-past"),
    {
      bookingId: "b-past",
      date: "2026-10-02",
      name: "Past Confirmed",
      address: "5 Other Rd",
      travelMins: 40,
      suggestedKm: null,
      purpose: "Job: Past Confirmed",
      noShow: false,
    },
  );
  expectEqual(
    "no-show still drove there",
    suggestions.find((s) => s.bookingId === "b-noshow"),
    {
      bookingId: "b-noshow",
      date: "2026-08-05",
      name: "No Show",
      address: null,
      travelMins: null,
      suggestedKm: null,
      purpose: "Job: No Show (no-show)",
      noShow: true,
    },
  );
  expectEqual("drafts prefill from suggestedKm", kmDraftsFor(suggestions, {}), {
    "b-lastday": "",
    "b-past": "",
    "b-done": "22",
    "b-noshow": "",
  });
  expectEqual(
    "drafts keep typed km and drop jobs that left the list",
    kmDraftsFor(suggestions, { "b-done": "30", gone: "9" }),
    { "b-lastday": "", "b-past": "", "b-done": "30", "b-noshow": "" },
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
