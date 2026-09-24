"use client";
// Live recap of the booking form's choices, shown above the submit button.

import { cn } from "@/shared/lib/cn";
import type React from "react";

export interface BookingSummaryCardProps {
  /** Chosen duration's label, or null. */
  durationLabel: string | null;
  /** Chosen day's full label, or null. */
  dayLabel: string | null;
  /** Chosen start time's label, or null. */
  timeLabel: string | null;
  /** Meeting type, or "" when not chosen. */
  meetingType: "in-person" | "remote" | "";
  /** Unit + street address combined; only shown for in-person visits. */
  combinedAddress: string;
  /** Customer name as typed. */
  name: string;
  /** Customer email as typed. */
  email: string;
  /** Customer phone as typed. */
  phone: string;
  /** True once a saved draft was restored; shows the "Clear form" button. */
  draftRestored: boolean;
  /** Clears the saved draft and the form fields. */
  onClearDraft: () => void;
}

/**
 * Booking summary - live recap of what's selected so the user can see their
 * choices before submit.
 * @param props - Component props.
 * @param props.durationLabel - Chosen duration's label, or null.
 * @param props.dayLabel - Chosen day's full label, or null.
 * @param props.timeLabel - Chosen start time's label, or null.
 * @param props.meetingType - Meeting type, or "".
 * @param props.combinedAddress - Unit + street address combined.
 * @param props.name - Customer name as typed.
 * @param props.email - Customer email as typed.
 * @param props.phone - Customer phone as typed.
 * @param props.draftRestored - True once a saved draft was restored.
 * @param props.onClearDraft - Clears the saved draft and the form fields.
 * @returns The summary section.
 */
export function BookingSummaryCard({
  durationLabel,
  dayLabel,
  timeLabel,
  meetingType,
  combinedAddress,
  name,
  email,
  phone,
  draftRestored,
  onClearDraft,
}: BookingSummaryCardProps): React.ReactElement {
  return (
    <section
      aria-label="Your appointment so far"
      className="flex flex-col gap-2 rounded-lg border border-moonstone-500/30 bg-moonstone-400/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold text-russian-violet sm:text-lg">Your appointment</h3>
        {draftRestored && (
          <button
            type="button"
            onClick={onClearDraft}
            className={cn(
              // Negative margin: a 44px target without pushing the heading down.
              "-my-2.5 min-h-11 px-1 text-sm text-rich-black/70 underline underline-offset-2",
              "rounded hover:text-rich-black focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
            )}
          >
            Clear form
          </button>
        )}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-base">
        <dt className="text-rich-black/60">Length</dt>
        <dd className="text-rich-black">
          {durationLabel ?? <span className="text-rich-black/50">—</span>}
        </dd>

        <dt className="text-rich-black/60">Date</dt>
        <dd className="text-rich-black">
          {dayLabel ? dayLabel : <span className="text-rich-black/50">—</span>}
        </dd>

        <dt className="text-rich-black/60">Time</dt>
        <dd className="text-rich-black">
          {timeLabel ? timeLabel : <span className="text-rich-black/50">—</span>}
        </dd>

        <dt className="text-rich-black/60">Meeting</dt>
        <dd className="text-rich-black capitalize">
          {meetingType ? (
            meetingType.replace("-", " ")
          ) : (
            <span className="text-rich-black/50">—</span>
          )}
        </dd>

        {meetingType === "in-person" && (
          <>
            <dt className="text-rich-black/60">Address</dt>
            <dd className="wrap-break-word text-rich-black">
              {combinedAddress.trim() ? (
                combinedAddress
              ) : (
                <span className="text-rich-black/50">—</span>
              )}
            </dd>
          </>
        )}

        {/* Contact details read back so a typo (wrong email/phone) is
            visible before submit - the cheapest catch for a mistyped
            address that would otherwise send the confirmation nowhere. */}
        {name.trim() && (
          <>
            <dt className="text-rich-black/60">Name</dt>
            <dd className="wrap-break-word text-rich-black">{name}</dd>
          </>
        )}
        {email.trim() && (
          <>
            <dt className="text-rich-black/60">Email</dt>
            <dd className="wrap-break-word text-rich-black">{email}</dd>
          </>
        )}
        {phone.trim() && (
          <>
            <dt className="text-rich-black/60">Phone</dt>
            <dd className="wrap-break-word text-rich-black">{phone}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
