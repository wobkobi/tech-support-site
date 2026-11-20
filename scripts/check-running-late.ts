// scripts/check-running-late.ts
// Running-late push rules: minutes late, when an alert repeats, where the drive starts (phone,
// previous job, home), the OwnTracks body and the Basic auth password.
// Run with: npm test -- running-late

import {
  basicAuthPassword,
  chooseDriveStart,
  dailySummaryText,
  isUsableLocation,
  minutesLate,
  parseOwnTracksLocation,
  runningLateText,
  shouldAlert,
} from "@/features/calendar/lib/running-late";
import type { LocatedCommitment } from "@/features/calendar/lib/travel-timeline";
import { expect, expectEqual, finish } from "./lib/harness.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * NZ wall-clock time on 20 November 2026 (NZDT, UTC+13) as epoch ms.
 * @param hour - NZ hour.
 * @param minute - NZ minute.
 * @returns The instant in ms.
 */
function nz(hour: number, minute = 0): number {
  return Date.UTC(2026, 10, 20, hour - 13, minute);
}

// Minutes late
expectEqual("on time is zero", minutesLate(nz(13), 30, nz(13, 30)), 0);
expectEqual("17 min late", minutesLate(nz(14), 47, nz(14, 30)), 17);
expectEqual("a partial minute rounds up", minutesLate(nz(14) + 10_000, 30, nz(14, 30)), 1);
expect("early is negative", minutesLate(nz(13), 10, nz(14)) < 0);

// When to alert
const start = new Date(nz(14, 30));
expect("under the threshold never alerts", !shouldAlert(4, start, 5, null));
expect("first time over alerts", shouldAlert(5, start, 5, null));
const prior12 = { lateMin: 12, jobStartAt: start };
expect("same lateness doesn't repeat", !shouldAlert(15, start, 5, prior12));
expect("10+ min worse repeats", shouldAlert(22, start, 5, prior12));
expect("a moved job alerts again", shouldAlert(6, new Date(nz(15)), 5, prior12));
expect("a smaller repeat step repeats sooner", shouldAlert(15, start, 5, prior12, 3));
expect("a bigger repeat step waits longer", !shouldAlert(22, start, 5, prior12, 15));

// Phone location freshness
const now = nz(13);
const fresh = { lat: -36.85, lng: 174.76, accuracyM: 20, at: new Date(now - 30 * MIN) };
expect("a recent reading is usable", isUsableLocation(fresh, now));
expect(
  "over 2 hours old isn't",
  !isUsableLocation({ ...fresh, at: new Date(now - 3 * HOUR) }, now),
);
expect("over 1 km accuracy isn't", !isUsableLocation({ ...fresh, accuracyM: 1500 }, now));
expect("no reading isn't", !isUsableLocation(null, now));
expect(
  "a longer trust window keeps a 3-hour-old reading",
  isUsableLocation({ ...fresh, at: new Date(now - 3 * HOUR) }, now, 4 * HOUR),
);
expect(
  "a tighter accuracy limit drops a rough reading",
  !isUsableLocation({ ...fresh, accuracyM: 300 }, now, 2 * HOUR, 200),
);

