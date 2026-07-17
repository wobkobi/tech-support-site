"use client";
// src/features/business/components/calculator/CancelFeeSection.tsx

import type { CancelMeetingType, CancellationReason } from "@/features/business/lib/pricing-policy";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Props for the {@link CancelFeeSection} component.
 */
interface CancelFeeSectionProps {
  /** Which fee is being billed. */
  reason: CancellationReason;
  /** Called when the operator switches the fee type. */
  onReasonChange: (reason: CancellationReason) => void;
  /** Whether the booking was on site or remote; remote never bills a drive. */
  meetingType: CancelMeetingType;
  /** Called when the operator switches the meeting type. */
  onMeetingTypeChange: (meetingType: CancelMeetingType) => void;
  /** The booking's date as NZ-local YYYY-MM-DD; drives the fee wording. */
  bookingDate: string;
  /** Called when the operator corrects the booking's date. */
  onBookingDateChange: (date: string) => void;
  /** The booking's start time (HH:MM); one end of the notice measurement. */
  bookingTime: string;
  /** Called when the operator corrects the booking's start time. */
  onBookingTimeChange: (time: string) => void;
  /** Date the client called it off (YYYY-MM-DD). */
  cancelledAtDate: string;
  /** Called when the operator corrects the cancel date. */
  onCancelledAtDateChange: (date: string) => void;
  /** Time the client called it off (HH:MM). */
  cancelledAtTime: string;
  /** Called when the operator corrects the cancel time. */
  onCancelledAtTimeChange: (time: string) => void;
  /** Fee in NZD as decided by the policy; shown, not edited. */
  fee: number;
  /** True when the round trip is being billed on top of the fee. */
  includeTravel: boolean;
  /** True when a travel figure exists (live or parked) to bill. */
  hasTravel: boolean;
  /** Hours of notice given; negative once the booking had already started. */
  noticeHours: number;
  /** True when the policy says a fee applies. */
  feeApplies: boolean;
  /** True when the policy says the round trip applies. */
  travelApplies: boolean;
  /** True when the full call-out was earned rather than the flat late fee. */
  isFullCallOut: boolean;
  /** Live free-notice window in hours for this meeting type, for the explanation copy. */
  freeNoticeHours: number;
  /** Live full-call-out window in hours, for the explanation copy. In-person only. */
  travelChargeHours: number;
  /** Called when the operator leaves cancel mode. */
  onExit: () => void;
}

const REASONS: { value: CancellationReason; label: string }[] = [
  { value: "late-cancellation", label: "Late cancellation" },
  { value: "no-show", label: "No-show" },
];

const MEETING_TYPES: { value: CancelMeetingType; label: string }[] = [
  { value: "in-person", label: "In person" },
  { value: "remote", label: "Remote" },
];

const CHIP_BASE = "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";

/**
 * Renders a policy window in hours. The windows are settings, so a value of 1
 * is reachable and "1 hours" would read as a bug.
 * @param n - Number of hours.
 * @returns e.g. "1 hour", "12 hours".
 */
function formatHours(n: number): string {
  return `${n} hour${n === 1 ? "" : "s"}`;
}

/**
 * Renders a notice gap as plain words ("1 hr 20 min", "45 min").
 * @param hours - Notice in hours; may be fractional or negative.
 * @returns Human-readable duration.
 */
