"use client";
// src/features/business/hooks/use-cancel-mode.ts
// Cancel mode for the job calculator: the policy's verdict (fee line, note, round trip) is
// written into the calculator's tasks, notes and travel whenever a cancel input changes.

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
 * Owns cancel mode's inputs and applies the cancellation policy to the calculator's tasks,
 * notes, parts and travel.
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
  // Cancel mode swaps the job sections for CancelFeeSection and bills the fee as one flat line.
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason>("late-cancellation");
  const [includeCancelTravel, setIncludeCancelTravel] = useState(true);
  // Booking start and call-off moment, operator-entered since this is usually written up later.
  const [cancelBookingTime, setCancelBookingTime] = useState("09:00");
  const [cancelledAtDate, setCancelledAtDate] = useState("");
  const [cancelledAtTime, setCancelledAtTime] = useState("09:00");
  // On site or remote; only an in-person booking has travel.
  const [cancelMeetingType, setCancelMeetingType] = useState<CancelMeetingType>("in-person");
  const cancelSectionRef = useRef<HTMLDivElement>(null);
  // Travel parked while the policy says no round trip, so flipping back restores it.
  const [stashedTravel, setStashedTravel] = useState<TravelEntry[]>([]);

  // Notice between call-off and booking start. new Date(string) is pure, unlike the argless
  // new Date() the React Compiler purity rule rejects in render.
  const cancelBookingStart = new Date(`${jobDate}T${cancelBookingTime || "00:00"}`);
  const cancelledAtStamp = new Date(`${cancelledAtDate || jobDate}T${cancelledAtTime || "00:00"}`);
  const cancelNoticeHours =
    (cancelBookingStart.getTime() - cancelledAtStamp.getTime()) / (60 * 60 * 1000);
  // Same helper as the charge, so the explanation matches the invoice.
  const cancelCharge = assessCancellation(cancelBookingStart, cancelledAtStamp, {
    reason: cancelReason,
    meetingType: cancelMeetingType,
    policy: cancellation,
  });

  /**
   * The cancellation fee as a single flat task. isFlatFee keeps it out of labour: it bills
   * qty * unitPrice and is never padded to the billable minimum.
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
      isFlatFee: true,
    };
  }

  /**
   * Bills the round trip or parks it, so reversing the decision restores the figure.
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
   * Applies the cancellation policy and rewrites the fee line, note and travel. More than
   * freeNoticeHours' notice zeroes the fee; a no-show always bills.
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
   * Enters cancel mode: tasks and parts clear, and the cancel moment seeds at the booking
   * start so the worst case shows first.
   */
  function enterCancelMode(): void {
    const bookingTime = eventPrefill?.slots[0]?.startTime ?? timeRanges[0]?.startTime ?? "09:00";
    // Prefer the booking's own answer, else infer from whether there is an address.
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
   * Leaves cancel mode and clears the fee line so it can't leak into a job invoice.
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

  // The cancel button sits below the form, so scroll to the form on entry or the click
  // looks like it did nothing.
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
   * Switches between on-site and remote and re-applies the policy (remote parks the round trip).
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
