"use client";
// src/features/business/components/invoice/InvoiceAiBox.tsx
// "Describe the job" box for the draft-invoice editor. Sends the description through the
// same parse-job route and parse helpers as the calculator, then hands back replacement
// line items and the unsuccessful-work discount for them. The promo discount is kept.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import {
  JOB_DESCRIPTION_BOOKED_HINT,
  JOB_DESCRIPTION_HINT,
  JOB_DESCRIPTION_PLACEHOLDER,
} from "@/features/business/lib/ai-input-copy";
import { formatNZD } from "@/features/business/lib/business";
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
  /** The promo discount the invoice keeps; unsuccessful lines are cut after their share. */
  promoDiscount: number;
}

/** Props for {@link InvoiceAiBox}. */
interface InvoiceAiBoxProps {
  context: InvoiceAiContext;
  /** The form's current line items, to find a travel line worth keeping. */
  currentItems: LineItem[];
  /** Whether the parent form is saving. */
  disabled?: boolean;
  /**
   * Receives the parsed line items, any parsed notes, any cash amount already paid and
   * the unsuccessful-work discount for the new lines.
   */
  onApply: (
    lineItems: LineItem[],
    notes: string | null,
    cashPaid: number | null,
    unsuccessfulDiscount: number,
  ) => void;
}

const PARSE_ERROR = "Couldn't parse that - try being more specific, or edit the line items below.";

/**
 * AI description box that rebuilds a draft invoice's line items.
 * @param props - Component props.
 * @param props.context - Booking and pricing context for the parse.
 * @param props.currentItems - The form's current line items.
 * @param props.disabled - Whether the parent form is saving.
 * @param props.onApply - Receives the parsed line items, notes, cash paid and discount.
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
        const { lineItems, fit, windowMins, unsuccessfulDiscount } = parsedJobToLineItems(
          parsed,
          context.slots,
          nzNowTime(),
          context.pricing,
          { line: existingTravel, destination: context.fallbackDestination },
          context.promoDiscount,
        );
        if (lineItems.length === 0) {
          setError(PARSE_ERROR);
        } else {
          setResult(parsed);
          setAnswers({});
          onApply(lineItems, parsed.notes || null, parsed.cashPaid ?? null, unsuccessfulDiscount);
          const fitNote = describeFit(fit, windowMins);
          if (fitNote) toast(fitNote, { tone: "info" });
          if (unsuccessfulDiscount > 0) {
            toast(
              `A task was read as not fixed, so ${formatNZD(unsuccessfulDiscount)} comes off as the unsuccessful-work discount.`,
              { tone: "info" },
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
    <Card>
      {/* A real label for the textarea, sized like the calculator's CardHeader title. */}
      <label
        htmlFor="invoice-ai-input"
        className="mb-1 block text-lg font-semibold text-admin-text"
      >
        Describe the job
      </label>
      <p className="mb-1 text-sm text-admin-muted">
        {JOB_DESCRIPTION_HINT}
        {context.slots.length > 0 && ` ${JOB_DESCRIPTION_BOOKED_HINT}`}
      </p>
      <p className="mb-2 text-sm text-admin-muted">
        Parsing replaces every line item below, so check them before you save. The promo discount
        already on this invoice stays as it is. The unsuccessful-work discount is worked out again
        from the new lines.
      </p>
      <AdminTextarea
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
      />
      {error && <p className="mt-1 text-sm text-coquelicot-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <AdminButton
          type="button"
          variant="outline"
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
              <AdminField key={q.id} label={q.question} htmlFor={`invoice-clarify-${q.id}`}>
                <AdminInput
                  id={`invoice-clarify-${q.id}`}
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
                />
              </AdminField>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <AdminButton
              type="button"
              variant="outline"
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
    </Card>
  );
}
