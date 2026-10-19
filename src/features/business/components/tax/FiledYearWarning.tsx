// src/features/business/components/tax/FiledYearWarning.tsx
// Warning for the asset and trip forms naming every filed FY the record reaches. Never
// blocks the save; the Tax page lists the difference.

import {
  filedYearsTouched,
  type DateSpan,
  type FiledYearRef,
} from "@/features/business/lib/tax/snapshot";
import { Notice } from "@/shared/components/Notice";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";

/**
 * Warning Notice when an edit reaches a filed year; renders nothing otherwise.
 * @param props - Component props.
 * @param props.filedYears - Every filed year, oldest first.
 * @param props.spans - The record's saved and edited date spans.
 * @param props.variant - "edit" (default) for a form or delete confirm; "page" for a standing note on a list.
 * @param props.className - Extra classes.
 * @returns The notice, or null when no filed year is reached.
 */
export function FiledYearWarning({
  filedYears,
  spans,
  variant = "edit",
  className,
}: {
  filedYears: readonly FiledYearRef[];
  spans: readonly DateSpan[];
  variant?: "edit" | "page";
  className?: string;
}): React.ReactElement | null {
  const touched = filedYearsTouched(spans, filedYears);
  if (touched.length === 0) return null;
  // The key, not the label: the first year's label already carries "(partial)".
  const names = touched
    .map((fy) => `FY ${fy.fyKey} (filed ${formatDateShort(fy.filedAtIso)})`)
    .join(", ");
  const verb = touched.length === 1 ? "is" : "are";
  return (
    <Notice tone="warn" role="status" className={className}>
      {variant === "page" ? (
        <>
          {names} {verb} marked filed. Anything you add, edit or delete here leaves the saved
          figures as they are; the Tax page will list the difference as something an amended return
          would need.
        </>
      ) : (
        <>
          This change reaches {names}, which {verb} marked filed. The saved figures won&apos;t
          change; the Tax page will list the difference as something an amended return would need.
        </>
      )}
    </Notice>
  );
}