function formatNotice(hours: number): string {
  const mins = Math.round(Math.abs(hours) * 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Dedicated form for billing an early cancel or no-show. Replaces the job-shaped
 * calculator body - a cancelled job has no work to bill, only a call-out fee and
 * optionally the round trip that was already driven. The charge is derived from
 * the cancellation policy using the booking's start and the moment the client
 * called it off, and the verdict is spelled out so the invoice can be justified
 * to the client without re-deriving the windows by hand.
 * @param props - Component props.
 * @param props.reason - Which fee is being billed.
 * @param props.onReasonChange - Called when the operator switches the fee type.
 * @param props.meetingType - Whether the booking was on site or remote.
 * @param props.onMeetingTypeChange - Called when the operator switches the meeting type.
 * @param props.bookingDate - The booking's date (YYYY-MM-DD).
 * @param props.onBookingDateChange - Called when the operator corrects the date.
 * @param props.bookingTime - The booking's start time (HH:MM).
 * @param props.onBookingTimeChange - Called when the operator corrects the start time.
 * @param props.cancelledAtDate - Date the client called it off (YYYY-MM-DD).
 * @param props.onCancelledAtDateChange - Called when the operator corrects the cancel date.
 * @param props.cancelledAtTime - Time the client called it off (HH:MM).
 * @param props.onCancelledAtTimeChange - Called when the operator corrects the cancel time.
 * @param props.fee - Fee in NZD as decided by the policy.
 * @param props.includeTravel - Whether the round trip is billed on top.
 * @param props.hasTravel - Whether a travel figure exists to bill.
 * @param props.noticeHours - Hours of notice given.
 * @param props.feeApplies - Whether the policy says a fee applies.
 * @param props.isFullCallOut - Whether the full call-out was earned.
 * @param props.freeNoticeHours - Live free-notice window in hours.
 * @param props.travelChargeHours - Live travel-charge window in hours.
 * @param props.onExit - Called when the operator leaves cancel mode.
 * @returns Cancel fee form element.
 */
export function CancelFeeSection({
  reason,
  onReasonChange,
  meetingType,
  onMeetingTypeChange,
  bookingDate,
  onBookingDateChange,
  bookingTime,
  onBookingTimeChange,
  cancelledAtDate,
  onCancelledAtDateChange,
  cancelledAtTime,
  onCancelledAtTimeChange,
  fee,
  includeTravel,
  hasTravel,
  noticeHours,
  feeApplies,
  isFullCallOut,
  freeNoticeHours,
  travelChargeHours,
  onExit,
}: CancelFeeSectionProps): React.ReactElement {
  const noShow = reason === "no-show";
  const remote = meetingType === "remote";
  const inputClass =
    "rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-700 focus:border-russian-violet focus:outline-none";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-coquelicot-500/30 bg-coquelicot-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-russian-violet">Early cancel</h2>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto rounded-lg px-2.5 py-1 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          Back to job calculator
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Bills the call-out fee instead of job work. Nothing was done on site, so the task list and
        parts are cleared.
      </p>

      {/* Reason + meeting type */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-medium text-slate-600">Reason</p>
          <div className="flex flex-wrap gap-1">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => onReasonChange(r.value)}
                className={cn(
                  CHIP_BASE,
                  reason === r.value
                    ? "bg-russian-violet text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-600">Was it</p>
          <div className="flex flex-wrap gap-1">
            {MEETING_TYPES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onMeetingTypeChange(m.value)}
                className={cn(
                  CHIP_BASE,
                  meetingType === m.value
                    ? "bg-russian-violet text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Booking start */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-600">Booking date</span>
          <input
            type="date"
            value={bookingDate}
            onChange={(e) => onBookingDateChange(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-600">Booking start time</span>
          <input
            type="time"
            value={bookingTime}
            onChange={(e) => onBookingTimeChange(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {/* When they called it off. A no-show never called, so there is no notice
          to measure and these inputs would only mislead. */}
      {!noShow && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-600">They cancelled on</span>
            <input
              type="date"
              value={cancelledAtDate}
              onChange={(e) => onCancelledAtDateChange(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-600">At</span>
            <input
              type="time"
              value={cancelledAtTime}
              onChange={(e) => onCancelledAtTimeChange(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      )}

      {/* Policy verdict: what was charged and why. */}
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          feeApplies
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900",
        )}
      >
        {noShow ? (
          <p>
            <span className="font-semibold">No-show.</span> They never called it off, so a fee
            applies.{" "}
            {remote
              ? "Remote session, so it is the flat remote fee - there was no trip to bill."
              : "You drove out, so it is the full call-out plus the round trip."}
          </p>
        ) : !feeApplies ? (
          <p>
            <span className="font-semibold">No fee applies.</span> {formatNotice(noticeHours)} of
            notice is outside the {formatHours(freeNoticeHours)} {remote ? "remote " : ""}window, so
            this cancel is free. You do not need to invoice it.
          </p>
        ) : (
          <p>
            <span className="font-semibold">
              {noticeHours < 0
                ? `Called off ${formatNotice(noticeHours)} after the booking started.`
                : `${formatNotice(noticeHours)} of notice.`}
            </span>{" "}
            {remote ? (
              <>
                Inside the {formatHours(freeNoticeHours)} remote window, so the flat remote fee
                applies. There is no trip to bill however late it was dropped.
              </>
            ) : isFullCallOut ? (
              <>
                Inside the {formatHours(travelChargeHours)} window, so the full call-out applies
                instead of the flat fee, and the round trip is billed on top.
              </>
            ) : (
              <>
                Inside the {formatHours(freeNoticeHours)} window, so the cancellation fee applies.
                Outside the {formatHours(travelChargeHours)} window, so no full call-out and no
                travel.
              </>
            )}
          </p>
        )}
      </div>

      {/* Fee is the policy's, not the operator's. Editing it here would quietly
          bill something the published policy does not say, so it is shown rather
          than typed - the fee follows the times and the settings. To let one go,
          don't send the invoice; to bend one, edit the saved draft. */}
      <p className="text-sm text-slate-600">
        <span className="font-medium">Fee:</span>{" "}
        {fee > 0 ? `$${fee} (from your cancellation policy)` : "none"}
      </p>

      {!remote && (
        <p className="text-sm text-slate-600">
          <span className="font-medium">Round trip:</span>{" "}
          {!hasTravel
            ? "no travel figure on this job - look one up below if you drove."
            : includeTravel
              ? "billed, and shown in the travel section below."
              : "not billed. It is parked, so it comes back if the times change."}
        </p>
      )}
    </div>
  );
}
