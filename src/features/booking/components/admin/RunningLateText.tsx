"use client";
// src/features/booking/components/admin/RunningLateText.tsx
// "Running late?" card on a booking: pick how late, then one tap opens Messages with a text to
// the customer already written.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";

const CHOICES = [5, 10, 15, 20, 30, 45];

interface Props {
  /** Customer's full name. */
  name: string;
  /** Customer's phone number. */
  phone: string;
  /** Job start, already formatted like "2:30pm". */
  startLabel: string;
  /** Minutes late from the last running-late push, if one was sent. */
  suggestedMin: number | null;
  /** Your first name, for the sign-off. */
  senderName: string;
  /** Business name. */
  company: string;
}

/**
 * The text sent to the customer.
 * @param customer - Customer's full name.
 * @param sender - Your first name.
 * @param company - Business name.
 * @param minutes - How late.
 * @param startLabel - Job start like "2:30pm".
 * @returns The message.
 */
export function runningLateMessage(
  customer: string,
  sender: string,
  company: string,
  minutes: number,
  startLabel: string,
): string {
  const first = customer.trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hi ${first}` : "Hi";
  return `${greeting}, it's ${sender} from ${company}. Traffic's slowing me down, so I'll be about ${minutes} minutes late for our ${startLabel} appointment. Sorry about that, see you soon.`;
}

/**
 * The closest choice at or above the suggested lateness, so the text never undersells it.
 * @param suggestedMin - Minutes late from the push, if any.
 * @returns The preselected choice.
 */
function initialChoice(suggestedMin: number | null): number {
  if (suggestedMin == null) return 10;
  return CHOICES.find((c) => c >= suggestedMin) ?? CHOICES.at(-1) ?? 45;
}

/**
 * Running-late text card.
 * @param props - Component props.
 * @param props.name - Customer's full name.
 * @param props.phone - Customer's phone number.
 * @param props.startLabel - Job start like "2:30pm".
 * @param props.suggestedMin - Minutes late from the last push, if any.
 * @param props.senderName - Your first name.
 * @param props.company - Business name.
 * @returns Card element.
 */
export function RunningLateText({
  name,
  phone,
  startLabel,
  suggestedMin,
  senderName,
  company,
}: Props): React.ReactElement {
  const [minutes, setMinutes] = useState(() => initialChoice(suggestedMin));
  const message = runningLateMessage(name, senderName, company, minutes, startLabel);
  // "?&body=" is the form both iOS and Android Messages read.
  const href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;

  return (
    <Card>
      <CardHeader
        title="Running late?"
        description={
          suggestedMin != null
            ? `Traffic had you about ${suggestedMin} min late. Pick how late, then send.`
            : "Pick how late, then send."
        }
      />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How late">
        {CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={minutes === c}
            onClick={() => setMinutes(c)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-base font-semibold",
              minutes === c
                ? "border-russian-violet bg-russian-violet text-white"
                : "border-admin-border bg-admin-surface text-admin-text",
            )}
          >
            {c} min
          </button>
        ))}
      </div>
      <p className="mt-3 rounded-md bg-seasalt-100 p-3 text-base text-admin-text">{message}</p>
      <a href={href} className={cn(adminButtonClass({ variant: "primary", size: "sm" }), "mt-3")}>
        Text {name.trim().split(/\s+/)[0] || "them"}
      </a>
    </Card>
  );
}
