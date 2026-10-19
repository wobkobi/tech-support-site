// src/features/reviews/lib/gridColumns.ts
// Splits newest-first reviews into two balanced masonry columns for the reviews page.

/**
 * Estimate a review card's relative height: wrapped text plus fixed per-card overhead.
 * Constants are tuned to the 2-column card width from `sm` up.
 * @param text - Whitespace-collapsed review text.
 * @returns Estimated relative card height.
 */
function estimateCardHeight(text: string): number {
  const charsPerLine = 65;
  const overheadLines = 4;
  return overheadLines + Math.ceil(text.length / charsPerLine);
}

/** A review tagged with its position in the original date order. */
interface OrderedReview<T> {
  /** The review payload. */
  review: T;
  /** Zero-based index in the newest-first order, used as the CSS `order` on mobile. */
  order: number;
}

/** Two balanced masonry columns, each already in newest-first order. */
export interface ReviewColumns<T> {
  /** Left column reviews. */
  left: OrderedReview<T>[];
  /** Right column reviews. */
  right: OrderedReview<T>[];
}

/**
 * Deal newest-first reviews into whichever column is shorter. Each keeps its date index
 * so mobile can restore one newest-first list via CSS `order`.
 * @param reviews - Reviews already sorted newest-first.
 * @returns The reviews split into a left and right column.
 */
export function splitReviewsIntoColumns<T extends { text: string }>(
  reviews: T[],
): ReviewColumns<T> {
  const left: OrderedReview<T>[] = [];
  const right: OrderedReview<T>[] = [];
  let leftHeight = 0;
  let rightHeight = 0;
  reviews.forEach((review, order) => {
    const height = estimateCardHeight(review.text);
    if (leftHeight <= rightHeight) {
      left.push({ review, order });
      leftHeight += height;
    } else {
      right.push({ review, order });
      rightHeight += height;
    }
  });
  return { left, right };
}
