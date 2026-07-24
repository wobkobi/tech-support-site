"use client";
// src/features/reviews/components/ReviewsList.tsx
/**
 * @description Public reviews grid. Reveals a batch at a time rather than
 * rendering every approved review at once, with each review's date and name.
 */

import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { splitReviewsIntoColumns } from "@/features/reviews/lib/gridColumns";
import { Button } from "@/shared/components/Button";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

/** One approved review as rendered publicly. Dates arrive as ISO strings. */
export interface PublicReview {
  id: string;
  text: string;
  firstName: string | null;
  lastName: string | null;
  isAnonymous: boolean;
  /** ISO timestamp - Date objects can't cross the server > client boundary. */
  createdAt: string;
}

/** How many reviews are shown before the first "Show more". */
const BATCH_SIZE = 20;

/**
 * Two-column masonry list of reviews with progressive reveal.
 * @param props - Component props.
 * @param props.reviews - All approved reviews, newest first.
 * @returns The reviews grid.
 */
export function ReviewsList({ reviews }: { reviews: PublicReview[] }): React.ReactElement {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  const visible = reviews.slice(0, visibleCount);
  const remaining = reviews.length - visible.length;
  // Balance only what's on screen, so the two columns stay even at every step.
  const columns = splitReviewsIntoColumns(visible);

  return (
    <>
      {/* Two balanced masonry columns (see splitReviewsIntoColumns). On mobile both
          <ul>s collapse via display:contents into one flex column, where the CSS
          `order` (date index) restores a single newest-first list. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {[columns.left, columns.right].map((column, columnIndex) => (
          <ul key={columnIndex} className="contents sm:flex sm:flex-1 sm:flex-col sm:gap-4">
            {column.map(({ review: r, order }) => (
              <li
                key={r.id}
                id={`review-${r.id}`}
                style={{ order }}
                className="flex flex-col rounded-lg border-2 border-seasalt-200/60 bg-white/80 p-4 sm:p-5"
              >
                <p className="text-base text-rich-black sm:text-lg">{r.text}</p>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3">
                  <span className="text-sm text-rich-black/60">{formatDateShort(r.createdAt)}</span>
                  <span className="text-base font-semibold text-russian-violet sm:text-lg">
                    - {formatReviewerName(r)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ))}
      </div>

      {remaining > 0 && (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setVisibleCount((n) => n + BATCH_SIZE)}
          >
            Show {Math.min(remaining, BATCH_SIZE)} more
          </Button>
        </div>
      )}
    </>
  );
}
