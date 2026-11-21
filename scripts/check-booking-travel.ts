// scripts/check-booking-travel.ts
// Booking drive rule: which commitments a slot sits between, when the drive in from the previous
// one or on to the next one rules it out, failing open, and masking the grid.
// Run with: npm test -- booking-travel

import type { BookableDay } from "@/features/booking/lib/booking";
import {
  applyTravelBlocks,
  buildTravelTimeline,
  slotTravelLegs,
  TO_NEXT_DEPARTURE_LEAD_MIN,
  travelLegKey,
  travelVerdict,
  travelVerdictMessage,
  type TravelCommitment,
} from "@/features/booking/lib/booking-travel";
import { expect, expectEqual, finish } from "./lib/harness.js";

const MIN = 60_000;

/**
 * NZ wall-clock time on 20 November 2026 (NZDT, UTC+13) as epoch ms.
 * @param hour - NZ hour.
 * @param minute - NZ minute.
 * @param dayOffset - Days after 20 November.
 * @returns The instant in ms.
 */
function nz(hour: number, minute = 0, dayOffset = 0): number {
  return Date.UTC(2026, 10, 20 + dayOffset, hour - 13, minute);
}

const HOME = "1 Home Street, Pt Chevalier";
const OREWA = "5 Hibiscus Coast Highway, Orewa";
const PAPAKURA = "10 Great South Road, Papakura";
const PERSONAL = "personal@example.com";
const WORK = "work@example.com";

// Timeline: a Papakura booking 12-1pm, a personal event 3-4pm with 20 min home, a work event
// on the next day.
const timeline = buildTravelTimeline({
  bookings: [
    {
      startAt: new Date(nz(12)),
      endAt: new Date(nz(13)),
      address: PAPAKURA,
      notes: null,
    },
    // No address: left off the timeline.
    { startAt: new Date(nz(9)), endAt: new Date(nz(10)), address: null, notes: null },
  ],
  events: [
    {
      id: "dentist",
      start: new Date(nz(15)).toISOString(),
      end: new Date(nz(16)).toISOString(),
      location: "Dentist, Ponsonby",
      calendarEmail: PERSONAL,
    },
    {
      id: "tomorrow",
      start: new Date(nz(11, 0, 1)).toISOString(),
      end: new Date(nz(12, 0, 1)).toISOString(),
      location: "Work site, Albany",
      calendarEmail: WORK,
    },
    // No location: left off the timeline.
    {
      id: "call",
      start: new Date(nz(17)).toISOString(),
      end: new Date(nz(18)).toISOString(),
      calendarEmail: WORK,
    },
  ],
  personalCalId: PERSONAL,
  homeAddress: HOME,
  backMinByEventId: new Map([["dentist", 20]]),
  bookingBufferMin: 30,
  eventBufferMin: 15,
});

expectEqual("timeline keeps only located commitments", timeline.length, 3);
expectEqual(
  "booking carries the booking buffer",
  timeline.map((c) => c.bufferAfterMin),
  [30, 15, 15],
);
const dentist = timeline[1] as TravelCommitment;
expectEqual("personal event: leave from home", dentist.leaveFrom, HOME);
expectEqual("personal event: ready once home", dentist.endMs, nz(16, 20));

// Legs: 1:45pm 1hr slot in Orewa sits between the Papakura job and the dentist.
const legs = slotTravelLegs(nz(13, 45), nz(14, 45), OREWA, timeline);
expectEqual("from leg starts at the Papakura job", legs.from?.origin, PAPAKURA);
expectEqual("from leg departs at its end", legs.from?.departMs, nz(13));
expectEqual("from leg ready after the booking buffer", legs.from?.readyMs, nz(13, 30));
expectEqual("to leg goes to the dentist", legs.to?.destination, "Dentist, Ponsonby");
expectEqual(
  "to leg priced ahead of the next start",
  legs.to?.departMs,
  nz(15) - TO_NEXT_DEPARTURE_LEAD_MIN * MIN,
);

// Papakura ends 1pm (+30 buffer = 1:30); a 60 min drive lands 2:30, after a 1:45 start.
expectEqual(
  "1hr drive from Papakura rules out 1:45",
  travelVerdict(nz(13, 45), nz(14, 45), 30, legs, 60, 5),
  "from-previous",
);
expectEqual(
  "10 min drive fits 1:45",
  travelVerdict(nz(13, 45), nz(14, 45), 30, legs, 10, null),
  "ok",
);
expectEqual(
  "exactly fitting drive in is allowed",
  travelVerdict(nz(13, 45), nz(14, 45), 30, legs, 15, null),
  "ok",
);
// Slot ends 2:30 + 30 buffer + 20 min drive = 3:20, past the 3pm dentist.
const lateLegs = slotTravelLegs(nz(13, 45), nz(14, 30), OREWA, timeline);
expectEqual(
  "drive on to the next start rules it out",
  travelVerdict(nz(13, 45), nz(14, 30), 30, lateLegs, 0, 20),
  "to-next",
);
expectEqual(
  "exactly fitting drive on is allowed",
  travelVerdict(
    nz(13, 45),
    nz(14, 10),
    30,
    slotTravelLegs(nz(13, 45), nz(14, 10), OREWA, timeline),
    0,
    20,
  ),
  "ok",
);

// Fail open: an unpriced drive never rules a time out.
expectEqual(
  "null drive in fails open",
  travelVerdict(nz(13, 45), nz(14, 45), 30, legs, null, null),
  "ok",
);

