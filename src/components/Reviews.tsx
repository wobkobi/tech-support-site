"use client";

// src/components/Reviews.tsx
/**
 * @file Reviews.tsx
 * @description Reviews module with responsive rows (1-3 items) or marquee scroll (4+ items).
 */

import { cn } from "@/lib/cn";
import React, { useState } from "react";

/** Character limit for truncating long reviews. */
const REVIEW_CHAR_LIMIT = 150;

/**
 * Returns true when a review exceeds the truncation limit.
 * @param text - Review text to check.
 * @returns Whether the text is long enough to truncate.
 */
function isLongReview(text: string): boolean {
  return text.length > REVIEW_CHAR_LIMIT;
}

/**
 * ReviewText component: truncates long text and allows expand/collapse on click.
 * @param props - Component props.
 * @param props.text - The review text to display.
 * @returns A span element with the review text, expandable on click.
 */
function ReviewText({ text }: { text: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  if (!isLongReview(text)) {
    return <span>{text}</span>;
  }

  // Truncate at the last space before the limit to avoid orphaned "…"
  const preview = text.slice(0, REVIEW_CHAR_LIMIT);
  const wordSafe = preview.replace(/\s+\S*$/, "");
  const base = wordSafe.trim().length > 0 ? wordSafe : preview;
  const truncated = base + "…";

  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse review" : "Expand review"}
      className={cn("cursor-pointer")}
      title={expanded ? "Click to collapse" : "Click to read more"}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      {expanded ? text : truncated}
    </span>
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
 * Build display name like "A. Bcdef." or "Anonymous".
 * Uses first/last unless r.isAnonymous is true.
 * @param r - Review item to format.
 * @returns Formatted display name.
 */
function formatName(r: ReviewItem): string {
  if (r.isAnonymous) return "Anonymous";
  const f = (r.firstName ?? "").trim();
  const l = (r.lastName ?? "").trim();
  if (!f && !l) return "Anonymous";
  const initial = f ? `${f[0].toUpperCase()}. ` : "";
  const last = l ? `${l[0].toUpperCase()}${l.slice(1).toLowerCase()}` : "";
  const out = `${initial}${last}`.trim();
  return out ? `${out}.` : "Anonymous";
}

/**
 * Reviews section content. No outer frosted wrapper.
 * 1-3 items render as centered wrapped cards. 4+ items use marquee.
 * @param props - Component props.
 * @param [props.items] - Reviews to render.
 * @returns The reviews section, or null if empty.
 */
export default function Reviews({ items = [] }: ReviewsProps): React.ReactElement | null {
  if (!items.length) return null;

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
              <li
                key={`${formatName(r)}-${i}`}
                className={cn(
                  "bg-seasalt-800/80 w-90 sm:w-95 flex shrink-0 flex-col rounded-lg border-2 p-4 transition-colors duration-300 sm:p-5",
                  isLongReview(r.text)
                    ? "border-seasalt-400/60 hover:border-coquelicot-500/60"
                    : "border-seasalt-400/60",
                )}
              >
                <ReviewText text={r.text} />
                <p
                  className={cn(
                    "text-russian-violet mt-auto pt-3 text-right text-xs font-semibold sm:text-sm",
                  )}
                >
                  - {formatName(r)}
                </p>
              </li>
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
          // rows
          "flex flex-wrap justify-center gap-3",
          // prevent odd spacing due to rounding
          "content-start",
        )}
      >
        {items.map((r, i) => (
          <li
            key={`${formatName(r)}-${i}`}
            className={cn(
              // width rules per breakpoint:
              // full width on mobile, two-up on sm, three-up on md+. Centering comes from justify-center.
              "w-full sm:w-[calc(50%-0.375rem)] md:w-[calc(33.333%-0.5rem)]",
              // card styles
              "bg-seasalt-800 flex flex-col rounded-lg border-2 p-4 shadow-sm transition-colors duration-300 sm:p-5",
              isLongReview(r.text)
                ? "border-seasalt-400/60 hover:border-coquelicot-500/60"
                : "border-seasalt-400/60",
            )}
          >
            <ReviewText text={r.text} />
            <p
              className={cn(
                "text-russian-violet mt-auto pt-3 text-right text-xs font-semibold sm:text-sm",
              )}
            >
              - {formatName(r)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
