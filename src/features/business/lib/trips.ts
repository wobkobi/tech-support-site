// src/features/business/lib/trips.ts
// Business trips log rules: request-body parsing, km and ledger-date checks, FY picking,
// km totals, and which completed bookings become "jobs without a trip". Pure (no Prisma,
// no React), so the page, the API routes, the client view and scripts/check-trips.ts all
// share one copy.

import { DAY_MS, fyKeyOf } from "@/features/business/lib/financial-year";
import { inFy } from "@/features/business/lib/tax/helpers";
import { parseObjectId } from "@/features/business/lib/validation";
import { parseDateKey } from "@/shared/lib/date-format";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Longest round trip one entry may log, in km. Anything longer is a typo. */
export const MAX_TRIP_KM = 2000;

/** Longest purpose line, matching the other ledger text fields. */
const MAX_PURPOSE_LEN = 200;

/** Longest notes field. */
const MAX_NOTES_LEN = 1000;

/** One logged trip as the API and page hand it to the client. */
export interface TripRow {
  id: string;
  /** Ledger date: UTC midnight of the NZ day, as an ISO string. */
  date: string;
  /** Round-trip business km. */
  km: number;
  purpose: string;
  /** The booking this trip was logged from, or null for a manual trip. */
  bookingId: string | null;
  notes: string | null;
}

/** A job in the FY with no trip logged yet, offered on the trips page. */
export interface TripSuggestion {
  bookingId: string;
  /** NZ day of the job as YYYY-MM-DD, used as the trip's ledger date. */
  date: string;
  name: string;
  address: string | null;
  /** Booked drive time there and back in minutes, or null when the booking stored none. */
  travelMins: number | null;
  /**
   * Round-trip km from the latest trip logged from a job at the same address, or null.
   * Bookings store drive minutes only, never km, so this is the only stored km source.
   */
  suggestedKm: number | null;
  /** Purpose line the trip is logged with. */
  purpose: string;
  /** True for a no-show: the job was cancelled but the drive still happened. */
  noShow: boolean;
}

/** Validated trip fields, ready for Prisma. */
export interface TripInput {
  date: Date;
  km: number;
  purpose: string;
  notes: string | null;
  bookingId: string | null;
}

/** Outcome of {@link parseTripInput}. */
export type TripInputResult = { ok: true; value: TripInput } | { ok: false; error: string };

/** Body of a trips API reply (POST, PUT, DELETE). */
export interface TripApiResponse {
  ok: boolean;
  trip?: TripRow;
  error?: string;
}

/** Body of the trips list reply (GET /api/business/trips). */
export interface TripListApiResponse {
  ok: boolean;
  trips?: TripRow[];
  error?: string;
}

/** Body of the suggest API reply. */
export interface SuggestApiResponse {
  ok: boolean;
  fyKey?: string;
  suggestions?: TripSuggestion[];
  error?: string;
}

/** The booking fields {@link suggestTrips} reads. */
export interface TripCandidate {
  id: string;
  name: string;
  address: string | null;
  startAt: Date;
  endAt: Date;
  status: "held" | "confirmed" | "cancelled" | "completed";
  meetingType: "in_person" | "remote" | null;
  noShow: boolean;
  calendarEventMissingAt: Date | null;
  travelMinsAtBooking: number | null;
  travelMinsBackAtBooking: number | null;
}

/** Everything {@link suggestTrips} needs besides the bookings. */
export interface SuggestContext {
  /** Bookings that already have a trip; a job gets one round trip, so they drop out. */
  linkedBookingIds: ReadonlySet<string>;
  /** Round-trip km by {@link addressKey}, from {@link kmByAddressFrom}. */
  kmByAddress: ReadonlyMap<string, number>;
  /** FY start on the ledger scale (inclusive ISO). */
  startISO: string;
  /** FY end on the ledger scale (exclusive ISO). */
  endISO: string;
  /** Reference time for "has this confirmed job ended yet". */
  now: Date;
}

/**
 * Parses a km figure: a finite number or numeric string, rounded to 0.1 km, above 0 and
 * at most {@link MAX_TRIP_KM}. A value that rounds to 0 is rejected.
 * @param value - Raw value from a request body or an input.
 * @returns The km, or null when it isn't a usable distance.
 */
export function parseKm(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded <= 0 || rounded > MAX_TRIP_KM) return null;
  return rounded;
}

/**
 * Validates a trips API body. Checks run in field order (date, km, purpose, notes,
 * booking) and the first failure's message is returned for the form to show.
 * `bookingId` goes through parseObjectId: an unchecked object there would reach a Prisma
 * `where` as an operator, and a malformed id would 500 the write.
 * @param body - Parsed JSON body.
 * @returns The validated fields, or the first error.
 */
