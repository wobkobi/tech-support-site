// src/features/reviews/components/Reviews.tsx
/**
 * @file Reviews.tsx
 * @description Reviews module with responsive rows (1-3 items) or marquee scroll (4+ items).
 */

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import React from "react";

/** Character limit for truncating long reviews before CSS line-clamp takes over. */
const REVIEW_CHAR_LIMIT = 280;

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
 * ReviewText component: displays truncated text with ellipsis for long reviews.
 * @param props - Component props.
 * @param props.text - The review text to display.
 * @returns A span element with the review text.
 */
function ReviewText({ text }: { text: string }): React.ReactElement {
  const normalizedText = normalizeText(text);

  if (!isLongReview(normalizedText)) {
    return <span className={cn("wrap-break-word inline whitespace-normal")}>{normalizedText}</span>;
  }

  const preview = normalizedText.slice(0, REVIEW_CHAR_LIMIT);
  const wordSafe = preview.replace(/\s+\S*$/, "");
  const base = (wordSafe.trim().length > 0 ? wordSafe : preview).trim();

  return <span className={cn("wrap-break-word inline whitespace-normal")}>{base + "…"}</span>;
}

/**
 * ReviewCard component: renders a single review card that links to the reviews page.
 * @param props - Component props.
 * @param props.r - The review item.
 * @param props.className - Additional class names for the card.
 * @param props.style - Optional inline styles for the card.
 * @returns A list item card linking to the reviews page.
 */
function ReviewCard({
  r,
  className,
  style,
}: {
  r: ReviewItem;
  className: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <li className={cn("cursor-pointer", className)} style={style}>
      <Link
        href={`/reviews#review-${r.id}`}
        scroll={false}
        className={cn("flex h-full flex-col p-4 text-inherit no-underline sm:p-5")}
      >
        <p className={cn("line-clamp-4")}>
          <ReviewText text={r.text} />
        </p>
        <p className={cn("text-russian-violet pt-3 text-right text-sm font-semibold sm:text-base")}>
          - {r.name}
        </p>
      </Link>
    </li>
  );
}

export interface ReviewItem {
  id: string;
  text: string;
  name: string;
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
  if (!items.length) return null;

  const cardBase = cn(
    "bg-seasalt-800/80 flex flex-col rounded-lg border-2",
    "border-seasalt-400/60 hover:border-coquelicot-500/60 transition-colors",
  );

  const marqueeCardBase = cn(
    "bg-seasalt-800/80 flex flex-col rounded-lg border-2",
    "border-seasalt-400/60 hover:border-coquelicot-500/60 transition-colors",
  );

  // Marquee when more than three reviews
  if (items.length > 3) {
    const track = [...items, ...items];
    return (
      <section aria-labelledby="reviews-section" className={cn("mx-auto w-full max-w-6xl")}>
        <h2
          id="reviews-section"
          className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
        >
          What People Say
        </h2>

        <div
          className={cn(
            "relative -mx-4 w-[calc(100%+2rem)] overflow-hidden rounded-xl sm:-mx-8 sm:w-[calc(100%+4rem)]",
          )}
        >
          <ul className={cn("marquee-track animate-marquee flex w-max gap-3")}>
            {track.map((r, i) => (
              <ReviewCard
                key={`${r.name}-${i}`}
                r={r}
                className={cn(
                  marqueeCardBase,
                  "sm:w-md w-[min(26rem,calc(100vw-3rem))] shrink-0",
                  i < items.length && "animate-fade-in animate-fill-both",
                )}
                style={i < items.length ? { animationDelay: `${i * 150}ms` } : undefined}
              />
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // 1-3 items: grid layout
  return (
    <section aria-labelledby="reviews-section" className={cn("mx-auto w-full max-w-6xl")}>
      <h2
        id="reviews-section"
        className={cn("text-rich-black mb-2 text-center text-xl font-semibold sm:text-2xl")}
      >
        What People Say
      </h2>

      <ul className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3")}>
        {items.map((r, i) => (
          <ReviewCard key={`${r.name}-${i}`} r={r} className={cn(cardBase, "w-full shadow-sm")} />
        ))}
      </ul>
    </section>
  );
}
