"use client";
// src/features/business/hooks/use-cancel-mode.ts
// Cancel mode for the job calculator: a cancelled job has no work to bill, so the
// policy's verdict (fee line, note, round-trip decision) is written straight into the
// calculator's tasks, notes and travel whenever a cancel input changes.

import {
  assessCancellation,
  cancellationFeeLabel,
  cancellationNotes,
  type CancellationPolicy,
  type CancellationReason,
  type CancelMeetingType,
} from "@/features/business/lib/pricing-policy";
import type {
  EventPrefill,
  ParsedRange,
  PartLine,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** Calculator state the cancel flow reads and writes. */
interface UseCancelModeArgs {
  /** Live cancellation policy (notice windows + call-out fee). */
  cancellation: CancellationPolicy;
  /** Schedule-event prefill, or null on a normal load. */
  eventPrefill: EventPrefill | null;
  /** The job date, which doubles as the cancelled booking's date. */
  jobDate: string;
  setJobDate: React.Dispatch<React.SetStateAction<string>>;
  timeRanges: ParsedRange[];
  jobAddress: string;
  travelEntries: TravelEntry[];
  setTravelEntries: React.Dispatch<React.SetStateAction<TravelEntry[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskLine[]>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  setParts: React.Dispatch<React.SetStateAction<PartLine[]>>;
}

/** Cancel-mode state, the policy verdict, and the form's handlers. */
interface UseCancelMode {
  cancelMode: boolean;
  cancelReason: CancellationReason;
  /** Whether the round trip is currently billed. */
  includeCancelTravel: boolean;
  cancelBookingTime: string;
  cancelledAtDate: string;
  cancelledAtTime: string;
  cancelMeetingType: CancelMeetingType;
  /** Travel entries parked while the policy says no round trip. */
  stashedTravel: TravelEntry[];
  /** Scroll target for the cancel form. */
  cancelSectionRef: React.RefObject<HTMLDivElement | null>;
  /** Hours of notice between the call-off and the booking start. */
  cancelNoticeHours: number;
  /** Policy verdict for the current inputs. */
  cancelCharge: ReturnType<typeof assessCancellation>;
  enterCancelMode: () => void;
  exitCancelMode: () => void;
  /** Puts cancel mode and its inputs back to their mount defaults. */
  resetCancelMode: () => void;
  handleCancelReasonChange: (reason: CancellationReason) => void;
  handleCancelMeetingTypeChange: (meetingType: CancelMeetingType) => void;
  handleCancelledDateChange: (date: string) => void;
  handleCancelBookingTimeChange: (time: string) => void;
  handleCancelledAtDateChange: (date: string) => void;
  handleCancelledAtTimeChange: (time: string) => void;
}

/**
 * Owns cancel mode's inputs and applies the cancellation policy to the
 * calculator's shared state. Client picker, travel, invoice preview, and save
 * are reused as-is; only tasks, notes, parts and travel are rewritten.
 * @param args - Calculator state the cancel flow reads and writes.
 * @param args.cancellation - Live cancellation policy.
 * @param args.eventPrefill - Schedule-event prefill, or null.
 * @param args.jobDate - The job date (the cancelled booking's date).
 * @param args.setJobDate - Job date setter.
 * @param args.timeRanges - Current time slots, seeding the booking start.
 * @param args.jobAddress - Job address, used to infer on-site vs remote.
 * @param args.travelEntries - Current travel entries.
 * @param args.setTravelEntries - Travel entries setter.
 * @param args.setTasks - Task lines setter.
 * @param args.setNotes - Notes setter.
 * @param args.setParts - Parts setter.
 * @returns Cancel-mode state, the policy verdict, and the form's handlers.
 */
export function useCancelMode({
  cancellation,
  eventPrefill,
  jobDate,
  setJobDate,
  timeRanges,
  jobAddress,
  travelEntries,
  setTravelEntries,
  setTasks,
  setNotes,
  setParts,
}: UseCancelModeArgs): UseCancelMode {
  // Cancel mode: a cancelled job has no work to bill, so the job-shaped sections
  // are swapped for CancelFeeSection and the fee is written into tasks as one
  // flat line. Client picker, travel, invoice preview, and save are reused as-is.
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason>("late-cancellation");
  const [includeCancelTravel, setIncludeCancelTravel] = useState(true);
  // The booking's start and the moment the client called it off. The policy
  // windows are measured between these two, so both are operator-entered rather
  // than read off the clock - this is usually written up after the fact.
  const [cancelBookingTime, setCancelBookingTime] = useState("09:00");
  const [cancelledAtDate, setCancelledAtDate] = useState("");
  const [cancelledAtTime, setCancelledAtTime] = useState("09:00");
  // On site or remote. The fee covers the held slot either way, but only an
  // in-person booking has a drive, so the travel window never applies remotely.
  const [cancelMeetingType, setCancelMeetingType] = useState<CancelMeetingType>("in-person");
  const cancelSectionRef = useRef<HTMLDivElement>(null);
  // Travel entries parked while the policy says no round trip, so flipping the
  // decision back restores the figure instead of forcing a fresh lookup.
  const [stashedTravel, setStashedTravel] = useState<TravelEntry[]>([]);

  // Cancel-mode verdict for the form's explanation, measured from the booking's start back
  // to when the client called it off. Pure: new Date(string) is deterministic, unlike the
  // argless new Date() / Date.now() the React Compiler purity rule rejects in render.
  const cancelBookingStart = new Date(`${jobDate}T${cancelBookingTime || "00:00"}`);
  const cancelledAtStamp = new Date(`${cancelledAtDate || jobDate}T${cancelledAtTime || "00:00"}`);
  const cancelNoticeHours =
    (cancelBookingStart.getTime() - cancelledAtStamp.getTime()) / (60 * 60 * 1000);
  // Same helper the charge itself goes through, so the explanation can never
  // disagree with what lands on the invoice.
  const cancelCharge = assessCancellation(cancelBookingStart, cancelledAtStamp, {
    reason: cancelReason,
    meetingType: cancelMeetingType,
    policy: cancellation,
  });

  /**
   * The cancellation fee as a single flat task. baseRateId stays null so
   * business.ts treats it as flat: bills qty * unitPrice, contributes no
   * labour minutes, and collapseToWindow ignores it. No RateConfig needed -
   * rateConfigId only links flat rate rows like Travel.
   * @param reason - Which fee is being billed.
   * @param date - The cancelled booking's date (YYYY-MM-DD).
   * @param fee - Fee amount in NZD.
   * @returns The single flat task representing the fee.
   */
  function buildCancelFeeTask(reason: CancellationReason, date: string, fee: number): TaskLine {
    return {
      rateConfigId: null,
      baseRateId: null,
      description: cancellationFeeLabel(reason, date),
      qty: 1,
      unitPrice: fee,
      lineTotal: fee,
    };
  }

  /**
   * Bills the round trip or parks it. Parking stashes the entries rather than
   * dropping them, so reversing the decision restores the figure instead of
   * forcing a fresh address lookup.
   * @param include - Whether to bill travel.
   */
  function applyCancelTravel(include: boolean): void {
    setIncludeCancelTravel(include);
    if (include) {
      setTravelEntries((prev) => (prev.length === 0 ? stashedTravel : prev));
    } else {
      setTravelEntries((prev) => {
        if (prev.length > 0) setStashedTravel(prev);
        return [];
      });
    }
  }

  /**
   * Applies the cancellation policy to the entered times and rewrites the fee
   * line, note, and travel decision. Every cancel input funnels through here
   * so the invoice always reflects the policy: more than freeNoticeHours'
   * notice zeroes the fee, a no-show always bills (no notice to measure), and
   * travel only ever applies to an in-person booking.
   * @param next - The changed inputs; anything omitted keeps its current value.
   * @param next.reason - Late cancellation or no-show.
   * @param next.meetingType - On site or remote.
   * @param next.bookingDate - The booking's date (YYYY-MM-DD).
   * @param next.bookingTime - The booking's start time (HH:MM).
   * @param next.cancelledDate - Date the client called it off (YYYY-MM-DD).
   * @param next.cancelledTime - Time the client called it off (HH:MM).
   */
  function applyCancelPolicy(next: {
    reason?: CancellationReason;
    meetingType?: CancelMeetingType;
    bookingDate?: string;
    bookingTime?: string;
    cancelledDate?: string;
    cancelledTime?: string;
  }): void {
    const reason = next.reason ?? cancelReason;
    const meetingType = next.meetingType ?? cancelMeetingType;
    const bookingDate = next.bookingDate ?? jobDate;
    const bookingTime = next.bookingTime ?? cancelBookingTime;
    const offDate = (next.cancelledDate ?? cancelledAtDate) || bookingDate;
    const offTime = next.cancelledTime ?? cancelledAtTime;

    const charge = assessCancellation(
      new Date(`${bookingDate}T${bookingTime}`),
      new Date(`${offDate}T${offTime}`),
      { reason, meetingType, policy: cancellation },
    );

    setTasks([buildCancelFeeTask(reason, bookingDate, charge.fee)]);
    setNotes(cancellationNotes(reason, bookingDate));
    applyCancelTravel(charge.travelApplies);
  }

  /**
   * Enters cancel mode, replacing job work with the policy's verdict. Tasks
   * and parts clear (nothing was done on site); the cancel moment seeds at the
   * booking start so the worst case shows until the real time is entered.
   */
  function enterCancelMode(): void {
    const bookingTime = eventPrefill?.slots[0]?.startTime ?? timeRanges[0]?.startTime ?? "09:00";
    // Prefer the booking's own answer. Without one (an event created straight on
    // the calendar), infer from whether there is anywhere to drive to.
    const meetingType: CancelMeetingType =
      eventPrefill?.meetingType ??
      (jobAddress.trim() || travelEntries.length > 0 ? "in-person" : "remote");
    setCancelMode(true);
    setCancelReason("late-cancellation");
    setCancelMeetingType(meetingType);
    setCancelBookingTime(bookingTime);
    setCancelledAtDate(jobDate);
    setCancelledAtTime(bookingTime);
    setParts([]);
    applyCancelPolicy({
      reason: "late-cancellation",
      meetingType,
      bookingTime,
      cancelledDate: jobDate,
      cancelledTime: bookingTime,
    });
  }

  /**
   * Leaves cancel mode and clears the fee line so a half-finished cancel cannot
   * leak into a job invoice.
   */
  function exitCancelMode(): void {
    setCancelMode(false);
    setTasks([]);
    setNotes("");
  }

  /** Puts cancel mode and its policy inputs back to their mount defaults. */
  function resetCancelMode(): void {
    setCancelMode(false);
    setCancelReason("late-cancellation");
    setCancelMeetingType("in-person");
    setCancelBookingTime("09:00");
    setCancelledAtDate("");
    setCancelledAtTime("09:00");
    setIncludeCancelTravel(true);
    setStashedTravel([]);
  }

  // The button that opens cancel mode sits at the bottom of the column while the form
  // renders at the top, so without this the click looks like it did nothing. Runs after
  // the form exists; exiting is left alone, as that button is already under the cursor.
  useEffect(() => {
    if (!cancelMode) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cancelSectionRef.current?.scrollIntoView({
      block: "start",
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [cancelMode]);

  /**
   * Switches the fee type and re-applies the policy.
   * @param reason - The newly-picked fee type.
   */
  function handleCancelReasonChange(reason: CancellationReason): void {
    setCancelReason(reason);
    applyCancelPolicy({ reason });
  }

  /**
   * Switches between an on-site and a remote booking and re-applies the policy.
   * Flipping to remote parks the round trip; flipping back restores it when the
   * timing still warrants one.
   * @param meetingType - The newly-picked meeting type.
   */
  function handleCancelMeetingTypeChange(meetingType: CancelMeetingType): void {
    setCancelMeetingType(meetingType);
    applyCancelPolicy({ meetingType });
  }

  /**
   * Corrects the booking's date and re-applies the policy.
   * @param date - The new date (YYYY-MM-DD).
   */
  function handleCancelledDateChange(date: string): void {
    setJobDate(date);
    applyCancelPolicy({ bookingDate: date });
  }

  /**
   * Corrects the booking's start time and re-applies the policy.
   * @param time - The new start time (HH:MM).
   */
  function handleCancelBookingTimeChange(time: string): void {
    setCancelBookingTime(time);
    applyCancelPolicy({ bookingTime: time });
  }

  /**
   * Corrects the date the client called it off and re-applies the policy.
   * @param date - The new date (YYYY-MM-DD).
   */
  function handleCancelledAtDateChange(date: string): void {
    setCancelledAtDate(date);
    applyCancelPolicy({ cancelledDate: date });
  }

  /**
   * Corrects the time the client called it off and re-applies the policy.
   * @param time - The new time (HH:MM).
   */
  function handleCancelledAtTimeChange(time: string): void {
    setCancelledAtTime(time);
    applyCancelPolicy({ cancelledTime: time });
  }

  return {
    cancelMode,
    cancelReason,
    includeCancelTravel,
    cancelBookingTime,
    cancelledAtDate,
    cancelledAtTime,
    cancelMeetingType,
    stashedTravel,
    cancelSectionRef,
    cancelNoticeHours,
    cancelCharge,
    enterCancelMode,
    exitCancelMode,
    resetCancelMode,
    handleCancelReasonChange,
    handleCancelMeetingTypeChange,
    handleCancelledDateChange,
    handleCancelBookingTimeChange,
    handleCancelledAtDateChange,
    handleCancelledAtTimeChange,
  };
}
