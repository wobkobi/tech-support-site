// src/features/calendar/lib/travel-timeline.ts
// Located commitments (bookings and calendar events with an address) in start order, for
// working out where the drive to a job starts and when you can set off.

/** One located commitment on the timeline. */
export interface LocatedCommitment {
  startMs: number;
  /** When you can set off for the next job: once home, after a personal event. */
  endMs: number;
  /** Where it is, for the drive on to it. */
  location: string;
  /** Where the drive to the next job starts: home, after a personal event. */
  leaveFrom: string;
}

/**
 * A booking's job address: the dedicated field, else the notes' "Address:" line.
 * @param b - Booking to read a location from.
 * @param b.address - The booking's dedicated address field, if set.
 * @param b.notes - The booking's notes, which may carry an "Address:" line.
 * @returns The address string, or null when none is recorded.
 */
export function bookingLocation(b: {
  address: string | null;
  notes: string | null;
}): string | null {
  const a = b.address?.trim();
  if (a) return a;
  return b.notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;
}

/**
 * Located commitments for the drive check: bookings and events with an address. A personal
 * event is left for home first, so the drive to a job after it starts from home once you're
 * back (its travel-home block).
 * @param bookings - Upcoming bookings, for their job addresses.
 * @param events - Calendar events, for their locations and calendars.
 * @param personalCalId - The personal calendar's id ("" when not configured).
 * @param homeAddress - Home, where the drive after a personal event starts.
 * @param backMinByEventId - Travel-home minutes per event, from its TravelBlock.
 * @returns Commitments ordered by start.
 */
export function buildTimeline(
  bookings: Array<{ startAt: Date; endAt: Date; address: string | null; notes: string | null }>,
  events: Array<{
    id: string;
    start: string;
    end: string;
    location?: string;
    calendarEmail: string;
  }>,
  personalCalId: string,
  homeAddress: string,
  backMinByEventId: Map<string, number>,
): LocatedCommitment[] {
  const timeline: LocatedCommitment[] = [];
  for (const b of bookings) {
    const loc = bookingLocation(b);
    if (loc) {
      timeline.push({
        startMs: b.startAt.getTime(),
        endMs: b.endAt.getTime(),
        location: loc,
        leaveFrom: loc,
      });
    }
  }
  for (const e of events) {
    if (!e.location) continue;
    const endMs = new Date(e.end).getTime();
    const homeFirst = Boolean(personalCalId && homeAddress) && e.calendarEmail === personalCalId;
    timeline.push({
      startMs: new Date(e.start).getTime(),
      endMs: homeFirst ? endMs + (backMinByEventId.get(e.id) ?? 0) * 60_000 : endMs,
      location: e.location,
      leaveFrom: homeFirst ? homeAddress : e.location,
    });
  }
  return timeline.sort((a, b) => a.startMs - b.startMs);
}
