// src/features/business/components/calculator/SectionClearButton.tsx
// Per-card "Clear" link for the calculator's section headers.

import type React from "react";

interface Props {
  /** Empties this card's fields. */
  onClear: () => void;
  /** Card name for the screen-reader label, e.g. "tasks" > "Clear tasks". */
  label: string;
}

/**
 * Small "Clear" for a calculator card header. Wipes one card only, so it needs no
 * confirm step.
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
      className="shrink-0 text-sm font-medium text-admin-muted underline underline-offset-2 hover:text-coquelicot-700"
    >
      Clear
    </button>
  );
}
