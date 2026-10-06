// src/features/reviews/components/Reviews.tsx
// Home page review quotes: a static grid of bordered panels, each linking to its full review.

import Link from "next/link";
import type React from "react";

/** Character limit before a review is cut at a word boundary. */
const REVIEW_CHAR_LIMIT = 280;

/** One review as the home page passes it in. */
export interface ReviewItem {
  id: string;
  text: string;
  name: string;
}

/**
 * Trim a long review at the last whole word under the limit and add an ellipsis.
 * @param text - Whitespace-normalised review text.
 * @returns The text, shortened when over the limit.
 */
function preview(text: string): string {
  if (text.length <= REVIEW_CHAR_LIMIT) return text;
  const cut = text.slice(0, REVIEW_CHAR_LIMIT);
  const wordSafe = cut.replace(/\s+\S*$/, "").trim();
  return `${wordSafe || cut.trim()}…`;
}

/**
 * Grid of review quotes: three across from md, stacked on phones.
 * @param props - Component props.
 * @param props.items - Reviews to show, newest first.
 * @returns The list element.
 */
export default function Reviews({ items }: { items: ReviewItem[] }): React.ReactElement {
  return (
    <ul className="grid gap-6 md:grid-cols-3">
      {items.map((r) => (
        <li key={r.id}>
          <figure className="flex h-full flex-col justify-between gap-4 rounded-lg border border-seasalt-100 p-6">
            <blockquote className="text-[1.0625rem]">&ldquo;{preview(r.text)}&rdquo;</blockquote>
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-bold">{r.name}</span>
              {r.text.length > REVIEW_CHAR_LIMIT && (
                <Link
                  href={`/reviews#review-${r.id}`}
                  scroll={false}
                  className="text-base font-bold text-coquelicot-700 underline underline-offset-4"
                >
                  Read more
                </Link>
              )}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
