// src/features/admin/components/ui/TimeCheckNote.tsx
// The amber "Did you mean...?" line under times that look like an am/pm slip, with a one-tap
// fix when there is one. Server-safe.

import type React from "react";

/**
 * Time check note.
 * @param props - Component props.
 * @param props.text - The question, or what looks wrong.
 * @param props.onFix - Applies the suggested times; omit when there's no fix to offer.
 * @param props.fixLabel - Button wording (defaults to "Use that").
 * @returns The note.
 */
export function TimeCheckNote({
  text,
  onFix,
  fixLabel = "Use that",
}: {
  text: string;
  onFix?: () => void;
  fixLabel?: string;
}): React.ReactElement {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 text-sm text-amber-800">
      <span>{text}</span>
      {onFix && (
        <button
          type="button"
          onClick={onFix}
          className="min-h-8 font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
        >
          {fixLabel}
        </button>
      )}
    </p>
  );
}
