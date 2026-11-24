// src/features/calendar/lib/running-late.server.ts
// Travel alerts: the live running-late check (prices the drive to each upcoming customer job with
// live traffic and pushes when it lands you past the start, or a leave reminder when you're out
// and it's nearly time to go), a once-a-day warning when the phone missed reporting a trip, and
// the 7am summary of today's jobs.
// Run by the check-running-late cron, by OwnTracks location reports and from the Travel alerts
// page.

import { CALENDAR_EVENT_PRESENT_FILTER } from "@/features/booking/lib/booking";
import {
  fetchAllCalendarEventsDetailed,
  getBookingCalendarId,
} from "@/features/calendar/lib/google-calendar";
import {
  chooseDriveStart,
  dailySummaryText,
  distanceM,
  isUsableLocation,
  leaveReminderText,
  minutesLate,
  phoneQuietText,
  phoneWentQuiet,
  runningLateText,
  shouldAlert,
  shouldRemindLeave,
  type PhoneLocation,
  type RunningLateMode,
  type SummaryJob,
} from "@/features/calendar/lib/running-late";
import { calculateTravelMinutes, type TransportMode } from "@/features/calendar/lib/travel-time";
import { bookingLocation, buildTimeline } from "@/features/calendar/lib/travel-timeline";
import { sendOwnerPush, type OwnerPushResult } from "@/features/notifications/lib/push";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import {
  addDaysToDateKey,
  dateKeyParts,
  nzDateKey,
  nzMidnightUtc,
} from "@/shared/lib/timezone-utils";

/** Alerts for jobs older than this are deleted. */
const ALERT_RETENTION_MS = 2 * 24 * 60 * 60_000;
/** Key of the single OperatorLocation row. */
export const OWNER_LOCATION_KEY = "owner";
/** Setting row holding the last run of each check, for the Travel alerts page. */
const LAST_RUN_KEY_PREFIX = "travel-alerts:last-run:";
/** Setting row caching the home address's coordinates, keyed by the address it was looked up for. */
const HOME_GEO_KEY = "travel-alerts:home-geo";

/**
 * Coordinates of home: the base address's saved coordinates, else a geocode cached until the
 * address changes.
 * @param address - The base address line.
 * @param saved - The base address's saved coordinates, when set.
 * @param saved.lat - Saved latitude.
 * @param saved.lng - Saved longitude.
 * @returns The point, or null when it can't be looked up.
 */
export async function homePoint(
  address: string,
  saved: { lat: number | null; lng: number | null },
): Promise<{ lat: number; lng: number } | null> {
  if (saved.lat != null && saved.lng != null) return { lat: saved.lat, lng: saved.lng };
  if (!address) return null;
  const row = await prisma.setting.findUnique({ where: { key: HOME_GEO_KEY } });
  if (row) {
    try {
      const cached = JSON.parse(row.value) as { address: string; lat: number; lng: number };
      if (cached.address === address) return { lat: cached.lat, lng: cached.lng };
    } catch {
      // Unreadable cache: look it up again.
    }
  }
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:NZ");
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as {
      status: string;
      results: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    const loc = data.results[0]?.geometry?.location;
    if (data.status !== "OK" || !loc) {
      console.warn(`[running-late] home geocode failed: ${data.status}`);
      return null;
    }
    const value = JSON.stringify({ address, lat: loc.lat, lng: loc.lng });
    await prisma.setting.upsert({
      where: { key: HOME_GEO_KEY },
      create: { key: HOME_GEO_KEY, value },
      update: { value },
    });
    return loc;
  } catch (error) {
    console.warn("[running-late] home geocode failed:", error);
    return null;
  }
}

/**
 * Pushes the quiet-phone warning unless today's has already gone.
 * @param todayKey - Today's NZ date key.
 * @param phoneAtMs - When the phone last reported (ms).
 * @param now - Run time.
 * @param result - Run result to count the push in.
 */
async function warnPhoneQuiet(
  todayKey: string,
  phoneAtMs: number,
  now: Date,
  result: RunningLateResult,
): Promise<void> {
  const key = `phone-quiet:${todayKey}`;
  const claimed = await claimAlert(key, null, {
    mode: "phone-quiet",
    lateMin: 0,
    jobStartAt: nzMidnightUtc(...dateKeyParts(todayKey)),
    sentAt: now,
  });
  if (!claimed) return;
  const push = await sendOwnerPush({
    ...phoneQuietText(phoneAtMs, now.getTime()),
    url: "/admin/travel-alerts",
    tag: key,
  });
  if (push.sent > 0) result.alerted++;
  if (pushFailed(push)) {
    result.failed++;
    result.errors.push(`${key}: push not delivered`);
    await releaseAlert(key, now, null);
  }
}

