"use client";

import type React from "react";
import { FaCaretRight } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import {
  formatNZD,
  minsToHoursLabel,
  billableMins,
  sessionDurationMins,
  timeDiffMins,
} from "@/features/business/lib/business";
import type { JobSession, RateConfig } from "@/features/business/types/business";

interface Props {
  sessions: JobSession[];
  onSessionsChange: (next: JobSession[]) => void;
  /** Live aggregate duration in minutes (sum of session durations, respecting per-session overrides). */
  durationMins: number;
  hourlyRateId: string | null;
  onHourlyRateIdChange: (id: string | null) => void;
  baseRates: RateConfig[];
  /** True when the operator has run a travel lookup; gates the per-session travel checkboxes. */
  hasTravelInfo: boolean;
}

/**
 * Time + hourly-rate card. For single-session jobs the UI is the existing
 * Start/End/Override/Rate grid - identical to the pre-multi-session layout.
 * For multi-session jobs (after "+ Add session") each session gets its own
 * sub-card with editable label, optional date, time range, override, delete,
 * and (when a travel lookup is loaded) an "include travel" checkbox that
 * decides whether this session bills its own travel line.
 * @param props - Component props.
 * @param props.sessions - Current sessions array (always has at least one).
 * @param props.onSessionsChange - Replaces the sessions array on any edit.
 * @param props.durationMins - Live aggregate duration across all sessions.
 * @param props.hourlyRateId - Currently selected base hourly rate id.
 * @param props.onHourlyRateIdChange - Picks a different base hourly rate.
 * @param props.baseRates - Available base hourly rates for the select.
 * @param props.hasTravelInfo - True when a travel lookup is loaded; gates the per-session travel checkboxes.
 * @returns Time/rate card element.
 */
