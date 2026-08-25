// src/features/business/components/calculator/SectionClearButton.tsx
import type React from "react";

interface Props {
  /** Empties this card's fields. */
  onClear: () => void;
  /** Card name for the screen-reader label, e.g. "tasks" > "Clear tasks". */
  label: string;
}

/**
 * Small "Clear" affordance for a calculator card header. Wipes one card and
 * nothing else, and leaves the saved draft in place - so unlike the toolbar's
 * full clear it needs no confirm step to stay recoverable.
 * @param props - Component props.
 * @param props.onClear - Empties this card's fields.
 * @param props.label - Card name used in the screen-reader label.
 * @returns Clear button element.
 */
export function SectionClearButton({ onClear, label }: Props): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label}`}
      className="shrink-0 text-xs font-medium text-slate-500 underline hover:text-red-600"
    >
      Clear
    </button>
  );
}
