// src/features/calendar/lib/running-late.ts
// Pure rules for the running-late push and the morning summary: how late a drive makes you,
// whether an alert is due given the last one sent, where the drive starts, the push wording,
// and the OwnTracks location body.

import type { LocatedCommitment } from "@/features/calendar/lib/travel-timeline";
import { NZ_TZ } from "@/shared/lib/timezone-utils";

export type RunningLateMode = "live" | "morning";

// Fallbacks only: the live values are the comms settings runningLateRepeatMin,
// phoneLocationFreshHours and phoneLocationMaxAccuracyM.
/** A live alert repeats only once the job has got at least this much later. */
export const REALERT_STEP_MIN = 10;

/** A phone location older than this falls back to the schedule's guess. */
export const LOCATION_FRESH_MS = 2 * 60 * 60_000;

/** A phone location less precise than this (metres) is ignored. */
export const LOCATION_MAX_ACCURACY_M = 1000;

/** The last live alert sent for a job, as stored. */
export interface PriorAlert {
  lateMin: number;
  jobStartAt: Date;
}

/**
 * Whole minutes a drive puts you past a job's start; zero or negative when you're on time.
 * Rounded up, so a partial minute late counts.
 * @param departMs - When you set off (ms).
 * @param driveMin - Drive time in minutes.
 * @param startMs - The job's start (ms).
 * @returns Minutes late.
 */
export function minutesLate(departMs: number, driveMin: number, startMs: number): number {
  return Math.ceil((departMs + driveMin * 60_000 - startMs) / 60_000);
}

/**
 * Whether the live check should push for this job now. Under the threshold never alerts. A job
 * with no alert, or one sent before the job moved, always alerts; after that it repeats only
 * when the job has got `repeatStepMin`+ minutes later than the last alert said.
 * @param lateMin - Minutes late now.
 * @param jobStartAt - The job's current start.
 * @param thresholdMin - Minutes late before any alert.
 * @param prior - The last alert sent for this job, if any.
 * @param repeatStepMin - How much later a job must get before a repeat push.
 * @returns True when a push should go.
 */
export function shouldAlert(
  lateMin: number,
  jobStartAt: Date,
  thresholdMin: number,
  prior: PriorAlert | null,
  repeatStepMin = REALERT_STEP_MIN,
): boolean {
  if (lateMin < thresholdMin) return false;
  if (!prior || prior.jobStartAt.getTime() !== jobStartAt.getTime()) return true;
  return lateMin >= prior.lateMin + repeatStepMin;
}

/** Your phone's latest reading. */
export interface PhoneLocation {
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: Date;
}

/**
 * Whether a phone reading is recent and precise enough to drive from. OwnTracks' Significant
 * mode only reports when you move, so a reading a couple of hours old usually still holds.
 * @param loc - The stored reading, if any.
 * @param nowMs - Current time (ms).
 * @param freshMs - Oldest reading still trusted (ms).
 * @param maxAccuracyM - Least precise reading still trusted (metres).
 * @returns True when the reading can stand in for where you are.
 */
export function isUsableLocation(
  loc: PhoneLocation | null,
  nowMs: number,
  freshMs = LOCATION_FRESH_MS,
  maxAccuracyM = LOCATION_MAX_ACCURACY_M,
): loc is PhoneLocation {
  if (!loc) return false;
  if (nowMs - loc.at.getTime() > freshMs) return false;
  return loc.accuracyM == null || loc.accuracyM <= maxAccuracyM;
}

/** Where and when the drive to a job starts. */
export interface DriveStart {
  origin: string;
  departMs: number;
}

/**
 * Where the drive to a job starts and when. The origin precedence:
 * 1. A manual origin on the job's travel block.
 * 2. Live only, with no earlier commitment still running: your phone's location, leaving now.
 * 3. The latest commitment ending within the lookahead before the job, leaving at its end.
 * 4. Home.
 * The morning check skips legs from home (you choose
 * when to leave) unless a manual origin is set. Neither check departs before now: a job that
 * ended earlier means you're free to go straight away.
 * @param mode - Which check is running.
 * @param jobStartMs - The job's start (ms).
 * @param timeline - Located commitments; the job itself and anything overlapping it are skipped.
 * @param opts - Everything else the choice depends on.
 * @param opts.nowMs - Current time (ms).
 * @param opts.lookaheadMs - How long before the job an earlier commitment still counts.
 * @param opts.homeAddress - Base address.
 * @param opts.customOrigin - Manual origin on the job's travel block, if any.
 * @param opts.phone - A usable phone location, if any.
 * @returns The drive start, or null when there's nothing to check.
 */