export function parseTripInput(body: unknown): TripInputResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const date = parseDateKey(b.date);
  if (!date) return { ok: false, error: "Enter a valid date" };

  const km = parseKm(b.km);
  if (km === null) {
    return {
      ok: false,
      error: `Enter the round-trip km, more than 0 and up to ${MAX_TRIP_KM.toLocaleString("en-NZ")}`,
    };
  }

  const purpose = typeof b.purpose === "string" ? b.purpose.trim() : "";
  if (!purpose || purpose.length > MAX_PURPOSE_LEN) {
    return {
      ok: false,
      error: `Enter what the trip was for, up to ${MAX_PURPOSE_LEN} characters`,
    };
  }

  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== "string" || b.notes.length > MAX_NOTES_LEN) {
      return {
        ok: false,
        error: `Notes can be up to ${MAX_NOTES_LEN.toLocaleString("en-NZ")} characters`,
      };
    }
    notes = b.notes.trim() || null;
  }

  let bookingId: string | null = null;
  if (b.bookingId !== undefined && b.bookingId !== null && b.bookingId !== "") {
    bookingId = parseObjectId(b.bookingId);
    if (!bookingId) return { ok: false, error: "Invalid booking id" };
  }

  return { ok: true, value: { date, km, purpose, notes, bookingId } };
}

/**
 * Plain-data trip for the client (no Date objects across the server boundary).
 * @param trip - Trip as Prisma returns it.
 * @param trip.id - Row id.
 * @param trip.date - Ledger date.
 * @param trip.km - Round-trip km.
 * @param trip.purpose - Purpose line.
 * @param trip.bookingId - Linked booking, or null.
 * @param trip.notes - Notes, or null.
 * @returns The serialisable row.
 */
export function toTripRow(trip: {
  id: string;
  date: Date;
  km: number;
  purpose: string;
  bookingId: string | null;
  notes: string | null;
}): TripRow {
  return {
    id: trip.id,
    date: trip.date.toISOString(),
    km: trip.km,
    purpose: trip.purpose,
    bookingId: trip.bookingId,
    notes: trip.notes,
  };
}

/**
 * Half-open window check on ISO bounds, through the tax maths' {@link inFy} so the trips
 * page and the Tax page draw the FY edge in the same place.
 * @param iso - Date to test (ledger scale).
 * @param startISO - Inclusive start.
 * @param endISO - Exclusive end.
 * @returns True when start <= iso < end.
 */
export function isInWindow(iso: string, startISO: string, endISO: string): boolean {
  return inFy(iso, { start: new Date(startISO), end: new Date(endISO) });
}

/**
 * Picks the FY a `?fy=` key names. A given key must match exactly (an unknown key yields
 * undefined, so an API can 404 and a page can fall back); no key means the current FY,
 * or the newest listed when none is current.
 * @param fys - Financial years to choose from.
 * @param key - FY key such as "2026-27", or undefined.
 * @returns The matching FY, or undefined.
 */
export function pickFy<T extends { label: string; current: boolean }>(
  fys: readonly T[],
  key: string | undefined,
): T | undefined {
  if (key) return fys.find((f) => fyKeyOf(f.label) === key);
  return fys.find((f) => f.current) ?? fys[0];
}

/**
 * Total km across trips, rounded to 0.1 km so float noise (0.1 + 0.2) never shows.
 * @param trips - Trips to add up.
 * @returns Total km.
 */
export function sumTripKm(trips: readonly { km: number }[]): number {
  return Math.round(trips.reduce((sum, t) => sum + t.km, 0) * 10) / 10;
}

/**
 * Newest first; trips on the same day fall back to id, newest ObjectId first.
 * @param trips - Trips in any order.
 * @returns A sorted copy.
 */
export function sortTrips(trips: readonly TripRow[]): TripRow[] {
  return [...trips].sort((a, b) =>
    a.date === b.date ? b.id.localeCompare(a.id) : a.date < b.date ? 1 : -1,
  );
}

/**
 * Date the add form starts on: today when it falls in the FY, the FY's last day for a
 * past FY, or its first day for one that hasn't started.
 * @param startISO - FY start (inclusive ISO, ledger scale).
 * @param endISO - FY end (exclusive ISO, ledger scale).
 * @param todayKey - Today's NZ date as YYYY-MM-DD.
 * @returns A YYYY-MM-DD date inside the FY.
 */
