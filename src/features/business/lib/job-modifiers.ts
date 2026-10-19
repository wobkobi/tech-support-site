// src/features/business/lib/job-modifiers.ts
// Job-wide modifiers the parse applies from facts outside the description: a booking
// made as a remote session, and a job billed to a business.

import { isChannelModifier } from "@/features/business/lib/business";

/** Rate row fields the job-wide modifiers read. */
interface ModifierRow {
  id: string;
  label: string;
  hourlyDelta: number | null;
}

/** What the parse knows about the job beyond its description. */
export interface JobModifierFacts {
  /** Booked as a remote session, and the parse found no trip to the client. */
  remoteBooking: boolean;
  /** The whole job bills at the Business rate. */
  business: boolean;
}

/** One task's modifier ids after the job-wide modifiers, and what was added. */
export interface JobModifierResult {
  ids: string[];
  addedRemote: boolean;
  addedBusiness: boolean;
}

/**
 * Tests whether a rate row (or AI-emitted label) is the Business modifier, by its default label.
 * @param rate - Rate row or anything carrying its label.
 * @param rate.label - Label to match, compared trimmed and case-insensitively.
 * @returns True for the Business modifier.
 */
export function isBusinessModifier(rate: { label: string }): boolean {
  return rate.label.trim().toLowerCase() === "business";
}

/**
 * Adds the job-wide modifiers to one hourly task. Remote only fills a missing channel;
 * Business stacks on every task. A missing or renamed row adds nothing.
 * @param modifierIds - The task's resolved modifier ids.
 * @param rates - Live rate rows.
 * @param facts - What the parse knows about the job.
 * @returns The task's ids plus which modifiers were added.
 */
export function withJobModifiers(
  modifierIds: string[],
  rates: ModifierRow[],
  facts: JobModifierFacts,
): JobModifierResult {
  const ids = [...modifierIds];
  /**
   * Whether the task already carries a row matching the test.
   * @param pick - Row test.
   * @returns True when one of the task's ids is a matching row.
   */
  const has = (pick: (r: ModifierRow) => boolean): boolean =>
    rates.some((r) => pick(r) && ids.includes(r.id));
  let addedRemote = false;
  let addedBusiness = false;

  if (facts.remoteBooking && !has(isChannelModifier)) {
    const remote = rates.find(
      (r) => r.label.trim().toLowerCase() === "remote" && r.hourlyDelta !== null,
    );
    if (remote) {
      ids.push(remote.id);
      addedRemote = true;
    }
  }
  if (facts.business && !has(isBusinessModifier)) {
    const business = rates.find((r) => isBusinessModifier(r) && r.hourlyDelta !== null);
    if (business) {
      ids.push(business.id);
      addedBusiness = true;
    }
  }
  return { ids, addedRemote, addedBusiness };
}