/** What started a run. */
export type RunSource = "cron" | "location" | "manual";

/** One customer job the check looks at. */
interface Target {
  key: string;
  name: string;
  startMs: number;
  /** Job address; null for a remote job or an event without one. */
  location: string | null;
  remote: boolean;
  url: string;
  /** Calendar event id, for its travel block. */
  eventId: string | null;
}

/** What one run did. */
export interface RunningLateResult {
  /** Jobs whose drive was priced. */
  checked: number;
  /** Pushes delivered. */
  alerted: number;
  failed: number;
  /** Morning only: jobs in the summary. */
  jobs?: number;
  skipped?: "disabled" | "calendar-unavailable" | "no-jobs" | "already-sent";
  errors: string[];
}

/** The last run of a check, as the Travel alerts page shows it. */
export interface LastRun extends RunningLateResult {
  at: string;
  source: RunSource;
}

/**
 * Your latest phone reading, or null when none is stored.
 * @returns The stored reading.
 */
export async function readPhoneLocation(): Promise<PhoneLocation | null> {
  const row = await prisma.operatorLocation.findUnique({ where: { key: OWNER_LOCATION_KEY } });
  return row ? { lat: row.lat, lng: row.lng, accuracyM: row.accuracyM, at: row.at } : null;
}

/**
 * The last recorded run of each check.
 * @returns Last live and morning runs, or null for one that hasn't run.
 */
export async function readLastRuns(): Promise<Record<RunningLateMode, LastRun | null>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [`${LAST_RUN_KEY_PREFIX}live`, `${LAST_RUN_KEY_PREFIX}morning`] } },
  });
  /**
   * Parses one stored run.
   * @param mode - Which check.
   * @returns The run, or null when missing or unreadable.
   */
  const parse = (mode: RunningLateMode): LastRun | null => {
    const value = rows.find((r) => r.key === `${LAST_RUN_KEY_PREFIX}${mode}`)?.value;
    if (!value) return null;
    try {
      return JSON.parse(value) as LastRun;
    } catch {
      return null;
    }
  };
  return { live: parse("live"), morning: parse("morning") };
}

/**
 * Records a run for the Travel alerts page. Best-effort: a failed write never fails the check.
 * @param mode - Which check ran.
 * @param source - What started it.
 * @param result - What it did.
 * @param now - When it ran.
 */
async function recordRun(
  mode: RunningLateMode,
  source: RunSource,
  result: RunningLateResult,
  now: Date,
): Promise<void> {
  const value = JSON.stringify({ ...result, at: now.toISOString(), source } satisfies LastRun);
  const key = `${LAST_RUN_KEY_PREFIX}${mode}`;
  await prisma.setting
    .upsert({ where: { key }, create: { key, value }, update: { value } })
    .catch((err: unknown) => console.error("[travel-alerts] record run failed", err));
}

/**
 * Saves an alert, guarded so two overlapping runs can't both send: a new key's row is a create
 * on its unique key, and an existing one updates only while `sentAt` still matches.
 * @param key - Alert key.
 * @param prior - The row read before deciding, if any.
 * @param prior.sentAt - When that row was last sent.
 * @param data - New alert fields.
 * @param data.mode - "live", or "summary" for the morning push.
 * @param data.lateMin - Minutes late this alert reports (0 for the summary).
 * @param data.jobStartAt - The job's start, or the summary's day; old rows are pruned by it.
 * @param data.sentAt - Send time, which the next claim matches on.
 * @returns True when this run claimed the send.
 */