export function defaultTripDate(startISO: string, endISO: string, todayKey: string): string {
  const today = `${todayKey}T00:00:00.000Z`;
  if (isInWindow(today, startISO, endISO)) return todayKey;
  if (today < startISO) return startISO.slice(0, 10);
  return new Date(Date.parse(endISO) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Km for display: thousands separators and at most one decimal ("14,000 km", "12.3 km").
 * @param km - Distance in km.
 * @returns Formatted distance.
 */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} km`;
}

/**
 * Match key for an address: collapsed whitespace, lower case.
 * @param address - Address as stored on a booking.
 * @returns The key.
 */
export function addressKey(address: string): string {
  return address.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Round-trip km per address from trips already logged against bookings, the latest trip
 * per address winning. Trips without a booking, or whose booking has no address, are
 * skipped.
 * @param trips - Logged trips with their booking link and ISO date.
 * @param addressById - Booking address by booking id.
 * @returns Km by {@link addressKey}.
 */
export function kmByAddressFrom(
  trips: readonly { bookingId: string | null; km: number; date: string }[],
  addressById: ReadonlyMap<string, string | null>,
): Map<string, number> {
  const latest = new Map<string, { km: number; date: string }>();
  for (const t of trips) {
    if (!t.bookingId) continue;
    const address = addressById.get(t.bookingId);
    if (!address) continue;
    const key = addressKey(address);
    const prev = latest.get(key);
    if (!prev || t.date > prev.date) latest.set(key, { km: t.km, date: t.date });
  }
  return new Map([...latest].map(([key, v]) => [key, v.km]));
}

/**
 * Whether a booking was a job driven to. Completed jobs count; a confirmed job counts
 * once it has ended, unless reconcile flagged its calendar event as gone (the job was
 * called off in Calendar); a no-show counts because the drive still happened. Remote
 * jobs and holds never do.
 * @param b - The booking.
 * @param now - Reference time.
 * @returns True when the job needs a trip.
 */
function isDrivenJob(b: TripCandidate, now: Date): boolean {
  if (b.meetingType === "remote") return false;
  switch (b.status) {
    case "completed":
      return true;
    case "confirmed":
      return b.endAt < now && b.calendarEventMissingAt === null;
    case "cancelled":
      return b.noShow;
    case "held":
      return false;
  }
}

/**
 * Jobs in the FY that still need a trip, newest first. One suggestion per booking: travel
 * is one round trip per job. A booking's start is a real instant while the FY window is
 * on the ledger scale, so each job is placed on its NZ day before the window check.
 * @param candidates - Bookings around the FY (the caller pads the query by a day).
 * @param ctx - Linked bookings, km by address, the FY window and now.
 * @returns The suggestions.
 */
export function suggestTrips(
  candidates: readonly TripCandidate[],
  ctx: SuggestContext,
): TripSuggestion[] {
  const out: TripSuggestion[] = [];
  for (const b of candidates) {
    if (!isDrivenJob(b, ctx.now) || ctx.linkedBookingIds.has(b.id)) continue;
    const dayIso = nzDayStartUtc(b.startAt).toISOString();
    if (!isInWindow(dayIso, ctx.startISO, ctx.endISO)) continue;
    const there = b.travelMinsAtBooking;
    const name = b.name.trim();
    out.push({
      bookingId: b.id,
      date: dayIso.slice(0, 10),
      name,
      address: b.address,
      // Legacy rows have no return leg; it mirrors the outbound, as the booking code does.
      travelMins: there === null ? null : there + (b.travelMinsBackAtBooking ?? there),
      suggestedKm: b.address ? (ctx.kmByAddress.get(addressKey(b.address)) ?? null) : null,
      purpose: `Job: ${name}${b.noShow ? " (no-show)" : ""}`,
      noShow: b.noShow,
    });
  }
  return out.sort((a, b) =>
    a.date === b.date ? b.bookingId.localeCompare(a.bookingId) : a.date < b.date ? 1 : -1,
  );
}

/**
 * Km inputs for the suggestions list: what was already typed for a job survives a
 * refresh, a new job starts from its suggested km (or blank), and jobs no longer listed
 * drop out.
 * @param suggestions - Current suggestions.
 * @param prev - Drafts typed so far, by booking id.
 * @returns Drafts by booking id.
 */
export function kmDraftsFor(
  suggestions: readonly TripSuggestion[],
  prev: Readonly<Record<string, string>>,
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const s of suggestions) {
    drafts[s.bookingId] =
      prev[s.bookingId] ?? (s.suggestedKm === null ? "" : String(s.suggestedKm));
  }
  return drafts;
}
