// src/features/calendar/lib/running-late.server.ts
// The running-late check: prices the drive to each upcoming customer job with live traffic and
// pushes when it lands you past the start. Run by the check-running-late cron and by OwnTracks
// location reports.

import { CALENDAR_EVENT_PRESENT_FILTER } from "@/features/booking/lib/booking";
import {
  fetchAllCalendarEventsDetailed,
  getBookingCalendarId,
} from "@/features/calendar/lib/google-calendar";
import {
  chooseDriveStart,
  isUsableLocation,
  minutesLate,
  runningLateText,
  shouldAlert,
  type PhoneLocation,
  type RunningLateMode,
} from "@/features/calendar/lib/running-late";
import { calculateTravelMinutes, type TransportMode } from "@/features/calendar/lib/travel-time";
import { bookingLocation, buildTimeline } from "@/features/calendar/lib/travel-timeline";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import {
  addDaysToDateKey,
  dateKeyParts,
  nzDateKey,
  nzMidnightUtc,
} from "@/shared/lib/timezone-utils";

/** How far ahead the live check looks for jobs. */
const LIVE_HORIZON_MS = 3 * 60 * 60_000;
/** Alerts for jobs older than this are deleted. */
const ALERT_RETENTION_MS = 2 * 24 * 60 * 60_000;
/** Key of the single OperatorLocation row. */
export const OWNER_LOCATION_KEY = "owner";

/** One customer job the check looks at. */
interface Target {
  key: string;
  name: string;
  startMs: number;
  location: string;
  url: string;
  /** Calendar event id, for its travel block. */
  eventId: string | null;
}

/** What one run did. */
export interface RunningLateResult {
  checked: number;
  alerted: number;
  failed: number;
  skipped?: "disabled" | "calendar-unavailable";
  errors: string[];
}

/**
 * Your latest phone reading, or null when none is stored.
 * @returns The stored reading.
 */
async function readPhoneLocation(): Promise<PhoneLocation | null> {
  const row = await prisma.operatorLocation.findUnique({ where: { key: OWNER_LOCATION_KEY } });
  return row ? { lat: row.lat, lng: row.lng, accuracyM: row.accuracyM, at: row.at } : null;
}

/**
 * Saves the job's alert, guarded so two overlapping runs can't both send: a new job's row is a
 * create on its unique key, and an existing one updates only while `sentAt` still matches.
 * @param key - Alert key.
 * @param prior - The row read before deciding, if any.
 * @param prior.sentAt - When that row was last sent.
 * @param data - New alert fields.
 * @param data.mode - Which check is sending.
 * @param data.lateMin - Minutes late this alert reports.
 * @param data.jobStartAt - The job's start at send time.
 * @param data.sentAt - Send time, which the next claim matches on.
 * @returns True when this run claimed the send.
 */
async function claimAlert(
  key: string,
  prior: { sentAt: Date } | null,
  data: { mode: RunningLateMode; lateMin: number; jobStartAt: Date; sentAt: Date },
): Promise<boolean> {
  if (!prior) {
    try {
      await prisma.runningLateAlert.create({ data: { key, ...data } });
      return true;
    } catch {
      return false; // Unique key taken: another run got there first.
    }
  }
  const res = await prisma.runningLateAlert.updateMany({
    where: { key, sentAt: prior.sentAt },
    data,
  });
  return res.count === 1;
}

/**
 * Checks every upcoming customer job and pushes for any that traffic makes late.
 *
 * Live: jobs starting in the next 3 hours, with live traffic, leaving no earlier than now and
 * from your phone's location when it's fresh. Morning: the rest of today, priced from the end
 * of the job before; legs from home are left out.
 *
 * Customer jobs are confirmed bookings plus timed booking-calendar events with a location;
 * remote bookings are skipped. A failed drive lookup never alerts.
 * @param mode - Which check to run.
 * @param now - Current time.
 * @returns Counts for the cron response.
 */
