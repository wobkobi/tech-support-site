"use client";

// src/features/reviews/components/Reviews.tsx
/**
 * @file Reviews.tsx
 * @description Reviews module with responsive rows (1-3 items) or marquee scroll (4+ items).
 */

import { cn } from "@/shared/lib/cn";
import React, { useState } from "react";
import { formatReviewerName } from "@/features/reviews/lib/formatting";

/** Character limit for truncating long reviews. */
const REVIEW_CHAR_LIMIT = 150;

/**
 * Normalizes whitespace: trims edges and collapses internal newlines/spaces to single spaces.
 * @param text - Text to normalize.
 * @returns Normalized text.
 */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Returns true when a review exceeds the truncation limit.
 * @param text - Review text to check.
 * @returns Whether the text is long enough to truncate.
 */
function isLongReview(text: string): boolean {
  return text.length > REVIEW_CHAR_LIMIT;
}

/**
 * ReviewText component: displays full or truncated text based on expanded state.
 * @param props - Component props.
 * @param props.text - The review text to display.
 * @param props.expanded - Whether to show the full text.
 * @returns A span element with the review text.
 */
function ReviewText({ text, expanded }: { text: string; expanded: boolean }): React.ReactElement {
  // Normalize whitespace: trim edges and collapse internal newlines/spaces to single spaces
  const normalizedText = normalizeText(text);

  if (!isLongReview(normalizedText)) {
    return <span className="wrap-break-word inline whitespace-normal">{normalizedText}</span>;
  }

  // Truncate at the last space before the limit to avoid orphaned "…"
  const preview = normalizedText.slice(0, REVIEW_CHAR_LIMIT);
  const wordSafe = preview.replace(/\s+\S*$/, "");
  const base = wordSafe.trim().length > 0 ? wordSafe : preview;
  const truncated = base + "…";

  return (
    <span className="wrap-break-word inline whitespace-normal">
      {expanded ? normalizedText : truncated}
    </span>
  );
}

/**
 * ReviewCard component: wraps a single review card with expand/collapse on click.
 * @param props - Component props.
 * @param props.r - The review item.
 * @param props.className - Additional class names for the card.
 * @param props.expanded - Whether all reviews are expanded.
 * @param props.onToggle - Callback to toggle expanded state.
 * @returns A list item card with expandable review text.
 */
function ReviewCard({
  r,
  className,
  expanded,
  onToggle,
}: {
  r: ReviewItem;
  className: string;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  // Normalize text the same way ReviewText does to ensure consistent length check
  const normalizedText = normalizeText(r.text);
  const long = isLongReview(normalizedText);

  const name = (
    <p
      className={cn("text-russian-violet mt-auto pt-3 text-right text-xs font-semibold sm:text-sm")}
    >
      - {formatReviewerName(r)}
    </p>
  );

  if (long) {
    return (
      <li className={cn(className)}>
        <button
          type="button"
          className="flex w-full flex-1 cursor-pointer flex-col overflow-hidden bg-transparent p-0 text-left transition-all duration-300 ease-in-out"
          style={{
            maxHeight: expanded ? "1000px" : "300px",
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse review" : "Expand review"}
          title={expanded ? "Click to collapse" : "Click to read more"}
          onClick={onToggle}
        >
          <ReviewText text={r.text} expanded={expanded} />
          {name}
        </button>
      </li>
    );
  }

  return (
    <li className={cn(className)}>
      <ReviewText text={r.text} expanded={expanded} />
      {name}
    </li>
  );
}

export interface ReviewItem {
  text: string;
  firstName?: string | null;
  lastName?: string | null;
  isAnonymous?: boolean | null;
}

export interface ReviewsProps {
  /** List of reviews to display. */
  items?: ReviewItem[];
}

/**
 * Reviews section content. No outer frosted wrapper.
 * 1-3 items render as centered wrapped cards. 4+ items use marquee.
 * @param props - Component props.
 * @param [props.items] - Reviews to render.
 * @returns The reviews section, or null if empty.
 */
export default function Reviews({ items = [] }: ReviewsProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) return null;

  /** Toggles the expanded state for all reviews. */
  function toggleAll(): void {
    setExpanded((v) => !v);
  }

  // Marquee when more than three reviews
  if (items.length > 3) {
    const track = [...items, ...items];
    return (
      <section aria-labelledby="reviews" className={cn("mx-auto w-full max-w-5xl")}>
        <h2
          id="reviews"
          className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
        >
          What People Say
        </h2>

        <div className={cn("relative w-full overflow-hidden rounded-lg bg-transparent p-0")}>
          <ul className={cn("marquee-track animate-marquee flex w-max gap-3")}>
            {track.map((r, i) => (
              <ReviewCard
                key={`${formatReviewerName(r)}-${i}`}
                r={r}
                expanded={expanded}
                onToggle={toggleAll}
                className={cn(
                  "bg-seasalt-800/80 sm:w-95 flex w-[min(22.5rem,calc(100vw-3rem))] shrink-0 flex-col rounded-lg border-2 p-4 transition-colors duration-300 sm:p-5",
                  isLongReview(normalizeText(r.text))
                    ? "border-seasalt-400/60 hover:border-coquelicot-500/60"
                    : "border-seasalt-400/60",
                )}
              />
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // 1-3 items: center last row at all breakpoints using flex-wrap + justify-center
  return (
    <section aria-labelledby="reviews" className={cn("mx-auto w-full max-w-5xl")}>
      <h2
        id="reviews"
        className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
      >
        What People Say
      </h2>

      <ul
        className={cn(
          // grid layout for equal-height cards
          "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3",
        )}
      >
        {items.map((r, i) => (
          <ReviewCard
            key={`${formatReviewerName(r)}-${i}`}
            r={r}
            expanded={expanded}
            onToggle={toggleAll}
            className={cn(
              "w-full",
              "bg-seasalt-800 flex flex-col rounded-lg border-2 p-4 shadow-sm transition-colors duration-300 sm:p-5",
              isLongReview(normalizeText(r.text))
                ? "border-seasalt-400/60 hover:border-coquelicot-500/60"
                : "border-seasalt-400/60",
            )}
          />
        ))}
      </ul>
    </section>
  );
}
