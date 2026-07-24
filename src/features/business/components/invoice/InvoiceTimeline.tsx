// src/features/business/components/invoice/InvoiceTimeline.tsx
/**
 * @description Vertical lifecycle timeline for an invoice: Created > Sent >
 * Review link sent > Paid > Voided. Steps render only once reached; a reached
 * step with a null timestamp (legacy rows) degrades to a muted "date not
 * recorded" rather than vanishing. Server component.
 */

import type { InvoiceStatus } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/** Accent tone for a timeline dot. */
type StepTone = "neutral" | "info" | "success" | "critical" | "violet";

/** Props for {@link InvoiceTimeline}. */
interface InvoiceTimelineProps {
  /** Stored invoice status - drives which steps count as "reached". */
  status: InvoiceStatus;
  /** When the invoice record was created (always present). */
  createdAt: Date | string;
  /** First SENT stamp; null on legacy sent rows. */
  sentAt?: Date | string | null;
  /** When the review-request link was emailed; null when never sent. */
  reviewLinkSentAt?: Date | string | null;
  /** Payment stamp; null on legacy PAID rows. */
  paidAt?: Date | string | null;
  /** Payment method recorded at pay time. */
  paymentMethod?: string | null;
  /** Operator reference recorded with the payment. */
  paymentReference?: string | null;
  /** When the invoice was voided; null on legacy voided rows. */
  voidedAt?: Date | string | null;
  /** When the most recent overdue reminder was emailed; null = never. */
  reminderLastSentAt?: Date | string | null;
  /** How many overdue reminders have gone out; null reads as 0. */
  reminderCount?: number | null;
}

/** One rendered timeline step. */
interface Step {
  label: string;
  date: Date | string | null;
  detail?: string | null;
  tone: StepTone;
}

/**
 * Dot colour for a step tone.
 * @param tone - Step tone.
 * @returns Background class.
 */
function dotClass(tone: StepTone): string {
  switch (tone) {
    case "neutral":
      return "bg-admin-faint";
    case "info":
      return "bg-blue-500";
    case "success":
      return "bg-emerald-500";
    case "critical":
      return "bg-coquelicot-600";
    case "violet":
      return "bg-russian-violet";
  }
}

/**
 * Renders the invoice lifecycle timeline.
 * @param props - Component props.
 * @param props.status - Stored invoice status.
 * @param props.createdAt - Record creation timestamp.
 * @param props.sentAt - First-sent timestamp (nullable).
 * @param props.reviewLinkSentAt - Review-link send timestamp (nullable).
 * @param props.paidAt - Payment timestamp (nullable).
 * @param props.paymentMethod - Payment method (nullable).
 * @param props.paymentReference - Payment reference (nullable).
 * @param props.voidedAt - Void timestamp (nullable).
 * @param props.reminderLastSentAt - Most recent overdue-reminder timestamp (nullable).
 * @param props.reminderCount - Overdue reminders sent so far (null reads as 0).
 * @returns The timeline element.
 */
export function InvoiceTimeline({
  status,
  createdAt,
  sentAt,
  reviewLinkSentAt,
  paidAt,
  paymentMethod,
  paymentReference,
  voidedAt,
  reminderLastSentAt,
  reminderCount,
}: InvoiceTimelineProps): React.ReactElement {
  const steps: Step[] = [{ label: "Created", date: createdAt, tone: "neutral" }];

  // Sent: reached once the invoice left DRAFT. VOIDED can't confirm a prior send
  // on its own, so it only shows this step when an actual sentAt exists.
  const wasSent = sentAt != null || status === "SENT" || status === "PAID";
  if (wasSent) steps.push({ label: "Sent to client", date: sentAt ?? null, tone: "info" });

  if (reviewLinkSentAt) {
    steps.push({ label: "Review link sent", date: reviewLinkSentAt, tone: "violet" });
  }

  // Overdue chasing: one step summarising all reminders, dated by the latest.
  if (reminderLastSentAt != null) {
    const n = reminderCount ?? 1;
    steps.push({
      label: n > 1 ? `Reminder sent (x${n})` : "Reminder sent",
      date: reminderLastSentAt,
      tone: "critical",
    });
  }

  if (status === "PAID" || paidAt != null) {
    const detail = [paymentMethod, paymentReference].filter(Boolean).join(" · ") || null;
    steps.push({ label: "Paid", date: paidAt ?? null, detail, tone: "success" });
  }

  if (status === "VOIDED" || voidedAt != null) {
    steps.push({ label: "Voided", date: voidedAt ?? null, tone: "critical" });
  }

  return (
    <ol className="space-y-0.5">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", dotClass(step.tone))} />
            {i < steps.length - 1 && <span className="w-px flex-1 bg-admin-border" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-medium text-admin-text">{step.label}</p>
            <p className="text-xs text-admin-muted">
              {step.date ? formatDateShort(step.date) : "date not recorded"}
              {step.detail ? ` · ${step.detail}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
