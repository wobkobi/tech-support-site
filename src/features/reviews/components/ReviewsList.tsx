"use client";
// src/features/reviews/components/ReviewsList.tsx
// Public reviews grid. Reveals a batch at a time rather than rendering every approved
// review at once, with each review's date and name.

import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { splitReviewsIntoColumns } from "@/features/reviews/lib/gridColumns";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useState, useSyncExternalStore } from "react";

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
 * Reviews longer than this clamp to six lines on phones behind a "Read more"
 * toggle. It is about eight lines at phone width, so whenever the button shows,
 * the clamp is hiding some of the text.
 */
const CLAMP_CHARS = 320;

/**
 * Subscribes to URL hash changes.
 * @param onChange - Called when the hash changes.
 * @returns Unsubscribe function.
 */
function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Current URL hash, including the leading "#".
 * @returns The hash, or an empty string.
 */
function readHash(): string {
  return window.location.hash;
}

/**
 * Two-column masonry list of reviews with progressive reveal.
 * @param props - Component props.
 * @param props.reviews - All approved reviews, newest first.
 * @returns The reviews grid.
 */
export function ReviewsList({ reviews }: { reviews: PublicReview[] }): React.ReactElement {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // A home page review card links to /reviews#review-<id> so its full text can be
  // read; that review is never clamped.
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => "");

  const visible = reviews.slice(0, visibleCount);
  const remaining = reviews.length - visible.length;
  // Balance only what's on screen, so the two columns stay even at every step.
  const columns = splitReviewsIntoColumns(visible);

  /**
   * Opens or re-clamps one review.
   * @param id - Review id.
   */
  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Two balanced masonry columns (see splitReviewsIntoColumns). On mobile both
          <ul>s collapse via display:contents into one flex column, where the CSS
          `order` (date index) restores a single newest-first list. */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {[columns.left, columns.right].map((column, columnIndex) => (
          <ul key={columnIndex} className="contents sm:flex sm:flex-1 sm:flex-col sm:gap-6">
            {column.map(({ review: r, order }) => {
              const clampable = r.text.length > CLAMP_CHARS && hash !== `#review-${r.id}`;
              const open = expanded.has(r.id);
              const textId = `review-text-${r.id}`;
              return (
                <li
                  key={r.id}
                  id={`review-${r.id}`}
                  style={{ order }}
                  className="flex flex-col gap-4 rounded-lg border border-seasalt-100 bg-white p-6"
                >
                  <p
                    id={textId}
                    className={cn(
                      "text-[1.0625rem]",
                      clampable && !open && "line-clamp-6 sm:line-clamp-none",
                    )}
                  >
                    &ldquo;{r.text}&rdquo;
                  </p>
                  {clampable && (
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={textId}
                      onClick={() => toggle(r.id)}
                      className="-mt-4 inline-flex min-h-11 items-center self-start text-base font-bold text-coquelicot-700 underline underline-offset-4 hover:text-coquelicot-800 sm:hidden"
                    >
                      {open ? "Show less" : "Read more"}
                    </button>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold">{formatReviewerName(r)}</span>
                    <span className="text-sm text-seasalt-700">{formatDateShort(r.createdAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      {remaining > 0 && (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisibleCount((n) => n + BATCH_SIZE)}
          >
            Show {Math.min(remaining, BATCH_SIZE)} more
          </Button>
        </div>
      )}
    </>
  );
}
