"use client";
// src/features/business/components/calculator/DescribeJobSection.tsx
// "Describe the job" card: the free-text description, the AI parse button, the
// confidence banner, and the clarifying-questions form when the parser asks for more.

import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import {
  JOB_DESCRIPTION_BOOKED_HINT,
  JOB_DESCRIPTION_HINT,
  JOB_DESCRIPTION_PLACEHOLDER,
} from "@/features/business/lib/ai-input-copy";
import type { ParseJobQuestion, ParseJobResponse } from "@/features/business/types/business";
import type React from "react";

interface Props {
  aiInput: string;
  onAiInputChange: (value: string) => void;
  showBookedHint: boolean;
  parseError: string | null;
  parsing: boolean;
  hasParsed: boolean;
  parseResult: ParseJobResponse | null;
  onDismissParseResult: () => void;
  clarifyQuestions: ParseJobQuestion[];
  clarifyAnswers: Record<string, string>;
  onClarifyAnswerChange: (id: string, value: string) => void;
  onParse: (answers?: Record<string, string>) => void;
  onClear: () => void;
  onSkipClarify: () => void;
}

/**
 * The calculator's AI input card. The parse fills in the time, tasks, travel
 * and parts sections below for the operator to check.
 * @param props - Component props.
 * @param props.aiInput - The description text.
 * @param props.onAiInputChange - Called with the new description text.
 * @param props.showBookedHint - Whether to add the booked-job hint (billing a schedule event).
 * @param props.parseError - Parse failure message, or null.
 * @param props.parsing - True while a parse request is in flight.
 * @param props.hasParsed - Whether a parse has landed this session (relabels the button).
 * @param props.parseResult - Last parse result, for the confidence banner, or null.
 * @param props.onDismissParseResult - Dismisses the confidence banner.
 * @param props.clarifyQuestions - Clarifying questions from the parser; empty when none.
 * @param props.clarifyAnswers - Answers typed so far, keyed by question id.
 * @param props.onClarifyAnswerChange - Called with a question id and its new answer.
 * @param props.onParse - Runs the parse, optionally with clarifying answers.
 * @param props.onClear - Clears the description and the parse session.
 * @param props.onSkipClarify - Drops the clarifying questions and their answers.
 * @returns Describe-the-job card element.
 */
export function DescribeJobSection({
  aiInput,
  onAiInputChange,
  showBookedHint,
  parseError,
  parsing,
  hasParsed,
  parseResult,
  onDismissParseResult,
  clarifyQuestions,
  clarifyAnswers,
  onClarifyAnswerChange,
  onParse,
  onClear,
  onSkipClarify,
}: Props): React.ReactElement {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-1 text-sm font-semibold text-russian-violet">Describe the job</h2>
      <p className="mb-3 text-sm text-slate-600">
        {JOB_DESCRIPTION_HINT}
        {showBookedHint && ` ${JOB_DESCRIPTION_BOOKED_HINT}`} The AI fills in the time, tasks,
        travel and parts below for you to check.
      </p>
      <textarea
        value={aiInput}
        onChange={(e) => {
          onAiInputChange(e.target.value);
          if (clarifyQuestions.length > 0) onSkipClarify();
        }}
        rows={6}
        placeholder={JOB_DESCRIPTION_PLACEHOLDER}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
      />
      {parseError && <p className="mt-1 text-sm text-red-600">{parseError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onParse()}
          suppressHydrationWarning
          disabled={parsing || !aiInput.trim()}
          className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {parsing ? "Parsing..." : hasParsed ? "Re-parse" : "Parse with AI"}
        </button>
        {/* Clear the cached description + parse session (the textarea is
          draft-persisted, so old text reappears on every visit).
          Parsed tasks/travel below stay - only the AI box resets. */}
        {(aiInput.trim() !== "" || hasParsed || clarifyQuestions.length > 0) && (
          <button
            onClick={onClear}
            disabled={parsing}
            aria-label="Clear job description"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <span className="self-center text-xs text-slate-400">or build manually below</span>
      </div>
      {parseResult && !parseError && (
        <div className="mt-3">
          <ParseConfidenceBanner
            confidence={parseResult.confidence}
            warnings={parseResult.warnings}
            onDismiss={onDismissParseResult}
          />
        </div>
      )}
      {clarifyQuestions.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-800">
            A few quick questions to fill in the gaps:
          </p>
          <div className="space-y-3">
            {clarifyQuestions.map((q) => (
              <div key={q.id}>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  {q.question}
                </label>
                <input
                  type="text"
                  placeholder={q.hint}
                  value={clarifyAnswers[q.id] ?? ""}
                  onChange={(e) => onClarifyAnswerChange(q.id, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onParse(clarifyAnswers)}
              disabled={parsing}
              className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {parsing ? "Parsing..." : "Submit answers"}
            </button>
            <button
              onClick={onSkipClarify}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
