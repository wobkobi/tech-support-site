"use client";
// src/features/admin/components/TravelAlertsView.tsx
// Travel alerts page body: is the phone reporting, did the checks run, what was sent, plus the
// comms settings that drive running-late pushes and the morning summary.

import {
  NumberField,
  SettingsTabBody,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  ADMIN_EYEBROW_CLS,
  ADMIN_LINK_CLS,
  ADMIN_META_LABEL_CLS,
} from "@/features/admin/components/ui/field-classes";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useNowMinute } from "@/features/admin/hooks/use-now-minute";
import { isUsableLocation } from "@/features/calendar/lib/running-late";
import type { LastRun, RunSource } from "@/features/calendar/lib/running-late.server";
import { cn } from "@/shared/lib/cn";
import { COMMS_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { CommsSettings } from "@/shared/lib/settings/types";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";

/** One recent alert row. */
export interface AlertRow {
  id: string;
  label: string;
  /** Which push it was. */
  kind: "late" | "leave" | "summary" | "phone-quiet";
  lateMin: number;
  jobStartAt: string;
  sentAt: string;
}

interface Props {
  initial: CommsSettings;
  defaults: CommsSettings;
  location: { lat: number; lng: number; accuracyM: number | null; at: string } | null;
  lastRuns: { live: LastRun | null; morning: LastRun | null };
  alerts: AlertRow[];
  deviceCount: number;
  secretSet: boolean;
  pushConfigured: boolean;
  ownTracksUrl: string;
}

const SOURCE_LABEL: Record<RunSource, string> = {
  cron: "scheduled",
  location: "phone report",
  manual: "run by hand",
};

const SKIPPED_LABEL: Record<NonNullable<LastRun["skipped"]>, string> = {
  disabled: "turned off in settings",
  "calendar-unavailable": "couldn't read the calendar",
  "no-jobs": "no jobs, nothing sent",
  "already-sent": "already sent today",
};

// The live check runs every 10 min from 6am to 8pm; 40 min allows a few missed runs before
// the page calls it stale.
const LIVE_STALE_MS = 40 * 60_000;
const MORNING_STALE_MS = 26 * 60 * 60_000;

/**
 * "5 min ago" style label.
 * @param iso - Past instant.
 * @param nowMs - Current time (ms).
 * @returns The label.
 */
function ago(iso: string, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * NZ date and time, like "Fri 21 Nov, 2:30pm".
 * @param iso - Instant.
 * @returns The label.
 */
function nzDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/^(\w+),/, "$1")
    .replace(/\s(am|pm)$/i, (m) => m.trim().toLowerCase());
}

/**
 * Whether NZ wall-clock time is inside the live check's 6am-8pm window.
 * @param nowMs - Current time (ms).
 * @returns True inside the window.
 */
function inLiveWindow(nowMs: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-NZ", {
      timeZone: NZ_TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(nowMs)),
  );
  return hour >= 6 && hour < 20;
}

/**
 * One status row: label, pill, and a line of detail.
 * @param props - Component props.
 * @param props.label - What this row reports on.
 * @param props.tone - Pill colour.
 * @param props.status - Pill text.
 * @param props.children - Detail under the pill.
 * @returns Row element.
 */
function StatusRow({
  label,
  tone,
  status,
  children,
}: {
  label: string;
  tone: StatusTone;
  status: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
      <p className={`${ADMIN_META_LABEL_CLS} sm:w-40 sm:shrink-0 sm:pt-0.5`}>{label}</p>
      <div className="min-w-0 space-y-1">
        <StatusPill tone={tone}>{status}</StatusPill>
        {children && <div className="text-base text-admin-text">{children}</div>}
      </div>
    </div>
  );
}

/**
 * Detail line for a recorded run.
 * @param props - Component props.
 * @param props.run - The run.
 * @param props.nowMs - Current time (ms).
 * @param props.summary - True for the morning summary, which reports jobs not alerts.
 * @returns Detail element.
 */