export function JobDetailsSection({
  sessions,
  onSessionsChange,
  durationMins,
  hourlyRateId,
  onHourlyRateIdChange,
  baseRates,
  hasTravelInfo,
}: Props): React.ReactElement {
  const multi = sessions.length > 1;

  /**
   * Updates one field on the session at `index` and forwards the new array.
   * Empty date strings collapse to null so undated sessions stay clean.
   * @param index - Session index to update.
   * @param patch - Partial session fields to merge.
   */
  function patchSession(index: number, patch: Partial<JobSession>): void {
    const next = sessions.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onSessionsChange(next);
  }

  /** Appends a new session below the existing ones, defaulting includeTravel to true. */
  function addSession(): void {
    onSessionsChange([
      ...sessions,
      {
        label: `Session ${sessions.length + 1}`,
        date: null,
        startTime: "",
        endTime: "",
        durationMins: null,
        includeTravel: true,
      },
    ]);
  }

  /**
   * Removes the session at `index`. Disabled when only one session remains;
   * labels do NOT auto-renumber so operator-edited labels survive the delete.
   * @param index - Session index to drop.
   */
  function removeSession(index: number): void {
    if (sessions.length <= 1) return;
    onSessionsChange(sessions.filter((_, i) => i !== index));
  }

  return (
    <div className={cn("space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet text-sm font-semibold")}>Time</h2>

      {sessions.map((session, index) => (
        <SessionRow
          key={index}
          session={session}
          multi={multi}
          hasTravelInfo={hasTravelInfo}
          onPatch={(patch) => patchSession(index, patch)}
          onRemove={() => removeSession(index)}
        />
      ))}

      <div className={cn("flex items-center justify-between gap-3 border-t border-slate-100 pt-3")}>
        <button
          type="button"
          onClick={addSession}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
          )}
        >
          + Add session
        </button>
        {multi && (
          <p className={cn("text-xs text-slate-500")}>
            Total: {minsToHoursLabel(durationMins)}
            {billableMins(durationMins) !== durationMins && (
              <span className={cn("ml-1 inline-flex items-center gap-1 text-slate-400")}>
                <FaCaretRight className={cn("h-3 w-3")} aria-hidden />
                {minsToHoursLabel(billableMins(durationMins))} billed
              </span>
            )}
          </p>
        )}
      </div>

      <div>
        <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Hourly rate</label>
        <select
          value={hourlyRateId ?? ""}
          onChange={(e) => onHourlyRateIdChange(e.target.value || null)}
          className={cn(
            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
          )}
        >
          <option value="">None</option>
          {baseRates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface SessionRowProps {
  session: JobSession;
  multi: boolean;
  hasTravelInfo: boolean;
  onPatch: (patch: Partial<JobSession>) => void;
  onRemove: () => void;
}

/**
 * One session inside the Time card. Single-session jobs render just the
 * start/end/override grid (visually identical to the legacy layout). Multi-
 * session jobs add a label row, a date input, a delete button, and a travel
 * checkbox - all gated on multi / hasTravelInfo so the UI stays minimal when
 * the operator hasn't opted into multi-session billing.
 * @param props - Component props.
 * @param props.session - The session to render.
 * @param props.multi - True when this row is part of a multi-session job.
 * @param props.hasTravelInfo - True when a travel lookup is loaded; gates the travel checkbox.
 * @param props.onPatch - Merges a partial update into this session.
 * @param props.onRemove - Removes this session from the list.
 * @returns Session row element.
 */
function SessionRow({
  session,
  multi,
  hasTravelInfo,
  onPatch,
  onRemove,
}: SessionRowProps): React.ReactElement {
  const dur = sessionDurationMins(session);
  const liveDiff = timeDiffMins(session.startTime, session.endTime);

  return (
    <div
      className={cn("space-y-3", multi && "rounded-lg border border-slate-100 bg-slate-50/50 p-3")}
    >
      {multi && (
        <div className={cn("flex items-center gap-2")}>
          <input
            type="text"
            value={session.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className={cn(
              "focus:ring-russian-violet/30 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2",
            )}
          />
          <input
            type="date"
            value={session.date ?? ""}
            onChange={(e) => onPatch({ date: e.target.value || null })}
            className={cn(
              "focus:ring-russian-violet/30 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2",
            )}
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${session.label}`}
            className={cn(
              "rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50",
            )}
          >
            ×
          </button>
        </div>
      )}

      <div className={cn("grid grid-cols-2 gap-3")}>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Start</label>
          <input
            type="time"
            value={session.startTime}
            onChange={(e) => onPatch({ startTime: e.target.value, durationMins: null })}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>End</label>
          <input
            type="time"
            value={session.endTime}
            onChange={(e) => onPatch({ endTime: e.target.value, durationMins: null })}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>
      </div>

      <div className={cn("grid grid-cols-2 gap-3")}>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>
            Duration (override)
          </label>
          <input
            type="number"
            min="0"
            step="5"
            value={session.durationMins ?? dur}
            onChange={(e) => onPatch({ durationMins: parseInt(e.target.value) || 0 })}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
          <p className={cn("mt-1 text-xs text-slate-400")}>
            {minsToHoursLabel(dur)}
            {billableMins(dur) !== dur && (
              <span className={cn("ml-1 inline-flex items-center gap-1 text-slate-300")}>
                <FaCaretRight className={cn("h-3 w-3")} aria-hidden />
                {minsToHoursLabel(billableMins(dur))} billed
              </span>
            )}
            {session.durationMins != null && session.durationMins !== liveDiff && liveDiff > 0 && (
              <span className={cn("ml-1 italic text-slate-300")}>
                (wall-clock {minsToHoursLabel(liveDiff)})
              </span>
            )}
          </p>
        </div>
        {hasTravelInfo && (
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Travel</label>
            <label
              className={cn(
                "flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm",
              )}
            >
              <input
                type="checkbox"
                checked={session.includeTravel}
                onChange={(e) => onPatch({ includeTravel: e.target.checked })}
                className={cn("h-4 w-4")}
                aria-label={multi ? `Bill travel for ${session.label}` : "Bill travel"}
              />
              <span className={cn("text-xs text-slate-600")}>
                {multi ? "Bill travel for this session" : "Bill travel"}
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
