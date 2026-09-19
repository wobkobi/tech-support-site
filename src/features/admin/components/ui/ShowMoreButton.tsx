"use client";
// src/features/admin/components/ui/ShowMoreButton.tsx
// Full-width "Show N more" control at the foot of a list capped by useShowMore. Renders
// nothing once every row is showing.

import type { UseShowMore } from "@/features/admin/hooks/use-show-more";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { AdminButton } from "./AdminButton";

/** Props for {@link ShowMoreButton}. */
interface ShowMoreButtonProps {
  /** The list's show-more state. */
  pager: Pick<UseShowMore<unknown>, "remaining" | "nextBatch" | "showMore">;
  /** What a row is, singular then plural, e.g. ["entry", "entries"]. */
  noun: readonly [one: string, other: string];
  className?: string;
}

/**
 * Reveals the next batch of a capped list and says how many are left.
 * @param props - Component props.
 * @param props.pager - The list's show-more state.
 * @param props.noun - What a row is, singular then plural.
 * @param props.className - Extra classes.
 * @returns The button, or null when nothing is hidden.
 */
export function ShowMoreButton({
  pager,
  noun,
  className,
}: ShowMoreButtonProps): React.ReactElement | null {
  if (pager.remaining === 0) return null;
  return (
    <AdminButton variant="secondary" onClick={pager.showMore} className={cn("w-full", className)}>
      Show {pager.nextBatch} more {pager.nextBatch === 1 ? noun[0] : noun[1]}
      {pager.remaining > pager.nextBatch && (
        <span className="font-normal text-admin-muted">({pager.remaining} not shown)</span>
      )}
    </AdminButton>
  );
}
