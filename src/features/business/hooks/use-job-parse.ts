"use client";
// src/features/business/hooks/use-job-parse.ts
// The calculator's AI parse session: the "Describe the job" text, the parse-job call
// with its clarifying-question round, and hydration of a parse result into the
// calculator's time, travel, tasks, parts and notes.

import { useToast } from "@/features/admin/components/ui/Toast";
import type { JobPricing } from "@/features/business/lib/business";
import {
  buildParseInput,
  describeFit,
  fitTasksToWindow,
  hydrateParsedTasks,
  parsedAutoTravel,
  parsedCostEntries,
  parsedWindow,
} from "@/features/business/lib/parse-hydrate";
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
import { useState } from "react";

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
  setFollowUpMins: React.Dispatch<React.SetStateAction<number>>;
  setTimeRanges: React.Dispatch<React.SetStateAction<ParsedRange[]>>;
  setJobAddress: React.Dispatch<React.SetStateAction<string>>;
  setTravelEntries: React.Dispatch<React.SetStateAction<TravelEntry[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskLine[]>>;
  setParts: React.Dispatch<React.SetStateAction<PartLine[]>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
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
 * @param args.setFollowUpMins - Follow-up minutes setter.
 * @param args.setTimeRanges - Time slots setter.
 * @param args.setJobAddress - Job address setter.
 * @param args.setTravelEntries - Travel entries setter.
 * @param args.setTasks - Task lines setter.
 * @param args.setParts - Parts setter.
 * @param args.setNotes - Notes setter.
 * @returns Parse session state plus its handlers.
 */
export function useJobParse({
  pricing,
  eventPrefill,
  jobDate,
  jobAddress,
  setFollowUpMins,
  setTimeRanges,
  setJobAddress,
  setTravelEntries,
  setTasks,
  setParts,
  setNotes,
}: UseJobParseArgs): UseJobParse {
  const { toast } = useToast();
  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  /**
   * Applies a parsed job response to the calculator state, hydrating time +
   * tasks + parts + notes from the AI parse result. The auto travel entry is
   * created whenever the parser found any drive time; calcTravelCharge
   * applies the $10 minimum so a 1-min drive still bills the published floor.
   * @param result - The parsed job response returned by the AI.
   */
  function applyParseResult(result: ParseJobResponse): void {
    const slots = eventPrefill?.slots ?? [];
    const span = parsedWindow(result, slots, nzNowTime());
    setFollowUpMins(span.followUpMins);
    // A merged job's slots are the corrected calendar windows, so the parse fills
    // everything but the times. On a single event the description wins, and "Reset to
    // event times" undoes a bad guess.
    if (span.timeRanges) setTimeRanges(span.timeRanges);

    // A reparse is the new truth for the auto travel entry and the parsed out-of-pocket
    // costs (parking, tolls). Operator-typed manual entries survive it, so they don't have
    // to be re-typed after every AI tweak.
    setJobAddress(result.destination ?? "");
    const parsedCosts = parsedCostEntries(result);
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
  }

  /**
   * Submits the free-text AI input to the parse-job API and applies the result to the calculator
   * state. If the AI needs clarification it returns questions instead of a result.
   * @param answers - Optional answers to previous clarifying questions to include in the request.
   */
  async function handleParse(answers?: Record<string, string>): Promise<void> {
    if (!aiInput.trim()) return;
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    setClarifyQuestions([]);
    try {
      // jobDate quotes travel at the job's weekday traffic pattern, not today's.
      const input = buildParseInput(aiInput, eventPrefill?.slots ?? []);
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
      if (d.ok && d.clarify) {
        setClarifyQuestions(d.clarify as ParseJobQuestion[]);
      } else if (d.ok && d.result) {
        setParseResult(d.result);
        applyParseResult(d.result);
        setHasParsed(true);
        setClarifyAnswers({});
      } else {
        setParseError("Couldn't parse that - try being more specific, or build manually below.");
      }
    } catch {
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