export async function runRunningLateCheck(
  mode: RunningLateMode,
  now: Date,
): Promise<RunningLateResult> {
  const result: RunningLateResult = { checked: 0, alerted: 0, failed: 0, errors: [] };
  const { comms, scheduling, identity } = await getSettings();
  if (!comms.pushOnRunningLate) return { ...result, skipped: "disabled" };

  const nowMs = now.getTime();
  await prisma.runningLateAlert.deleteMany({
    where: { jobStartAt: { lt: new Date(nowMs - ALERT_RETENTION_MS) } },
  });

  const windowEnd =
    mode === "live"
      ? new Date(nowMs + LIVE_HORIZON_MS)
      : nzMidnightUtc(...dateKeyParts(addDaysToDateKey(nzDateKey(now), 1)));
  const lookaheadMs = scheduling.smartOriginLookaheadHours * 60 * 60_000;
  // Reach back far enough to find the commitment before the first job.
  const fetchFrom = new Date(nowMs - lookaheadMs - 12 * 60 * 60_000);

  // Read live, not the 30s schedule cache: this runs outside a page render.
  const [bookings, calendar, travelBlocks, phone] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { lt: windowEnd },
        endAt: { gte: fetchFrom },
        ...CALENDAR_EVENT_PRESENT_FILTER,
      },
      select: {
        id: true,
        name: true,
        startAt: true,
        endAt: true,
        address: true,
        notes: true,
        meetingType: true,
        calendarEventId: true,
      },
    }),
    fetchAllCalendarEventsDetailed(fetchFrom, windowEnd),
    prisma.travelBlock.findMany({
      where: { eventStartAt: { lt: windowEnd }, eventEndAt: { gte: fetchFrom } },
      select: {
        sourceEventId: true,
        roundedBackMinutes: true,
        afterEventId: true,
        travelBackSuppressed: true,
        customOrigin: true,
        transportMode: true,
      },
    }),
    mode === "live" ? readPhoneLocation() : Promise.resolve(null),
  ]);

  const bookingCalId = getBookingCalendarId();
  // A missing booking calendar would read as no jobs; say so instead of passing silently.
  if (calendar.failedCalendarIds.includes(bookingCalId)) {
    return { ...result, skipped: "calendar-unavailable" };
  }

  const blockByEventId = new Map(travelBlocks.map((b) => [b.sourceEventId, b]));
  const backMinByEventId = new Map<string, number>();
  for (const b of travelBlocks) {
    if (b.afterEventId && !b.travelBackSuppressed && (b.roundedBackMinutes ?? 0) > 0) {
      backMinByEventId.set(b.sourceEventId, b.roundedBackMinutes ?? 0);
    }
  }

  // A booking's own calendar event would put the job on the timeline twice.
  const linkedEventIds = new Set(bookings.map((b) => b.calendarEventId).filter(Boolean));
  const events = calendar.events.filter((e) => !e.allDay && !linkedEventIds.has(e.id));
  const homeAddress = identity.baseAddress.line || process.env.HOME_ADDRESS || "";
  const timeline = buildTimeline(
    bookings.filter((b) => b.meetingType !== "remote"),
    events,
    process.env.PERSONAL_CALENDAR_ID ?? "",
    homeAddress,
    backMinByEventId,
  );

  // Customer jobs inside the window.
  const targets: Target[] = [];
  for (const b of bookings) {
    const startMs = b.startAt.getTime();
    if (startMs <= nowMs || startMs >= windowEnd.getTime() || b.meetingType === "remote") continue;
    const location = bookingLocation(b);
    if (!location) continue;
    targets.push({
      key: `booking:${b.id}`,
      name: b.name,
      startMs,
      location,
      url: `/admin/bookings/${b.id}`,
      eventId: b.calendarEventId,
    });
  }
  for (const e of events) {
    if (e.calendarEmail !== bookingCalId || !e.location) continue;
    const startMs = new Date(e.start).getTime();
    if (startMs <= nowMs || startMs >= windowEnd.getTime()) continue;
    targets.push({
      key: `event:${e.id}`,
      name: e.summary?.trim() || "Job",
      startMs,
      location: e.location,
      url: `/admin/schedule?day=${nzDateKey(new Date(startMs))}`,
      eventId: e.id,
    });
  }

  const priors = await prisma.runningLateAlert.findMany({
    where: { key: { in: targets.map((t) => t.key) } },
  });
  const priorByKey = new Map(priors.map((p) => [p.key, p]));
  const usablePhone = isUsableLocation(phone, nowMs) ? phone : null;

  for (const t of targets) {
    const block = t.eventId ? blockByEventId.get(t.eventId) : undefined;
    const start = chooseDriveStart(mode, t.startMs, timeline, {
      nowMs,
      lookaheadMs,
      homeAddress,
      customOrigin: block?.customOrigin ?? null,
      phone: usablePhone,
    });
    if (!start) continue;
    result.checked++;

    // A job you walk or bus to keeps its own mode; anything else is priced as a drive.
    const travelMode: TransportMode = block?.transportMode ?? "driving";
    const driveMin = await calculateTravelMinutes(
      start.origin,
      t.location,
      new Date(start.departMs),
      {
        mode: travelMode,
      },
    );
    if (driveMin == null) continue;

    const lateMin = minutesLate(start.departMs, driveMin, t.startMs);
    const jobStartAt = new Date(t.startMs);
    const prior = priorByKey.get(t.key) ?? null;
    if (!shouldAlert(mode, lateMin, jobStartAt, comms.runningLateThresholdMin, prior)) continue;

    const claimed = await claimAlert(t.key, prior, { mode, lateMin, jobStartAt, sentAt: now });
    if (!claimed) continue;

    const arriveMs = start.departMs + driveMin * 60_000;
    const push = await sendOwnerPush({
      ...runningLateText(mode, t.name, t.startMs, lateMin, arriveMs),
      url: t.url,
      tag: `running-late:${t.key}`,
    });
    if (push.sent > 0) {
      result.alerted++;
      continue;
    }
    if (push.skipped === "no-devices" || push.skipped === "not-configured") {
      // Nowhere to send: keep the claim, so it doesn't retry every 10 minutes.
      continue;
    }
    // Hand the claim back so the next run tries again.
    result.failed++;
    result.errors.push(`${t.key}: push not delivered`);
    if (prior) {
      await prisma.runningLateAlert
        .updateMany({
          where: { key: t.key, sentAt: now },
          data: {
            mode: prior.mode,
            lateMin: prior.lateMin,
            jobStartAt: prior.jobStartAt,
            sentAt: prior.sentAt,
          },
        })
        .catch((err: unknown) => console.error(`[running-late] release ${t.key} failed`, err));
    } else {
      await prisma.runningLateAlert
        .deleteMany({ where: { key: t.key, sentAt: now } })
        .catch((err: unknown) => console.error(`[running-late] release ${t.key} failed`, err));
    }
  }

  return result;
}