function RunDetail({
  run,
  nowMs,
  summary,
}: {
  run: LastRun;
  nowMs: number;
  summary: boolean;
}): React.ReactElement {
  let what: string;
  if (run.skipped) what = SKIPPED_LABEL[run.skipped];
  else if (summary) what = run.alerted ? `sent, ${run.jobs ?? 0} jobs` : "not sent";
  else what = `checked ${run.checked} jobs, ${run.alerted} alerts`;
  return (
    <>
      <p>
        {nzDateTime(run.at)} ({ago(run.at, nowMs)}), {SOURCE_LABEL[run.source]}: {what}
      </p>
      {run.errors.length > 0 && (
        <p className="text-coquelicot-600">{run.errors.slice(0, 3).join("; ")}</p>
      )}
    </>
  );
}

/**
 * Travel alerts status and settings.
 * @param props - Component props.
 * @param props.initial - Server-resolved comms settings.
 * @param props.defaults - Code default comms settings.
 * @param props.location - Latest phone reading, or null when none has arrived.
 * @param props.lastRuns - Last live and morning runs.
 * @param props.alerts - Recent alerts, newest first.
 * @param props.deviceCount - Devices set up for push.
 * @param props.secretSet - Whether OWNTRACKS_SECRET is set on the server.
 * @param props.pushConfigured - Whether the VAPID keys are set on the server.
 * @param props.ownTracksUrl - The URL to enter in OwnTracks.
 * @returns View element.
 */