async function claimAlert(
  key: string,
  prior: { sentAt: Date } | null,
  data: { mode: string; lateMin: number; jobStartAt: Date; sentAt: Date },
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
 * Hands a claim back after a push that reached no device, so the next run tries again: restores
 * the prior row, or deletes a new one.
 * @param key - Alert key.
 * @param sentAt - The claim's send time.
 * @param prior - The row before the claim, if any.
 */
async function releaseAlert(
  key: string,
  sentAt: Date,
  prior: { mode: string; lateMin: number; jobStartAt: Date; sentAt: Date } | null,
): Promise<void> {
  const release = prior
    ? prisma.runningLateAlert.updateMany({
        where: { key, sentAt },
        data: {
          mode: prior.mode,
          lateMin: prior.lateMin,
          jobStartAt: prior.jobStartAt,
          sentAt: prior.sentAt,
        },
      })
    : prisma.runningLateAlert.deleteMany({ where: { key, sentAt } });
  await release.catch((err: unknown) =>
    console.error(`[travel-alerts] release ${key} failed`, err),
  );
}

/**
 * Whether a push needs retrying: it reached no device for a reason that may pass. No devices or
 * no VAPID keys keep the claim, so it doesn't retry every 10 minutes.
 * @param push - What the send did.
 * @returns True when the claim should be handed back.
 */
function pushFailed(push: OwnerPushResult): boolean {
  if (push.sent > 0) return false;
  return push.skipped !== "no-devices" && push.skipped !== "not-configured";
}

/**
 * Runs one check and records it for the Travel alerts page.
 *
 * Live: customer jobs starting within the look-ahead window, priced with live traffic, leaving no earlier
 * than now and from your phone's location when it's fresh. A push per late job.
 *
 * Morning: one push listing the rest of today's customer jobs, when there are any. Gaps that
 * predicted traffic after the job before makes late are marked on the job (legs from home are
 * left out, since you choose when to leave home).
 *
 * Customer jobs are confirmed bookings plus timed booking-calendar events. A failed drive lookup
 * never alerts.
 * @param mode - Which check to run.
 * @param now - Current time.
 * @param source - What started the run.
 * @returns Counts for the response.
 */
export async function runRunningLateCheck(
  mode: RunningLateMode,
  now: Date,
  source: RunSource = "cron",
): Promise<RunningLateResult> {
  const result = await runCheck(mode, now, source === "manual");
  await recordRun(mode, source, result, now);
  return result;
}

/**
 * The check itself; see {@link runRunningLateCheck}.
 * @param mode - Which check to run.
 * @param now - Current time.
 * @param manual - Run from the page: the summary sends even if today's has already gone.
 * @returns Counts for the response.
 */
async function runCheck(
  mode: RunningLateMode,
  now: Date,
  manual: boolean,
): Promise<RunningLateResult> {
  const result: RunningLateResult = { checked: 0, alerted: 0, failed: 0, errors: [] };
  const { comms, scheduling, identity } = await getSettings();
  const enabled =
    mode === "live" ? comms.pushOnRunningLate || comms.pushLeaveReminder : comms.pushDailySummary;
  if (!enabled) return { ...result, skipped: "disabled" };

  const nowMs = now.getTime();
  const todayKey = nzDateKey(now);
  const summaryKey = `summary:${todayKey}`;
  await prisma.runningLateAlert.deleteMany({
    where: { jobStartAt: { lt: new Date(nowMs - ALERT_RETENTION_MS) } },
  });
  const summaryPrior =
    mode === "morning" && !manual
      ? await prisma.runningLateAlert.findUnique({ where: { key: summaryKey } })
      : null;
  if (summaryPrior) return { ...result, skipped: "already-sent" };

  const windowEnd =
    mode === "live"
      ? new Date(nowMs + comms.runningLateWindowHours * 60 * 60_000)
      : nzMidnightUtc(...dateKeyParts(addDaysToDateKey(todayKey, 1)));
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

  // Quiet phone: you've been at a job since OwnTracks last reported. Once per NZ day.
  if (mode === "live" && comms.pushPhoneQuiet && phone) {
    const dayStartMs = nzMidnightUtc(...dateKeyParts(todayKey)).getTime();
    const today = timeline.filter((c) => c.startMs >= dayStartMs);
    if (phoneWentQuiet(phone.at.getTime(), nowMs, today, homeAddress)) {
      await warnPhoneQuiet(todayKey, phone.at.getTime(), now, result);
    }
  }

  // Customer jobs inside the window.
  const targets: Target[] = [];
  for (const b of bookings) {
    const startMs = b.startAt.getTime();
    if (startMs <= nowMs || startMs >= windowEnd.getTime()) continue;
    const remote = b.meetingType === "remote";
    targets.push({
      key: `booking:${b.id}`,
      name: b.name,
      startMs,
      location: remote ? null : bookingLocation(b),
      remote,
      url: `/admin/bookings/${b.id}`,
      eventId: b.calendarEventId,
    });
  }
  for (const e of events) {
    if (e.calendarEmail !== bookingCalId) continue;
    const startMs = new Date(e.start).getTime();
    if (startMs <= nowMs || startMs >= windowEnd.getTime()) continue;
    targets.push({
      key: `event:${e.id}`,
      name: e.summary?.trim() || "Job",
      startMs,
      location: e.location?.trim() || null,
      remote: false,
      url: `/admin/schedule?day=${nzDateKey(new Date(startMs))}`,
      eventId: e.id,
    });
  }

  if (mode === "morning" && targets.length === 0) return { ...result, skipped: "no-jobs" };

  const priors =
    mode === "live"
      ? await prisma.runningLateAlert.findMany({
          where: { key: { in: targets.flatMap((t) => [t.key, `leave:${t.key}`]) } },
        })
      : [];
  const priorByKey = new Map(priors.map((p) => [p.key, p]));
  const usablePhone = isUsableLocation(
    phone,
    nowMs,
    comms.phoneLocationFreshHours * 60 * 60_000,
    comms.phoneLocationMaxAccuracyM,
  )
    ? phone
    : null;
  // Leave reminders need to know you're out: no reminder without a home point to compare.
  let awayFromHome = false;
  if (mode === "live" && usablePhone && comms.pushLeaveReminder) {
    const home = await homePoint(homeAddress, identity.baseAddress);
    awayFromHome = home !== null && distanceM(usablePhone, home) > comms.atHomeRadiusM;
  }
  // Tight gaps go in the morning summary only while the running-late push is on.
  const priceDrives = mode === "live" || comms.pushOnRunningLate;
  const lateByKey = new Map<string, number>();

  for (const t of targets) {
    if (!priceDrives || !t.location) continue;
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
      { mode: travelMode },
    );
    if (driveMin == null) continue;

    const lateMin = minutesLate(start.departMs, driveMin, t.startMs);
    if (mode === "morning") {
      if (lateMin >= comms.runningLateThresholdMin) lateByKey.set(t.key, lateMin);
      continue;
    }

    const jobStartAt = new Date(t.startMs);
    const prior = priorByKey.get(t.key) ?? null;
    if (
      comms.pushOnRunningLate &&
      shouldAlert(
        lateMin,
        jobStartAt,
        comms.runningLateThresholdMin,
        prior,
        comms.runningLateRepeatMin,
      )
    ) {
      if (await claimAlert(t.key, prior, { mode, lateMin, jobStartAt, sentAt: now })) {
        const push = await sendOwnerPush({
          ...runningLateText(t.name, t.startMs, lateMin, start.departMs + driveMin * 60_000),
          url: t.url,
          tag: `running-late:${t.key}`,
        });
        if (push.sent > 0) result.alerted++;
        if (pushFailed(push)) {
          result.failed++;
          result.errors.push(`${t.key}: push not delivered`);
          await releaseAlert(t.key, now, prior);
        }
      }
      continue;
    }

    // Leave reminder: only from a fresh phone location away from home, once per job start.
    const leaveKey = `leave:${t.key}`;
    const leavePrior = priorByKey.get(leaveKey) ?? null;
    const leaveByMs = t.startMs - driveMin * 60_000;
    if (
      !comms.pushLeaveReminder ||
      !start.fromPhone ||
      !awayFromHome ||
      leavePrior?.jobStartAt.getTime() === t.startMs ||
      !shouldRemindLeave(
        leaveByMs,
        nowMs,
        comms.leaveReminderLeadMin,
        lateMin,
        comms.runningLateThresholdMin,
      )
    ) {
      continue;
    }
    if (
      !(await claimAlert(leaveKey, leavePrior, { mode: "leave", lateMin, jobStartAt, sentAt: now }))
    ) {
      continue;
    }
    const push = await sendOwnerPush({
      ...leaveReminderText(t.name, t.startMs, leaveByMs, driveMin, nowMs),
      url: t.url,
      tag: `leave:${t.key}`,
    });
    if (push.sent > 0) result.alerted++;
    if (pushFailed(push)) {
      result.failed++;
      result.errors.push(`${leaveKey}: push not delivered`);
      await releaseAlert(leaveKey, now, leavePrior);
    }
  }

  if (mode === "live") return result;

  // Morning: one push for the day.
  result.jobs = targets.length;
  const jobs: SummaryJob[] = targets.map((t) => ({
    startMs: t.startMs,
    name: t.name,
    remote: t.remote,
    lateMin: lateByKey.get(t.key) ?? null,
  }));
  // A manual send isn't recorded, so it never stops the 7am one.
  const claimed =
    manual ||
    (await claimAlert(summaryKey, null, {
      mode: "summary",
      lateMin: 0,
      jobStartAt: nzMidnightUtc(...dateKeyParts(todayKey)),
      sentAt: now,
    }));
  if (!claimed) return { ...result, skipped: "already-sent" };
  const push = await sendOwnerPush({
    ...dailySummaryText(jobs),
    url: `/admin/schedule?day=${todayKey}`,
    tag: summaryKey,
  });
  if (push.sent > 0) result.alerted++;
  if (pushFailed(push)) {
    result.failed++;
    result.errors.push("summary: push not delivered");
    if (!manual) await releaseAlert(summaryKey, now, null);
  }
  return result;
}
