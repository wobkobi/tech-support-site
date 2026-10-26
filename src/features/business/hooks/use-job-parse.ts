"use client";
// src/features/business/hooks/use-job-parse.ts
// The calculator's AI parse session: the parse-job call with its clarifying questions, and
// hydration of the result into time, travel, tasks, parts, notes and payment.

import { useToast } from "@/features/admin/components/ui/Toast";
import type { AlreadyPaidState } from "@/features/business/lib/already-paid-input";
import { isTripDrive, timeDiffMins, type JobPricing } from "@/features/business/lib/business";
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
  /** Whether the invoice is addressed to the picked contact's company. */
  billedToCompany: boolean;
  /** Whether Walked is picked (by hand or from the schedule), so a parse adds no drive. */
  walked: boolean;
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
 * @param args.billedToCompany - Whether the invoice is addressed to the contact's company.
 * @param args.walked - Whether Walked is picked, so the parsed drive is dropped.
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
  billedToCompany,
  walked,
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
  // Bumped by every parse and by Clear, so a late reply is dropped.
  const requestId = useRef(0);

  /**
   * The job's known windows: the booked slots unless the times were edited, else the Time
   * card's real ranges. Ranges the description itself states (an earlier parse's read-back)
   * don't count as an edit, so the booked slots go back in ahead of them.
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
   * Applies a parse result to the calculator. Any drive time creates the auto travel entry
   * (calcTravelCharge applies the $10 minimum), unless Walked is picked: the route still
   * times a drive to the job address, but a walk bills no travel.
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
    // A merged job keeps its calendar times; otherwise the description wins. Only stated
    // times count as real, so a window made up from a bare duration can't cap a later parse.
    if (span.timeRanges) {
      setTimeRanges(span.timeRanges);
      setTimesSet(span.stated);
    }

    // A reparse replaces the auto travel entry, parsed costs and store runs; manual entries survive.
    setJobAddress(result.destination ?? "");
    const parsedCosts = [
      ...parsedCostEntries(result),
      ...parsedStoreRunEntries(result, pricing.travelRatePerHour),
    ];
    const freshAuto = walked
      ? null
      : parsedAutoTravel(result, pricing.travelRatePerHour, pricing.minTravelCharge);
    if (freshAuto) {
      setTravelEntries((prev) => {
        // Google's predictions drift between calls, so the same destination keeps the
        // existing trip and price. "Look up" is the refresh.
        const existingTrip = prev.find(isTripDrive);
        const sameDestination =
          existingTrip?.destination?.trim().toLowerCase() ===
          freshAuto.destination?.trim().toLowerCase();
        return [
          existingTrip && sameDestination ? existingTrip : freshAuto,
          ...parsedCosts,
          ...prev.filter((e) => !isTripDrive(e) && !e.isParsedCost),
        ];
      });
    } else {
      // No drive time: drop the auto entry but keep parsed disbursements (parking). A booked
      // job keeps its measured TravelBlock entry unless noTravelCharge says otherwise.
      const keepSeededTravel = eventPrefill !== null && !result.noTravelCharge;
      setTravelEntries((prev) => [
        ...(keepSeededTravel ? prev.filter(isTripDrive) : []),
        ...parsedCosts,
        ...prev.filter((e) => !isTripDrive(e) && !e.isParsedCost),
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
    // Only ever fills. A stated amount goes in Already paid; cash with no amount is the whole bill.
    if (result.cashPaid) setAlreadyPaid({ amount: result.cashPaid.toFixed(2), method: "Cash" });
    else if (result.paidCash) setPaidCash(true);
  }

  /**
   * Sends the description to the parse-job API and applies the result, or shows its
   * clarifying questions.
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
      // Current job address as a travel fallback; the AI's own destination still wins.
      const fallbackDestination = jobAddress.trim();
      if (fallbackDestination && eventPrefill?.meetingType !== "remote") {
        body.fallbackDestination = fallbackDestination;
      }
      // The route adds Remote to a remote booking's tasks and Business to a company's.
      if (eventPrefill?.meetingType) body.meetingType = eventPrefill.meetingType;
      if (billedToCompany) body.billedToCompany = true;
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