export function TravelAlertsView({
  initial,
  defaults,
  location,
  lastRuns,
  alerts,
  deviceCount,
  secretSet,
  pushConfigured,
  ownTracksUrl,
}: Props): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const form = useSettingsForm("comms", initial, defaults, { sparse: true });
  const { draft, setDraft, fieldErrors, baseline } = form;
  const m = COMMS_FIELD_META;
  const [running, setRunning] = useState<"live" | "morning" | null>(null);

  // Null until hydrated so server and client markup match; ticks so "ago" stays true.
  const nowMs = useNowMinute();

  // Re-fetch the server data every 30 s while the tab is visible, so a new phone report or run
  // shows without a reload. The settings draft is client state and survives the refresh.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [router]);

  /**
   * Merges a comms patch into the draft.
   * @param patch - Partial comms fields.
   * @returns void
   */
  const set = (patch: Partial<CommsSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  /**
   * Runs one check now and reports what it did.
   * @param mode - "live" for the running-late check, "morning" for the summary.
   */
  async function runNow(mode: "live" | "morning"): Promise<void> {
    setRunning(mode);
    try {
      const res = await fetch("/api/admin/travel-alerts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<LastRun> & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "The check failed.");
      if (data.skipped) {
        toast(`Nothing sent: ${SKIPPED_LABEL[data.skipped]}.`);
      } else if (data.failed) {
        toast("The push didn't reach any device.", { tone: "error" });
      } else if (mode === "morning") {
        toast(`Summary sent: ${data.jobs ?? 0} jobs today.`, { tone: "success" });
      } else {
        toast(
          `Checked ${data.checked ?? 0} jobs. ${data.alerted ? `${data.alerted} running late, push sent.` : "You're on time for all of them."}`,
          { tone: "success" },
        );
      }
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "The check failed.", { tone: "error" });
    } finally {
      setRunning(null);
    }
  }

  // Phone status
  let phoneTone: StatusTone = "critical";
  let phoneStatus = "No report yet";
  if (location && nowMs !== null) {
    // Judged by the saved settings, the same ones the checks use.
    const accurate =
      location.accuracyM == null || location.accuracyM <= baseline.phoneLocationMaxAccuracyM;
    const reading = { ...location, at: new Date(location.at) };
    const freshMs = baseline.phoneLocationFreshHours * 60 * 60_000;
    if (isUsableLocation(reading, nowMs, freshMs, baseline.phoneLocationMaxAccuracyM)) {
      phoneTone = "success";
      phoneStatus = "Reporting";
    } else {
      phoneTone = "warning";
      phoneStatus = accurate ? "Not heard from lately" : "Too rough to use";
    }
  } else if (location) {
    phoneTone = "neutral";
    phoneStatus = "Checking";
  }

  // Live check status: only stale when it should have been running.
  const live = lastRuns.live;
  let liveTone: StatusTone = "warning";
  let liveStatus = "Hasn't run yet";
  if (live && nowMs !== null) {
    const stale = nowMs - Date.parse(live.at) > LIVE_STALE_MS && inLiveWindow(nowMs);
    if (live.errors.length || live.failed || live.skipped === "calendar-unavailable") {
      liveTone = "critical";
      liveStatus = "Problem on the last run";
    } else if (stale) {
      liveTone = "warning";
      liveStatus = "Not running";
    } else if (live.skipped === "disabled") {
      liveTone = "neutral";
      liveStatus = "Off";
    } else {
      liveTone = "success";
      liveStatus = "Running";
    }
  }

  const morning = lastRuns.morning;
  let morningTone: StatusTone = "warning";
  let morningStatus = "Hasn't run yet";
  if (morning && nowMs !== null) {
    if (morning.errors.length || morning.failed || morning.skipped === "calendar-unavailable") {
      morningTone = "critical";
      morningStatus = "Problem on the last run";
    } else if (nowMs - Date.parse(morning.at) > MORNING_STALE_MS) {
      morningTone = "warning";
      morningStatus = "Missed a morning";
    } else if (morning.skipped === "disabled") {
      morningTone = "neutral";
      morningStatus = "Off";
    } else {
      morningTone = "success";
      morningStatus = "Running";
    }
  }

  let pushTone: StatusTone = "success";
  let pushStatus = `${deviceCount} ${deviceCount === 1 ? "device" : "devices"}`;
  if (!pushConfigured) {
    pushTone = "critical";
    pushStatus = "Not set up on the server";
  } else if (deviceCount === 0) {
    pushTone = "critical";
    pushStatus = "No devices";
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Is it working"
          actions={
            <div className="flex flex-wrap gap-2">
              <AdminButton
                variant="secondary"
                busy={running === "live"}
                disabled={running !== null}
                onClick={() => void runNow("live")}
              >
                Check now
              </AdminButton>
              <AdminButton
                variant="secondary"
                busy={running === "morning"}
                disabled={running !== null}
                onClick={() => void runNow("morning")}
              >
                Send today's summary
              </AdminButton>
            </div>
          }
        />
        <div className="mt-2 divide-y divide-admin-border">
          <StatusRow label="Phone location" tone={phoneTone} status={phoneStatus}>
            {location ? (
              <p>
                Last report {nowMs !== null && `${ago(location.at, nowMs)}, `}
                {nzDateTime(location.at)}
                {location.accuracyM != null && `, within ${Math.round(location.accuracyM)} m`}.{" "}
                <a
                  href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className={ADMIN_LINK_CLS}
                >
                  Show on map
                </a>
              </p>
            ) : (
              <p>
                OwnTracks hasn't sent a location. Open it and tap the publish button (the arrow, top
                right) to send one now.
              </p>
            )}
            {location && (
              <p className="text-admin-muted">
                OwnTracks on Significant only reports when you move, so a few hours with no report
                while you're at home is normal. Older than {baseline.phoneLocationFreshHours}{" "}
                {baseline.phoneLocationFreshHours === 1 ? "hour" : "hours"}, checks fall back to the
                job before or home.
              </p>
            )}
          </StatusRow>
          <StatusRow label="Live check" tone={liveTone} status={liveStatus}>
            {live ? (
              <RunDetail run={live} nowMs={nowMs ?? Date.parse(live.at)} summary={false} />
            ) : (
              <p>Runs every 10 min, 6am to 8pm, from cron-job.org and whenever your phone moves.</p>
            )}
          </StatusRow>
          <StatusRow label="Morning summary" tone={morningTone} status={morningStatus}>
            {morning ? (
              <RunDetail run={morning} nowMs={nowMs ?? Date.parse(morning.at)} summary />
            ) : (
              <p>Runs at 7am from cron-job.org.</p>
            )}
          </StatusRow>
          <StatusRow label="Push" tone={pushTone} status={pushStatus}>
            <p>
              Alerts go to every device set up on{" "}
              <Link href="/admin/notifications" className={ADMIN_LINK_CLS}>
                Notifications
              </Link>
              .
            </p>
          </StatusRow>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Settings"
          description="The same settings as Settings > Comms. When the checks run (every 10 min from 6am to 8pm, and 7am) is set on cron-job.org."
        />
        <SettingsTabBody changed={form.changedPaths}>
          <div className="mt-2 divide-y divide-admin-border">
            <ToggleField
              id="pushOnRunningLate"
              meta={m.pushOnRunningLate}
              value={draft.pushOnRunningLate}
              customised={draft.pushOnRunningLate !== defaults.pushOnRunningLate}
              onChange={(v) => set({ pushOnRunningLate: v })}
            />
            <NumberField
              id="runningLateThresholdMin"
              meta={m.runningLateThresholdMin}
              value={draft.runningLateThresholdMin}
              min={1}
              error={fieldErrors.runningLateThresholdMin}
              customised={draft.runningLateThresholdMin !== defaults.runningLateThresholdMin}
              onChange={(v) => set({ runningLateThresholdMin: v ?? 1 })}
            />
            <NumberField
              id="runningLateWindowHours"
              meta={m.runningLateWindowHours}
              value={draft.runningLateWindowHours}
              min={1}
              max={12}
              error={fieldErrors.runningLateWindowHours}
              customised={draft.runningLateWindowHours !== defaults.runningLateWindowHours}
              onChange={(v) => set({ runningLateWindowHours: v ?? 1 })}
            />
            <NumberField
              id="runningLateRepeatMin"
              meta={m.runningLateRepeatMin}
              value={draft.runningLateRepeatMin}
              min={1}
              max={120}
              error={fieldErrors.runningLateRepeatMin}
              customised={draft.runningLateRepeatMin !== defaults.runningLateRepeatMin}
              onChange={(v) => set({ runningLateRepeatMin: v ?? 1 })}
            />
            <ToggleField
              id="pushDailySummary"
              meta={m.pushDailySummary}
              value={draft.pushDailySummary}
              customised={draft.pushDailySummary !== defaults.pushDailySummary}
              onChange={(v) => set({ pushDailySummary: v })}
            />
          </div>
          <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Phone location</h3>
          <div className="mt-2 divide-y divide-admin-border">
            <ToggleField
              id="pushPhoneQuiet"
              meta={m.pushPhoneQuiet}
              value={draft.pushPhoneQuiet}
              customised={draft.pushPhoneQuiet !== defaults.pushPhoneQuiet}
              onChange={(v) => set({ pushPhoneQuiet: v })}
            />
            <NumberField
              id="phoneLocationFreshHours"
              meta={m.phoneLocationFreshHours}
              value={draft.phoneLocationFreshHours}
              min={1}
              max={24}
              error={fieldErrors.phoneLocationFreshHours}
              customised={draft.phoneLocationFreshHours !== defaults.phoneLocationFreshHours}
              onChange={(v) => set({ phoneLocationFreshHours: v ?? 1 })}
            />
            <NumberField
              id="phoneLocationMaxAccuracyM"
              meta={m.phoneLocationMaxAccuracyM}
              value={draft.phoneLocationMaxAccuracyM}
              min={50}
              max={5000}
              error={fieldErrors.phoneLocationMaxAccuracyM}
              customised={draft.phoneLocationMaxAccuracyM !== defaults.phoneLocationMaxAccuracyM}
              onChange={(v) => set({ phoneLocationMaxAccuracyM: v ?? 1000 })}
            />
            <NumberField
              id="phoneCheckGapMin"
              meta={m.phoneCheckGapMin}
              value={draft.phoneCheckGapMin}
              min={1}
              max={60}
              error={fieldErrors.phoneCheckGapMin}
              customised={draft.phoneCheckGapMin !== defaults.phoneCheckGapMin}
              onChange={(v) => set({ phoneCheckGapMin: v ?? 5 })}
            />
          </div>
          <h3 className={cn("mt-5", ADMIN_EYEBROW_CLS)}>Leave reminders</h3>
          <div className="mt-2 divide-y divide-admin-border">
            <ToggleField
              id="pushLeaveReminder"
              meta={m.pushLeaveReminder}
              value={draft.pushLeaveReminder}
              customised={draft.pushLeaveReminder !== defaults.pushLeaveReminder}
              onChange={(v) => set({ pushLeaveReminder: v })}
            />
            <NumberField
              id="leaveReminderLeadMin"
              meta={m.leaveReminderLeadMin}
              value={draft.leaveReminderLeadMin}
              min={0}
              max={60}
              error={fieldErrors.leaveReminderLeadMin}
              customised={draft.leaveReminderLeadMin !== defaults.leaveReminderLeadMin}
              onChange={(v) => set({ leaveReminderLeadMin: v ?? 10 })}
            />
            <NumberField
              id="atHomeRadiusM"
              meta={m.atHomeRadiusM}
              value={draft.atHomeRadiusM}
              min={50}
              max={2000}
              error={fieldErrors.atHomeRadiusM}
              customised={draft.atHomeRadiusM !== defaults.atHomeRadiusM}
              onChange={(v) => set({ atHomeRadiusM: v ?? 300 })}
            />
          </div>
          <SettingsFooter form={form} />
        </SettingsTabBody>
      </Card>

      <Card>
        <CardHeader title="Recent alerts" description="The last 10 pushes, newest first." />
        {alerts.length === 0 ? (
          <p className="mt-2 text-base text-admin-muted">Nothing sent yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-admin-border">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="font-semibold text-admin-text">{a.label}</span>
                <span className="text-base text-admin-text">
                  {a.kind === "leave"
                    ? `${nzDateTime(a.jobStartAt)}, leave reminder`
                    : a.kind === "summary" || a.kind === "phone-quiet"
                      ? `for ${nzDateTime(a.jobStartAt).replace(/,.*$/, "")}`
                      : `${nzDateTime(a.jobStartAt)}, ~${a.lateMin} min late`}
                </span>
                <span className="text-sm text-admin-muted">sent {nzDateTime(a.sentAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="OwnTracks set-up" description="For a new phone, or to check the app." />
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-base sm:grid-cols-[10rem_1fr]">
          <dt className={ADMIN_META_LABEL_CLS}>Mode</dt>
          <dd>HTTP</dd>
          <dt className={ADMIN_META_LABEL_CLS}>URL</dt>
          <dd className="break-all select-all">{ownTracksUrl}</dd>
          <dt className={ADMIN_META_LABEL_CLS}>Password</dt>
          <dd>
            {secretSet ? (
              "OWNTRACKS_SECRET from the server's environment"
            ) : (
              <StatusPill tone="critical">OWNTRACKS_SECRET isn't set</StatusPill>
            )}
          </dd>
          <dt className={ADMIN_META_LABEL_CLS}>Monitoring</dt>
          <dd>Significant</dd>
          <dt className={ADMIN_META_LABEL_CLS}>Location access</dt>
          <dd>Always, with Precise on</dd>
        </dl>
      </Card>
    </div>
  );
}
