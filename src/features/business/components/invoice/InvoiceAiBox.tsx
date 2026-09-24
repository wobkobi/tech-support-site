"use client";
// "Describe the job" box for the draft-invoice editor. Sends the description through the
// same parse-job route and parse helpers as the calculator, then hands back replacement
// line items. Discounts preserved on the invoice are not recalculated.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import {
  JOB_DESCRIPTION_BOOKED_HINT,
  JOB_DESCRIPTION_HINT,
  JOB_DESCRIPTION_PLACEHOLDER,
} from "@/features/business/lib/ai-input-copy";
import {
  buildParseInput,
  describeFit,
  parsedJobToLineItems,
  type ParsedJobPricing,
} from "@/features/business/lib/parse-hydrate";
import type {
  EventPrefillSlot,
  LineItem,
  ParseJobQuestion,
  ParseJobResponse,
} from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { nzNowTime } from "@/shared/lib/timezone-utils";
import type React from "react";
import { useState } from "react";

/** Booking and pricing context the parse bills against. */
export interface InvoiceAiContext {
  /** Booked event slots the invoice bills; empty for an unbooked invoice. */
  slots: EventPrefillSlot[];
  /** NZ-local YYYY-MM-DD the work was done; drives travel traffic quoting. */
  jobDate: string;
  /** Job address to quote travel from when the description names none. */
  fallbackDestination: string | null;
  pricing: ParsedJobPricing;
}

/** Props for {@link InvoiceAiBox}. */
interface InvoiceAiBoxProps {
  context: InvoiceAiContext;
  /** The form's current line items, to find a travel line worth keeping. */
  currentItems: LineItem[];
  /** Whether the parent form is saving. */
  disabled?: boolean;
  /** Receives the parsed line items and any parsed notes. */
  onApply: (lineItems: LineItem[], notes: string | null) => void;
}

const PARSE_ERROR = "Couldn't parse that - try being more specific, or edit the line items below.";

/**
 * AI description box that rebuilds a draft invoice's line items.
 * @param props - Component props.
 * @param props.context - Booking and pricing context for the parse.
 * @param props.currentItems - The form's current line items.
 * @param props.disabled - Whether the parent form is saving.
 * @param props.onApply - Receives the parsed line items and notes.
 * @returns The AI box element.
 */
export function InvoiceAiBox({
  context,
  currentItems,
  disabled = false,
  onApply,
}: InvoiceAiBoxProps): React.ReactElement {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseJobResponse | null>(null);
  const [questions, setQuestions] = useState<ParseJobQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /**
   * Parses the description and applies the result as the invoice's line items. When the
   * AI needs more detail it returns questions instead.
   * @param withAnswers - Answers to the previous round of questions.
   */
  async function parse(withAnswers?: Record<string, string>): Promise<void> {
    if (!input.trim()) return;
    setParsing(true);
    setError(null);
    setResult(null);
    setQuestions([]);
    try {
      const body: Record<string, unknown> = {
        input: buildParseInput(input, context.slots),
        jobDate: context.jobDate,
      };
      if (context.fallbackDestination) body.fallbackDestination = context.fallbackDestination;
      if (withAnswers && Object.keys(withAnswers).length > 0) body.answers = withAnswers;
      const res = await fetch("/api/business/parse-job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok && d.clarify) {
        setQuestions(d.clarify as ParseJobQuestion[]);
      } else if (d.ok && d.result) {
        const parsed = d.result as ParseJobResponse;
        const existingTravel =
          currentItems.find((li) => li.description.startsWith("Round-trip travel")) ?? null;
        const { lineItems, fit, windowMins } = parsedJobToLineItems(
          parsed,
          context.slots,
          nzNowTime(),
          context.pricing,
          { line: existingTravel, destination: context.fallbackDestination },
        );
        if (lineItems.length === 0) {
          setError(PARSE_ERROR);
        } else {
          setResult(parsed);
          setAnswers({});
          onApply(lineItems, parsed.notes || null);
          const fitNote = describeFit(fit, windowMins);
          if (fitNote) toast(fitNote, { tone: "info" });
          // The per-task half-price discount lives in the invoice's preserved
          // unsuccessful-visit amount, which an edit doesn't recalculate.
          if (parsed.tasks.some((t) => t.unsuccessful)) {
            toast(
              "A task was read as unsuccessful - adjust its price by hand if it's discounted.",
              {
                tone: "warning",
              },
            );
          }
        }
      } else {
        setError(PARSE_ERROR);
      }
    } catch {
      setError(PARSE_ERROR);
    }
    setParsing(false);
  }

  const busy = parsing || disabled;

  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-4">
      <label
        htmlFor="invoice-ai-input"
        className="mb-1 block text-sm font-semibold text-russian-violet"
      >
        Describe the job
      </label>
      <p className="mb-1 text-sm text-admin-muted">
        {JOB_DESCRIPTION_HINT}
        {context.slots.length > 0 && ` ${JOB_DESCRIPTION_BOOKED_HINT}`}
      </p>
      <p className="mb-2 text-sm text-admin-muted">
        Parsing replaces every line item below, so check them before you save. The promo and
        unsuccessful-visit discounts already on this invoice stay as they are.
      </p>
      <textarea
        id="invoice-ai-input"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (questions.length > 0) {
            setQuestions([]);
            setAnswers({});
          }
        }}
        rows={5}
        disabled={busy}
        placeholder={JOB_DESCRIPTION_PLACEHOLDER}
        className={cn(ADMIN_INPUT_CLS, "resize-y")}
      />
      {error && <p className="mt-1 text-sm text-coquelicot-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <AdminButton
          type="button"
          onClick={() => void parse()}
          disabled={busy || !input.trim()}
          busy={parsing}
        >
          {result ? "Re-parse" : "Parse with AI"}
        </AdminButton>
        {(input.trim() !== "" || result || questions.length > 0) && (
          <AdminButton
            type="button"
            variant="secondary"
            onClick={() => {
              setInput("");
              setResult(null);
              setError(null);
              setQuestions([]);
              setAnswers({});
            }}
            disabled={busy}
          >
            Clear
          </AdminButton>
        )}
      </div>
      {result && !error && (
        <div className="mt-3">
          <ParseConfidenceBanner
            confidence={result.confidence}
            warnings={result.warnings}
            onDismiss={() => setResult(null)}
          />
        </div>
      )}
      {questions.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-800">
            A few quick questions to fill in the gaps:
          </p>
          <div className="space-y-3">
            {questions.map((q) => (
              <label key={q.id} className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{q.question}</span>
                <input
                  type="text"
                  placeholder={q.hint}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    // The box sits inside the invoice form; Enter would save the invoice.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void parse(answers);
                    }
                  }}
                  disabled={busy}
                  className={ADMIN_INPUT_CLS}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <AdminButton
              type="button"
              onClick={() => void parse(answers)}
              disabled={busy}
              busy={parsing}
            >
              Submit answers
            </AdminButton>
            <AdminButton
              type="button"
              variant="secondary"
              onClick={() => {
                setQuestions([]);
                setAnswers({});
              }}
            >
              Skip
            </AdminButton>
          </div>
        </div>
      )}
    </div>
  );
}
