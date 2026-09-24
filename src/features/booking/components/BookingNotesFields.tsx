"use client";
// Issue description and visit access-notes textareas for the booking form.

import { BOOKING_FIELD_LIMITS } from "@/features/booking/lib/booking";
import { NOTES_WARN_GAP } from "@/features/booking/lib/booking-form";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useState } from "react";

export interface BookingNotesFieldProps {
  /** Description text. */
  value: string;
  /** Called with the new text on every edit. */
  onChange: (value: string) => void;
  /** Inline field error, if any. */
  error?: string;
  /** Raises an inline field error (the too-short nudge on blur). */
  onError: (message: string) => void;
  /** Clears the description and anything worked out from it. */
  onClear: () => void;
}

/**
 * "What do you need help with?" textarea with a character counter, a paste
 * trimmed hint and a one-tap Clear.
 * @param props - Component props.
 * @param props.value - Description text.
 * @param props.onChange - Called with the new text on every edit.
 * @param props.error - Inline field error, if any.
 * @param props.onError - Raises an inline field error.
 * @param props.onClear - Clears the description and anything worked out from it.
 * @returns The description field.
 */
export function BookingNotesField({
  value: notes,
  onChange,
  error,
  onError,
  onClear,
}: BookingNotesFieldProps): React.ReactElement {
  // Lit when notes paste is trimmed to fit the cap; auto-clears after 4s.
  const [pasteTrimmed, setPasteTrimmed] = useState(false);

  // Auto-clear the "paste was trimmed" hint after a few seconds.
  useEffect(() => {
    if (!pasteTrimmed) return;
    const t = setTimeout(() => setPasteTrimmed(false), 4000);
    return () => clearTimeout(t);
  }, [pasteTrimmed]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="booking-notes" className="text-base font-semibold text-rich-black">
        What do you need help with? <span className="text-error">*</span>
      </label>
      <textarea
        id="booking-notes"
        name="booking-notes-no-autofill"
        autoComplete="new-password"
        rows={4}
        required
        aria-required
        maxLength={BOOKING_FIELD_LIMITS.notes}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          // Nudge before submit if there's some text but not enough context.
          const trimmed = notes.trim();
          if (trimmed && trimmed.length < BOOKING_FIELD_LIMITS.notesMin) {
            onError(
              `Please describe the issue in at least ${BOOKING_FIELD_LIMITS.notesMin} characters so I have enough context.`,
            );
          }
        }}
        onPaste={(e) => {
          // Browsers truncate silently at maxLength, so detect an over-long
          // paste and hint that the text was trimmed. The selection range
          // narrows the check to whatever the paste actually replaces.
          const pasted = e.clipboardData.getData("text") ?? "";
          const target = e.currentTarget;
          const selectionLen = (target.selectionEnd ?? 0) - (target.selectionStart ?? 0);
          const projected = notes.length - selectionLen + pasted.length;
          if (projected > BOOKING_FIELD_LIMITS.notes) {
            setPasteTrimmed(true);
          }
        }}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? "booking-notes-error" : "booking-notes-counter"}
        className={cn(
          "rounded-md border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
          "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
          error && "border-coquelicot-500/60",
        )}
        placeholder="e.g., Wi-Fi not working, need help with email setup, laptop running slow..."
      />
      <div id="booking-notes-counter" className="flex items-center justify-between gap-3 text-sm">
        <span className={cn(pasteTrimmed ? "text-error" : "text-rich-black/70")} aria-live="polite">
          {pasteTrimmed
            ? `Pasted text was trimmed to fit the ${BOOKING_FIELD_LIMITS.notes}-character limit.`
            : " "}
        </span>
        <span className="flex items-center gap-3">
          {/* Clear the description + the rough estimate it produced below.
              The description is draft-persisted, so restored text needs a
              one-tap way out on mobile. */}
          {notes !== "" && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setPasteTrimmed(false);
              }}
              aria-label="Clear the issue description"
              className={cn(
                // Negative margin: a 44px target without growing the counter row.
                "-my-3 min-h-11 px-1 text-sm text-rich-black/70 underline underline-offset-2",
                "rounded hover:text-rich-black focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
              )}
            >
              Clear
            </button>
          )}
          <span
            className={cn(
              "tabular-nums",
              notes.length >= BOOKING_FIELD_LIMITS.notes - NOTES_WARN_GAP
                ? "font-medium text-error"
                : "text-rich-black/70",
            )}
          >
            {notes.length} / {BOOKING_FIELD_LIMITS.notes}
          </span>
        </span>
      </div>
      {error && (
        <p id="booking-notes-error" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export interface BookingAccessNotesFieldProps {
  /** Access notes text. */
  value: string;
  /** Called with the new text on every edit. */
  onChange: (value: string) => void;
}

/**
 * Optional "anything else for the visit?" textarea (parking, gate codes, pets).
 * @param props - Component props.
 * @param props.value - Access notes text.
 * @param props.onChange - Called with the new text on every edit.
 * @returns The access notes field.
 */
export function BookingAccessNotesField({
  value: accessNotes,
  onChange,
}: BookingAccessNotesFieldProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="booking-access-notes" className="text-base font-semibold text-rich-black">
        Anything else I should know for the visit?{" "}
        <span className="font-normal text-rich-black/70">(optional)</span>
      </label>
      <p id="booking-access-notes-hint" className="text-base text-rich-black/70">
        Parking, directions, gate or door codes, pets, or the best way in.
      </p>
      <textarea
        id="booking-access-notes"
        name="booking-access-notes-no-autofill"
        autoComplete="off"
        rows={3}
        maxLength={BOOKING_FIELD_LIMITS.accessNotes}
        value={accessNotes}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby="booking-access-notes-hint booking-access-notes-counter"
        className={cn(
          "rounded-md border border-seasalt-200/80 bg-seasalt px-4 py-3 text-base text-rich-black",
          "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
        )}
        placeholder="e.g., Park on the street, the driveway is steep. Side gate is unlocked. Friendly dog."
      />
      <p
        id="booking-access-notes-counter"
        className={cn(
          "self-end text-sm tabular-nums",
          accessNotes.length >= BOOKING_FIELD_LIMITS.accessNotes - NOTES_WARN_GAP
            ? "font-medium text-error"
            : "text-rich-black/70",
        )}
      >
        {accessNotes.length} / {BOOKING_FIELD_LIMITS.accessNotes}
      </p>
    </div>
  );
}
