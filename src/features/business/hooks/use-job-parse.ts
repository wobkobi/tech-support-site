"use client";
// src/features/business/hooks/use-job-parse.ts
// The calculator's AI parse session: the "Describe the job" text, the parse-job call
// with its clarifying-question round, and hydration of a parse result into the
// calculator's time, travel, tasks, parts, notes and the paid-in-cash tick.

import { useToast } from "@/features/admin/components/ui/Toast";
import type { AlreadyPaidState } from "@/features/business/lib/already-paid-input";
import { timeDiffMins, type JobPricing } from "@/features/business/lib/business";
import {
  buildParseInput,
  describeFit,
  fitTasksToWindow,
  hydrateParsedTasks,
  parsedAutoTravel,
  parsedCostEntries,
  parsedStoreRunEntries,
  parsedWindow,
  type WindowSlot,
} from "@/features/business/lib/parse-hydrate";
import { extractRanges } from "@/features/business/lib/time-parse";
import type {
  EventPrefill,
  ParsedRange,
  ParseJobQuestion,
  ParseJobResponse,
  PartLine,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { nzNowTime } from "@/shared/lib/timezone-utils";
import type React from "react";
import { useRef, useState } from "react";

/** Calculator state the parse session reads and writes. */
interface UseJobParseArgs {
  /** Live pricing: travel rate/minimum, task timing and the billable floor. */
  pricing: JobPricing & { travelRatePerHour: number };
  /** Schedule-event prefill, or null on a normal load. */
  eventPrefill: EventPrefill | null;
  /** Job date, so travel is quoted at the job's weekday traffic. */
  jobDate: string;
  /** Current job address, sent as the travel fallback destination. */
  jobAddress: string;
  /** The Time card's ranges. */
  timeRanges: ParsedRange[];
  /** Whether those ranges are real times rather than a placeholder or the booking's own. */
  timesSet: boolean;
  setFollowUpMins: React.Dispatch<React.SetStateAction<number>>;
  setTimeRanges: React.Dispatch<React.SetStateAction<ParsedRange[]>>;
  setTimesSet: React.Dispatch<React.SetStateAction<boolean>>;
  setJobAddress: React.Dispatch<React.SetStateAction<string>>;
  setTravelEntries: React.Dispatch<React.SetStateAction<TravelEntry[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskLine[]>>;
  setParts: React.Dispatch<React.SetStateAction<PartLine[]>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  setPaidCash: React.Dispatch<React.SetStateAction<boolean>>;
  setAlreadyPaid: React.Dispatch<React.SetStateAction<AlreadyPaidState>>;
}

/** Parse session state and handlers returned by {@link useJobParse}. */
interface UseJobParse {
  /** The "Describe the job" text (draft-persisted by the caller). */
  aiInput: string;
  setAiInput: React.Dispatch<React.SetStateAction<string>>;
  parsing: boolean;
  parseResult: ParseJobResponse | null;
  setParseResult: React.Dispatch<React.SetStateAction<ParseJobResponse | null>>;
  parseError: string | null;
  hasParsed: boolean;
  clarifyQuestions: ParseJobQuestion[];
  clarifyAnswers: Record<string, string>;
  setClarifyAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Sends the description (plus any clarifying answers) to the parser. */
  handleParse: (answers?: Record<string, string>) => Promise<void>;
  /** Drops the clarifying questions and their answers. */
  skipClarify: () => void;
  /** Clears the description and the whole parse session. */
  clearAiInput: () => void;
}

/**
 * Owns the AI parse session and applies each parse result to the calculator.
 * @param args - Calculator state the parse session reads and writes.
 * @param args.pricing - Live pricing for travel and task fitting.
 * @param args.eventPrefill - Schedule-event prefill, or null.
 * @param args.jobDate - Job date for the traffic-pattern quote.
 * @param args.jobAddress - Current job address (travel fallback).
 * @param args.timeRanges - The Time card's ranges.
 * @param args.timesSet - Whether the Time card's ranges are real times.
 * @param args.setFollowUpMins - Follow-up minutes setter.
 * @param args.setTimeRanges - Time slots setter.
 * @param args.setTimesSet - Setter for whether the Time card's ranges are real times.
 * @param args.setJobAddress - Job address setter.
 * @param args.setTravelEntries - Travel entries setter.
 * @param args.setTasks - Task lines setter.
 * @param args.setParts - Parts setter.
 * @param args.setNotes - Notes setter.
 * @param args.setPaidCash - "Paid in cash" setter, ticked when the description says so.
 * @param args.setAlreadyPaid - Already paid setter, filled when the description names a cash amount.
 * @returns Parse session state plus its handlers.
 */
export function useJobParse({
  pricing,
  eventPrefill,
  jobDate,
  jobAddress,
  timeRanges,
  timesSet,
  setFollowUpMins,
  setTimeRanges,
  setTimesSet,
  setJobAddress,
  setTravelEntries,
  setTasks,
  setParts,
  setNotes,
  setPaidCash,
  setAlreadyPaid,
}: UseJobParseArgs): UseJobParse {
  const { toast } = useToast();
  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});
  // Bumped by every parse and by Clear, so a reply that lands after either is dropped
  // instead of overwriting the form.
  const requestId = useRef(0);

  /**
   * The job's known windows. A booked event's own slots, unless the operator has edited
   * the times; then (or with no booking) the complete ranges on the Time card, provided
   * they are real times. Without a window, a description with no times parses to none and
   * the tasks stay at their quick-task guesses.
   *
   * A Time card holding nothing but ranges the description itself states has not edited
   * the booking: it is a later visit ("Friday, 1:46 pm to 2:05 pm") read back by an
   * earlier parse that dropped the booked window. The booking's slots go back in ahead of
   * it so the booked visit still bills; buildParseInput then skips the restated range.
   * @returns The windows, and whether they are a merged booking to keep as-is.
   */
  function knownWindow(): { slots: WindowSlot[]; merged: boolean } {
    if (eventPrefill && eventPrefill.slots.length > 0 && !timesSet) {
      return { slots: eventPrefill.slots, merged: eventPrefill.slots.length > 1 };
    }
    if (!timesSet) return { slots: [], merged: false };
    const slots = timeRanges
      .filter((r) => r.startTime && r.endTime && timeDiffMins(r.startTime, r.endTime) > 0)
      .map((r, i) => ({
        date: eventPrefill?.slots[i]?.date ?? jobDate,
        startTime: r.startTime,
        endTime: r.endTime,
      }));
    const restated = new Set(extractRanges(aiInput).map((r) => `${r.startTime}-${r.endTime}`));
    const onlyRestated =
      slots.length > 0 && slots.every((s) => restated.has(`${s.startTime}-${s.endTime}`));
    if (eventPrefill && eventPrefill.slots.length > 0 && onlyRestated) {
      return { slots: [...eventPrefill.slots, ...slots], merged: false };
    }
    return { slots, merged: false };
  }

  /**
   * Applies a parsed job response to the calculator state, hydrating time +
   * tasks + parts + notes from the AI parse result. The auto travel entry is
   * created whenever the parser found any drive time; calcTravelCharge
   * applies the $10 minimum so a 1-min drive still bills the published floor.
   * @param result - The parsed job response returned by the AI.
   * @param known - The known windows the description was sent with.
   * @param known.slots - Booked slots or real Time card ranges; empty when none.
   * @param known.merged - Whether the slots are a merged booking to keep as-is.
   */
  function applyParseResult(
    result: ParseJobResponse,
    known: { slots: WindowSlot[]; merged: boolean },
  ): void {
    const span = parsedWindow(result, known.slots, nzNowTime(), known.merged);
    setFollowUpMins(span.followUpMins);
    // A merged job's slots are the corrected calendar windows, so the parse fills
    // everything but the times. On a single event the description wins, and "Reset to
    // event times" undoes a bad guess. Stated times count as real for the next parse; a
    // window made up from a bare duration doesn't, or a later "about 3 hours" would be
    // capped to the made-up one.
    if (span.timeRanges) {
      setTimeRanges(span.timeRanges);
      setTimesSet(span.stated);
    }

    // A reparse is the new truth for the auto travel entry, the parsed out-of-pocket
    // costs (parking, tolls) and the parsed store runs. Operator-typed manual entries
    // survive it, so they don't have to be re-typed after every AI tweak.
    setJobAddress(result.destination ?? "");
    const parsedCosts = [
      ...parsedCostEntries(result),
      ...parsedStoreRunEntries(result, pricing.travelRatePerHour),
    ];
    const freshAuto = parsedAutoTravel(result, pricing.travelRatePerHour, pricing.minTravelCharge);
    if (freshAuto) {
      setTravelEntries((prev) => {
        // Google's live predictions drift between calls (minutes, and even the
        // route), so a reparse of the same destination keeps the existing auto
        // entry rather than silently moving the price. "Look up" is the refresh.
        const existingAuto = prev.find((e) => e.isAuto);
        const sameDestination =
          existingAuto?.destination?.trim().toLowerCase() ===
          freshAuto.destination?.trim().toLowerCase();
        return [
          existingAuto && sameDestination ? existingAuto : freshAuto,
          ...parsedCosts,
          ...prev.filter((e) => !e.isAuto && !e.isParsedCost),
        ];
      });
    } else {
      // No drive time from the parse (remote, or geocoded to origin): drop the stale auto
      // entry, keep manual ones, and still carry parsed disbursements - a walking-distance
      // job can still have parking.
      //
      // Booked jobs are the exception: their auto entry comes from the frozen TravelBlock,
      // a drive that was actually measured, and a description that just never mentions the
      // trip is not evidence it did not happen. noTravelCharge still wins - that is the
      // parser being told the trip was on foot or on the house, not an omission.
      const keepSeededTravel = eventPrefill !== null && !result.noTravelCharge;
      setTravelEntries((prev) => [
        ...(keepSeededTravel ? prev.filter((e) => e.isAuto) : []),
        ...parsedCosts,
        ...prev.filter((e) => !e.isAuto && !e.isParsedCost),
      ]);
    }

    const fit = fitTasksToWindow(
      hydrateParsedTasks(result),
      span.windowMins,
      pricing.taskTiming,
      pricing.minBillableMins,
    );
    setTasks(fit.tasks);
    const fitNote = describeFit(fit, span.windowMins);
    if (fitNote) toast(fitNote, { tone: "info" });
    setParts(result.parts.map((p) => ({ description: p.description, cost: p.cost })));
    if (result.notes) setNotes(result.notes);
    // Only ever fills: a description that doesn't mention payment says nothing either way.
    // A stated amount may cover only part of the bill, so it goes in Already paid and the
    // rest stays owing; cash with no amount means the whole bill.
    if (result.cashPaid) setAlreadyPaid({ amount: result.cashPaid.toFixed(2), method: "Cash" });
    else if (result.paidCash) setPaidCash(true);
  }

  /**
   * Submits the free-text AI input to the parse-job API and applies the result to the calculator
   * state. If the AI needs clarification it returns questions instead of a result.
   * @param answers - Optional answers to previous clarifying questions to include in the request.
   */
  async function handleParse(answers?: Record<string, string>): Promise<void> {
    if (!aiInput.trim()) return;
    const id = ++requestId.current;
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    setClarifyQuestions([]);
    try {
      // jobDate quotes travel at the job's weekday traffic pattern, not today's.
      const known = knownWindow();
      const input = buildParseInput(aiInput, known.slots);
      const body: Record<string, unknown> = { input, jobDate };
      // Typed descriptions rarely repeat the address, so hand the current job address
      // (event prefill or Travel card) to the route as a travel fallback. The AI's own
      // extracted destination still wins, and a remote booking sends nothing.
      const fallbackDestination = jobAddress.trim();
      if (fallbackDestination && eventPrefill?.meetingType !== "remote") {
        body.fallbackDestination = fallbackDestination;
      }
      if (answers && Object.keys(answers).length > 0) body.answers = answers;
      const res = await fetch("/api/business/parse-job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (id !== requestId.current) return;
      if (d.ok && d.clarify) {
        setClarifyQuestions(d.clarify as ParseJobQuestion[]);
      } else if (d.ok && d.result) {
        setParseResult(d.result);
        applyParseResult(d.result, known);
        setHasParsed(true);
        setClarifyAnswers({});
      } else {
        setParseError("Couldn't parse that - try being more specific, or build manually below.");
      }
    } catch {
      if (id !== requestId.current) return;
      setParseError("Couldn't parse that - try being more specific, or build manually below.");
    }
    setParsing(false);
  }

  /** Drops the clarifying questions and their answers. */
  function skipClarify(): void {
    setClarifyQuestions([]);
    setClarifyAnswers({});
  }

  /** Clears the AI description box and its parse session; parsed rows below stay. */
  function clearAiInput(): void {
    requestId.current++;
    setParsing(false);
    setAiInput("");
    setParseResult(null);
    setParseError(null);
    setHasParsed(false);
    setClarifyQuestions([]);
    setClarifyAnswers({});
  }

  return {
    aiInput,
    setAiInput,
    parsing,
    parseResult,
    setParseResult,
    parseError,
    hasParsed,
    clarifyQuestions,
    clarifyAnswers,
    setClarifyAnswers,
    handleParse,
    skipClarify,
    clearAiInput,
  };
}