// After the personal event, the drive starts from home once back.
const evening = slotTravelLegs(nz(17), nz(18), OREWA, timeline);
expectEqual("after a personal event, leave from home", evening.from?.origin, HOME);
expectEqual("after a personal event, ready once home + buffer", evening.from?.readyMs, nz(16, 35));
expect("nothing after the evening slot that day", evening.to === null);

// Before the first job of the day, only the drive on matters.
const morning = slotTravelLegs(nz(10), nz(11), OREWA, timeline);
expect("no previous commitment in the morning", morning.from === null);
expectEqual("morning slot drives on to Papakura", morning.to?.destination, PAPAKURA);

// A day with no other commitment needs no drive priced.
const empty = slotTravelLegs(nz(10, 0, 2), nz(11, 0, 2), OREWA, timeline);
expect("empty day: no legs", empty.from === null && empty.to === null);

// The next day's job doesn't count as today's next commitment, nor today's as its previous.
const nextDay = slotTravelLegs(nz(14, 0, 1), nz(15, 0, 1), OREWA, timeline);
expectEqual("next day: previous is that day's job", nextDay.from?.origin, "Work site, Albany");
expect("next day: no next commitment", nextDay.to === null);

// Current spot: for a slot today, where the phone is replaces the drive in once nothing earlier
// is still running.
const PHONE = "-36.9000,174.8000";
const morningHere = slotTravelLegs(nz(10), nz(11), OREWA, timeline, { origin: PHONE, atMs: nz(8) });
expectEqual("today, nothing before: drive from the phone", morningHere.from?.origin, PHONE);
expectEqual("drive from the phone leaves now", morningHere.from?.departMs, nz(8));
expect("drive from the phone is marked", morningHere.from?.fromHere === true);
const duringJob = slotTravelLegs(nz(13, 45), nz(14, 45), OREWA, timeline, {
  origin: PHONE,
  atMs: nz(12, 30),
});
expectEqual("a job still running sets the drive in", duringJob.from?.origin, PAPAKURA);
const inBuffer = slotTravelLegs(nz(13, 45), nz(14, 45), OREWA, timeline, {
  origin: PHONE,
  atMs: nz(13, 10),
});
expectEqual("after the job, the phone wins", inBuffer.from?.origin, PHONE);
expectEqual("but you're ready once the buffer's over", inBuffer.from?.readyMs, nz(13, 30));
const tomorrowHere = slotTravelLegs(nz(10, 0, 2), nz(11, 0, 2), OREWA, timeline, {
  origin: PHONE,
  atMs: nz(8),
});
expect("another day ignores the phone", tomorrowHere.from === null);
expectEqual(
  "too far from here",
  travelVerdict(nz(10), nz(11), 30, morningHere, 150, null),
  "from-here",
);
expectEqual(
  "close enough from here",
  travelVerdict(nz(10), nz(11), 30, morningHere, 60, null),
  "ok",
);

// Memo keys round departures to five minutes.
expectEqual(
  "keys share a five-minute bucket",
  travelLegKey({ origin: "A ", destination: "b", departMs: nz(13, 1) }),
  travelLegKey({ origin: "a", destination: "B", departMs: nz(13, 2) }),
);
expect(
  "keys differ across buckets",
  travelLegKey({ origin: "a", destination: "b", departMs: nz(13) }) !==
    travelLegKey({ origin: "a", destination: "b", departMs: nz(13, 10) }),
);

expect(
  "messages name the leg",
  travelVerdictMessage("from-previous").includes("from my previous job") &&
    travelVerdictMessage("to-next").includes("my next job"),
);

// Grid masking: only the blocked length closes, flags are recomputed, nothing reads as booked.
const day: BookableDay = {
  dateKey: "2026-11-20",
  dayLabel: "Fri 20 Nov",
  fullLabel: "Friday 20 Nov",
  isToday: false,
  isTomorrow: false,
  isWeekend: false,
  hasAnySlots: true,
  timeWindows: [
    {
      value: "1pm",
      label: "1pm",
      startHour: 13,
      availableShort: true,
      availableLong: true,
      subSlots: [
        {
          minute: 45,
          availableShort: true,
          availableLong: true,
          bookedShort: false,
          bookedLong: false,
        },
      ],
    },
    {
      value: "2pm",
      label: "2pm",
      startHour: 14,
      availableShort: true,
      availableLong: false,
      subSlots: [
        {
          minute: 0,
          availableShort: true,
          availableLong: false,
          bookedShort: false,
          bookedLong: false,
        },
      ],
    },
  ],
};
const masked = applyTravelBlocks(
  [day],
  [{ dateKey: "2026-11-20", startHour: 13, minute: 45, short: false, long: true }],
);
const w1 = masked[0]!.timeWindows[0]!;
expect("short still open at 1:45", w1.subSlots[0]!.availableShort && w1.availableShort);
expect("long closed at 1:45", !w1.subSlots[0]!.availableLong && !w1.availableLong);
expect("closed start isn't marked booked", !w1.subSlots[0]!.bookedLong);
const allGone = applyTravelBlocks(
  [day],
  [
    { dateKey: "2026-11-20", startHour: 13, minute: 45, short: true, long: true },
    { dateKey: "2026-11-20", startHour: 14, minute: 0, short: true, long: true },
  ],
);
expect("day with every start closed has no slots", !allGone[0]!.hasAnySlots);
expect("no blocks returns the same days", applyTravelBlocks([day], [])[0] === day);

finish();