// Where the drive starts
const prevJob: LocatedCommitment = {
  startMs: nz(11),
  endMs: nz(12),
  location: "1 Albany Hwy",
  leaveFrom: "1 Albany Hwy",
};
const running: LocatedCommitment = {
  startMs: nz(12),
  endMs: nz(13, 30),
  location: "2 Dominion Rd",
  leaveFrom: "2 Dominion Rd",
};
const opts = {
  nowMs: now,
  lookaheadMs: 4 * HOUR,
  homeAddress: "Home",
  customOrigin: null,
  phone: null,
};
expectEqual(
  "after an earlier job, leave from it no earlier than now",
  chooseDriveStart("live", nz(14, 30), [prevJob], opts),
  { origin: "1 Albany Hwy", departMs: now },
);
expectEqual(
  "a job still running: leave from it at its end, phone ignored",
  chooseDriveStart("live", nz(14, 30), [running], { ...opts, phone: fresh }),
  { origin: "2 Dominion Rd", departMs: nz(13, 30) },
);
expectEqual(
  "nothing running: the phone wins, leaving now",
  chooseDriveStart("live", nz(14, 30), [prevJob], { ...opts, phone: fresh }),
  { origin: "-36.85,174.76", departMs: now },
);
expectEqual(
  "manual origin beats everything",
  chooseDriveStart("live", nz(14, 30), [prevJob], {
    ...opts,
    phone: fresh,
    customOrigin: "Office",
  }),
  { origin: "Office", departMs: now },
);
expectEqual(
  "no earlier job: from home, leaving now",
  chooseDriveStart("live", nz(14, 30), [], opts),
  { origin: "Home", departMs: now },
);
expectEqual(
  "an earlier job past the lookahead doesn't count",
  chooseDriveStart("live", nz(18), [prevJob], opts),
  { origin: "Home", departMs: now },
);
expectEqual(
  "morning skips legs from home",
  chooseDriveStart("morning", nz(14, 30), [], { ...opts, nowMs: nz(7) }),
  null,
);
expectEqual(
  "morning prices from the job before at its end",
  chooseDriveStart("morning", nz(13, 45), [running], { ...opts, nowMs: nz(7) }),
  { origin: "2 Dominion Rd", departMs: nz(13, 30) },
);
expectEqual(
  "the job itself and later ones are ignored",
  chooseDriveStart(
    "live",
    nz(14, 30),
    [{ startMs: nz(14, 30), endMs: nz(15, 30), location: "Job", leaveFrom: "Job" }],
    opts,
  ),
  { origin: "Home", departMs: now },
);

// Push text
const text = runningLateText("Jane Smith", nz(14, 30), 17, nz(14, 47));
expectEqual("live title", text.title, "Running late");
expectEqual(
  "live body",
  text.body,
  "Jane Smith 2:30pm - traffic has you ~17 min late (arriving ~2:47pm)",
);

// Morning summary
const summary = dailySummaryText([
  { startMs: nz(9), name: "Jane Smith", remote: false, lateMin: null },
  { startMs: nz(11, 30), name: "Bob Jones", remote: true, lateMin: null },
  { startMs: nz(13), name: "Ann Lee", remote: false, lateMin: 12 },
]);
expectEqual("summary title counts jobs", summary.title, "Today: 3 jobs");
expectEqual(
  "summary lists each job with remote and tight gaps marked",
  summary.body,
  "9:00am Jane Smith\n11:30am Bob Jones (remote)\n1:00pm Ann Lee - tight gap, ~12 min late",
);
expectEqual(
  "one job is singular",
  dailySummaryText([{ startMs: nz(9), name: "Jane", remote: false, lateMin: null }]).title,
  "Today: 1 job",
);

// OwnTracks body
const tst = Math.floor(nz(12, 55) / 1000);
expectEqual(
  "a location report parses",
  parseOwnTracksLocation({ _type: "location", lat: -36.8, lon: 174.7, acc: 15, tst }, now),
  { lat: -36.8, lng: 174.7, accuracyM: 15, at: new Date(tst * 1000) },
);
expectEqual(
  "a transition isn't a location",
  parseOwnTracksLocation({ _type: "transition", lat: -36.8, lon: 174.7 }, now),
  null,
);
expectEqual(
  "an out-of-range latitude is rejected",
  parseOwnTracksLocation({ _type: "location", lat: 120, lon: 174.7 }, now),
  null,
);
expectEqual(
  "a future timestamp is capped at now",
  parseOwnTracksLocation({ _type: "location", lat: 1, lon: 2, tst: tst + 3600 * 5 }, now)?.at,
  new Date(now),
);

// Basic auth
const header = `Basic ${Buffer.from("phone:s3cr:et").toString("base64")}`;
expectEqual("password after the first colon", basicAuthPassword(header), "s3cr:et");
expectEqual("Bearer isn't Basic", basicAuthPassword("Bearer abc"), null);
expectEqual("no header", basicAuthPassword(null), null);

finish();
