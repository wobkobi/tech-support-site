// src/features/reviews/components/admin/review-types.ts
/**
 * @file review-types.ts
 * @description Shared types and utility functions for review moderation.
 */

/**
 * A single review entry from the database.
 */
export interface ReviewRow {
  /** Review database ID */
  id: string;
  /** Review text content */
  text: string;
  /** Reviewer first name */
  firstName: string | null;
  /** Reviewer last name */
  lastName: string | null;
  /** Whether the reviewer posted anonymously */
  isAnonymous: boolean;
  /** Whether the review was verified via a booking token */
  verified?: boolean;
  /** Review moderation status */
  status: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Linked contact ID, or null if not yet matched */
  contactId: string | null;
  /** Denormalised contact display name for quick rendering, or null */
  contactName: string | null;
}

/**
 * Formats a date as a short localised string.
 * @param date - Date to format.
 * @returns Formatted date string.
 */
export function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