export function chooseDriveStart(
  mode: RunningLateMode,
  jobStartMs: number,
  timeline: LocatedCommitment[],
  opts: {
    nowMs: number;
    lookaheadMs: number;
    homeAddress: string;
    customOrigin: string | null;
    phone: PhoneLocation | null;
  },
): DriveStart | null {
  let prev: LocatedCommitment | undefined;
  for (const c of timeline) {
    if (c.startMs >= jobStartMs || c.endMs > jobStartMs) continue;
    if (jobStartMs - c.endMs > opts.lookaheadMs) continue;
    if (!prev || c.endMs > prev.endMs) prev = c;
  }
  const prevDepart = prev ? Math.max(prev.endMs, opts.nowMs) : opts.nowMs;

  if (opts.customOrigin) return { origin: opts.customOrigin, departMs: prevDepart };
  // You're at a commitment that hasn't ended: its end, not the phone, says when you leave.
  const prevRunning = prev && prev.startMs <= opts.nowMs && prev.endMs > opts.nowMs;
  if (mode === "live" && opts.phone && !prevRunning) {
    return { origin: `${opts.phone.lat},${opts.phone.lng}`, departMs: opts.nowMs };
  }
  if (prev) return { origin: prev.leaveFrom, departMs: prevDepart };
  if (mode === "morning" || !opts.homeAddress) return null;
  return { origin: opts.homeAddress, departMs: opts.nowMs };
}

/**
 * Short NZ time like "2:30pm".
 * @param ms - Instant (ms).
 * @returns Lowercase 12-hour time.
 */
export function nzTimeLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(ms))
    .replace(/\s/g, "")
    .toLowerCase();
}

/**
 * Live push title and body. Name and times only, since it shows on a lock screen.
 * @param name - Customer name or event title.
 * @param startMs - The job's start (ms).
 * @param lateMin - Minutes late.
 * @param arriveMs - Expected arrival (ms).
 * @returns Title and body.
 */
export function runningLateText(
  name: string,
  startMs: number,
  lateMin: number,
  arriveMs: number,
): { title: string; body: string } {
  return {
    title: "Running late",
    body: `${name} ${nzTimeLabel(startMs)} - traffic has you ~${lateMin} min late (arriving ~${nzTimeLabel(arriveMs)})`,
  };
}

/** One job in the morning summary. */
export interface SummaryJob {
  startMs: number;
  name: string;
  remote: boolean;
  /** Minutes late after the job before, when the gap is tight; null otherwise. */
  lateMin: number | null;
}

/**
 * Morning summary push: a count in the title, then one line per job in time order, with
 * remote jobs and tight gaps marked.
 * @param jobs - Today's remaining jobs.
 * @returns Title and body.
 */
export function dailySummaryText(jobs: SummaryJob[]): { title: string; body: string } {
  const lines = jobs
    .toSorted((a, b) => a.startMs - b.startMs)
    .map((j) => {
      let line = `${nzTimeLabel(j.startMs)} ${j.name}`;
      if (j.remote) line += " (remote)";
      if (j.lateMin != null) line += ` - tight gap, ~${j.lateMin} min late`;
      return line;
    });
  return {
    title: `Today: ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`,
    body: lines.join("\n"),
  };
}

/**
 * Reads an OwnTracks HTTP body. Only `_type: "location"` with numeric lat/lon in range counts;
 * every other message type (transition, waypoint, lwt) returns null. `tst` is epoch seconds
 * and falls back to now when missing.
 * @param body - Parsed JSON body.
 * @param nowMs - Current time (ms), for a missing timestamp.
 * @returns The reading, or null when it isn't a usable location.
 */
export function parseOwnTracksLocation(body: unknown, nowMs: number): PhoneLocation | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b._type !== "location") return null;
  const { lat, lon, acc, tst } = b;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const atMs = typeof tst === "number" && Number.isFinite(tst) ? tst * 1000 : nowMs;
  return {
    lat,
    lng: lon,
    accuracyM: typeof acc === "number" && Number.isFinite(acc) ? acc : null,
    // A clock ahead of the server would read as fresh for longer than it is.
    at: new Date(Math.min(atMs, nowMs)),
  };
}

/**
 * The password half of an HTTP Basic Authorization header.
 * @param header - Raw Authorization header, or null.
 * @returns The password, or null when the header isn't Basic or doesn't decode.
 */
export function basicAuthPassword(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon >= 0 ? decoded.slice(colon + 1) : null;
}
