// src/features/booking/components/admin/BookingTimeline.tsx
/**
 * @description Vertical lifecycle timeline for a booking: Created > Reminder sent
 * > Completed / Cancelled > Review sent > Review submitted. A cancelled booking
 * branches to a Cancelled step that spells out who cancelled and which fee flags
 * fired (late cancellation, travel charge, no-show). Steps render only once the
 * booking has reached them; a reached step whose timestamp is null (legacy rows,
 * or the completed marker which has no dedicated stamp) degrades to a muted note
 * rather than vanishing. Server component - no client hooks.
 */

import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type { CancelledBy } from "@prisma/client";
import type React from "react";

/** Accent tone for a timeline dot. */
type StepTone = "neutral" | "info" | "success" | "critical" | "violet";

/** Props for {@link BookingTimeline}. */
interface BookingTimelineProps {
  /** Booking lifecycle status - drives the completed vs cancelled branch. */
  status: "held" | "confirmed" | "cancelled" | "completed";
  /** When the booking was created (always present). */
  createdAt: Date | string;
  /** When the 24h reminder email went out; null when never sent. */
  emailReminderSentAt?: Date | string | null;
  /** When the review-request email was sent; null when never sent. */
  reviewSentAt?: Date | string | null;
  /** When the customer submitted their review; null when they haven't. */
  reviewSubmittedAt?: Date | string | null;
  /** When the booking was cancelled; null on legacy cancelled rows. */
  cancelledAt?: Date | string | null;
  /** Who cancelled - operator (no fee) or customer (fee rules). */
  cancelledBy?: CancelledBy | null;
  /** Cancelled inside the free-notice window (fee applies). */
  lateCancellation?: boolean;
  /** Travel charge applies (cancelled inside the travel window). */
  travelChargeApplies?: boolean;
  /** Customer didn't show up (charged callout + travel). */
  noShow?: boolean;
}

/** One rendered timeline step. */
interface Step {
  label: string;
  /** Timestamp for the step, or null when it has none / wasn't recorded. */
  date: Date | string | null;
  /** Extra muted context (e.g. cancellation flags). */
  detail?: string | null;
  /**
   * When true, a null date degrades to "date not recorded". When false, the step
   * has no dedicated timestamp field (the completed marker) so no date is shown.
   */
  hasDate: boolean;
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
 * Builds the cancellation detail line from the fee flags.
 * @param props - The cancellation-related props.
 * @returns A " · "-joined summary, or null when nothing notable fired.
 */
function cancellationDetail(props: BookingTimelineProps): string | null {
  const parts: string[] = [];
  if (props.noShow) parts.push("no-show");
  parts.push(props.cancelledBy === "customer" ? "by customer" : "by operator");
  if (props.lateCancellation) parts.push("late cancellation");
  if (props.travelChargeApplies) parts.push("travel charged");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Renders the booking lifecycle timeline.
 * @param props - Component props.
 * @param props.status - Booking lifecycle status.
 * @param props.createdAt - Record creation timestamp.
 * @param props.emailReminderSentAt - Reminder-email timestamp (nullable).
 * @param props.reviewSentAt - Review-request send timestamp (nullable).
 * @param props.reviewSubmittedAt - Review submission timestamp (nullable).
 * @param props.cancelledAt - Cancellation timestamp (nullable).
 * @param props.cancelledBy - Who cancelled (nullable).
 * @param props.lateCancellation - Late-cancellation fee flag.
 * @param props.travelChargeApplies - Travel-charge flag.
 * @param props.noShow - No-show flag.
 * @returns The timeline element.
 */
export function BookingTimeline(props: BookingTimelineProps): React.ReactElement {
  const { status, createdAt, emailReminderSentAt, reviewSentAt, reviewSubmittedAt, cancelledAt } =
    props;

  const steps: Step[] = [{ label: "Created", date: createdAt, hasDate: true, tone: "neutral" }];

  if (emailReminderSentAt) {
    steps.push({ label: "Reminder sent", date: emailReminderSentAt, hasDate: true, tone: "info" });
  }

  const isCancelled = status === "cancelled" || cancelledAt != null;
  if (isCancelled) {
    steps.push({
      label: props.noShow ? "No-show" : "Cancelled",
      date: cancelledAt ?? null,
      detail: cancellationDetail(props),
      hasDate: true,
      tone: "critical",
    });
  } else {
    // Completed has no dedicated timestamp - show it as a reached status marker.
    if (status === "completed") {
      steps.push({ label: "Completed", date: null, hasDate: false, tone: "success" });
    }
    if (reviewSentAt) {
      steps.push({ label: "Review email sent", date: reviewSentAt, hasDate: true, tone: "violet" });
    }
    if (reviewSubmittedAt) {
      steps.push({
        label: "Review submitted",
        date: reviewSubmittedAt,
        hasDate: true,
        tone: "success",
      });
    }
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
            {(step.hasDate || step.detail) && (
              <p className="text-xs text-admin-muted">
                {step.hasDate
                  ? step.date
                    ? formatDateTimeShort(step.date)
                    : "date not recorded"
                  : ""}
                {step.hasDate && step.detail ? " · " : ""}
                {step.detail ?? ""}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
