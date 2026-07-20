// src/features/reviews/components/Reviews.tsx
/**
 * @description Reviews module with responsive rows (1-3 items) or marquee scroll (4+ items).
 */

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import React from "react";

/** Character limit for truncating long reviews before CSS line-clamp takes over. */
const REVIEW_CHAR_LIMIT = 280;

/**
 * Normalises whitespace: trims edges and collapses internal newlines/spaces to single spaces.
 * @param text - Text to normalise.
 * @returns Normalised text.
 */
function normaliseText(text: string): string {
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
  const normalisedText = normaliseText(text);

  if (!isLongReview(normalisedText)) {
    return <span className="inline wrap-break-word whitespace-normal">{normalisedText}</span>;
  }

  const preview = normalisedText.slice(0, REVIEW_CHAR_LIMIT);
  const wordSafe = preview.replace(/\s+\S*$/, "");
  const base = (wordSafe.trim().length > 0 ? wordSafe : preview).trim();

  return <span className="inline wrap-break-word whitespace-normal">{base + "…"}</span>;
}

/**
 * ReviewCard component: renders a single review card that links to the reviews page.
 * @param props - Component props.
 * @param props.r - The review item.
 * @param props.className - Additional class names for the card.
 * @param props.style - Optional inline styles for the card.
 * @param [props.decorative] - True for the duplicated marquee copy: hidden from
 * assistive tech and removed from the tab order so each review is announced once.
 * @returns A list item card linking to the reviews page.
 */
function ReviewCard({
  r,
  className,
  style,
  decorative = false,
}: {
  r: ReviewItem;
  className: string;
  style?: React.CSSProperties;
  decorative?: boolean;
}): React.ReactElement {
  return (
    <li
      className={cn("cursor-pointer", className)}
      style={style}
      aria-hidden={decorative || undefined}
    >
      <Link
        href={`/reviews#review-${r.id}`}
        scroll={false}
        tabIndex={decorative ? -1 : undefined}
        className="flex h-full flex-col p-4 text-inherit no-underline sm:p-5"
      >
        <p className="line-clamp-4">
          <ReviewText text={r.text} />
        </p>
        {/* mt-auto pins the name to the bottom of the card. Without it the name
            trails the text, so cards in a row (equal height, unequal text)
            end up with their names at different heights. */}
        <p className="mt-auto pt-3 text-right text-sm font-semibold text-russian-violet sm:text-base">
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
 * 1-3 items render as centred wrapped cards. 4+ items use marquee.
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

  // Marquee when more than three reviews
  if (items.length > 3) {
    const track = [...items, ...items];
    return (
      // Full-width (no max-w cap) so the carousel edges line up with the
      // full-width content column above rather than sitting in a narrower box.
      <section aria-labelledby="reviews-section" className="w-full">
        <h2
          id="reviews-section"
          className="mb-2 text-center text-xl font-bold text-russian-violet sm:text-2xl"
        >
          What People Say
        </h2>

        <div
          className={cn(
            // Sit within the FrostedSection padding so the carousel's edges line up
            // with the content column above (hero, cards) instead of bleeding wider.
            "relative w-full overflow-hidden rounded-xl",
            // Dissolve cards near the left/right edges instead of hard-clipping them.
            "marquee-fade",
          )}
        >
          <ul className="marquee-track animate-marquee flex w-max gap-3">
            {track.map((r, i) => (
              <ReviewCard
                key={`${r.name}-${i}`}
                r={r}
                decorative={i >= items.length}
                className={cn(
                  cardBase,
                  "w-[min(26rem,calc(100vw-3rem))] shrink-0 sm:w-md",
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
    <section aria-labelledby="reviews-section" className="mx-auto w-full max-w-6xl">
      <h2
        id="reviews-section"
        className="mb-2 text-center text-xl font-bold text-russian-violet sm:text-2xl"
      >
        What People Say
      </h2>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {items.map((r, i) => (
          <ReviewCard key={`${r.name}-${i}`} r={r} className={cn(cardBase, "w-full shadow-sm")} />
        ))}
      </ul>
    </section>
  );
}
