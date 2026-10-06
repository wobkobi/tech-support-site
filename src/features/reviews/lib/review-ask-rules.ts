// src/features/reviews/lib/review-ask-rules.ts
// When an invoice's automatic review ask goes out, and why it doesn't. Pure, so the
// daily job, the admin "Upcoming review asks" list and the check script all read the
// same decision: what the admin list forecasts is exactly what the job then does.

import { normaliseEmail } from "@/shared/lib/normalise-email";
import {
  addDaysToDateKey,
  dateKeyParts,
  nzDateKey,
  nzMidnightUtc,
} from "@/shared/lib/timezone-utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why the job stamped an invoice `skipped` (stored in Invoice.reviewAskNote). */
export type ReviewAskSkipReason =
  | "voided"
  | "no_contact"
  | "no_email"
  | "review_opt_out"
  | "mailing_opt_out"
  | "asked_recently"
  | "before_auto"
  | "cancellation_fee";

/** Notes on a `cancelled` or `failed` invoice that aren't free-text error messages. */
export type ReviewAskOtherNote = "unticked" | "skipped_in_admin" | "interrupted";

/** Plain-English text for every coded note, shown in admin. */
export const REVIEW_ASK_NOTE_LABELS: Record<ReviewAskSkipReason | ReviewAskOtherNote, string> = {
  voided: "invoice was voided",
  no_contact: "not in your contacts",
  no_email: "no email address",
  review_opt_out: "they asked not to get review asks",
  mailing_opt_out: "they unsubscribed from your emails",
  asked_recently: "asked recently",
  before_auto: "sent before automatic asks started",
  cancellation_fee: "cancellation fee invoice",
  unticked: "unticked when the invoice was sent",
  skipped_in_admin: "skipped by you",
  interrupted: "the send was interrupted",
};

/**
 * Admin text for a stored note: the label for a coded note, otherwise the note itself
 * (a failure message).
 * @param note - Invoice.reviewAskNote.
 * @returns Display text, or null when there is no note.
 */
export function reviewAskNoteLabel(note: string | null | undefined): string | null {
  if (!note) return null;
  return note in REVIEW_ASK_NOTE_LABELS
    ? REVIEW_ASK_NOTE_LABELS[note as keyof typeof REVIEW_ASK_NOTE_LABELS]
    : note;
}

/** The invoice fields the clock reads. */
export interface ReviewAskClockFields {
  status: string;
  sentAt: Date | null;
  paidAt: Date | null;
}

/**
 * When the review-ask clock starts: the moment the invoice was emailed. An invoice
 * marked paid without ever being emailed (cash on the day, no receipt sent) starts
 * at the payment instead, so those jobs are still asked.
 * @param invoice - Status and stamps.
 * @returns Clock start, or null when the invoice has neither (drafts, legacy rows).
 */
export function reviewAskClockStart(invoice: ReviewAskClockFields): Date | null {
  if (invoice.sentAt) return invoice.sentAt;
  if (invoice.status === "PAID" && invoice.paidAt) return invoice.paidAt;
  return null;
}

/**
 * The first moment the ask may go out: NZ midnight `delayDays` calendar days after the
 * clock start, so "2 days" means the 10am run two days later however late the invoice
 * went out. Built from the DST-safe NZ date helpers, so the changeover days in April
 * and September don't shift it by an hour.
 * @param start - Clock start from {@link reviewAskClockStart}.
 * @param delayDays - Settings reviews.reviewAskDelayDays.
 * @returns Due instant (UTC).
 */
export function reviewAskDueAt(start: Date, delayDays: number): Date {
  return nzMidnightUtc(...dateKeyParts(addDaysToDateKey(nzDateKey(start), delayDays)));
}

/** The contact fields address picking reads. */
export interface ReviewAskContactAddresses {
  email: string | null;
  altEmails: string[];
}

/**
 * Every address on file for a contact, normalised and de-duplicated.
 * @param contact - Primary and alternate emails.
 * @returns Lowercased addresses.
 */
export function contactAddresses(contact: ReviewAskContactAddresses): string[] {
  const all = [contact.email, ...contact.altEmails].map(normaliseEmail).filter(Boolean);
  return [...new Set(all)];
}

/**
 * Which address the ask goes to: the invoice's own address when it is one of the
 * contact's, otherwise the contact's primary email. An invoice can carry a company
 * accounts address or a stale one; the contact is who actually had the job done.
 * @param clientEmail - Invoice.clientEmail.
 * @param contact - The resolved contact.
 * @returns Normalised address, or null when the contact has none.
 */
export function pickReviewAskAddress(
  clientEmail: string | null | undefined,
  contact: ReviewAskContactAddresses,
): string | null {
  const invoiceAddress = normaliseEmail(clientEmail);
  if (invoiceAddress && contactAddresses(contact).includes(invoiceAddress)) return invoiceAddress;
  return normaliseEmail(contact.email) || null;
}

/** Everything {@link decideReviewAsk} needs, gathered by the loader. */
export interface ReviewAskInput {
  status: string;
  /** From {@link reviewAskClockStart}. */
  clockStart: Date;
  /** False when no live contact matches the invoice. */
  hasContact: boolean;
  /** From {@link pickReviewAskAddress}. */
  address: string | null;
  reviewOptOut: boolean;
  mailingOptOut: boolean;
  /** Latest of the three "asked for a review" stamps for this person. */
  lastAskedAt: Date | null;
}

/** The reviews settings the rules read. */
export interface ReviewAskTiming {
  delayDays: number;
  gapDays: number;
}

/** What the job does with an undecided invoice right now. */
export type ReviewAskDecision =
  | {
      action: "wait";
      dueAt: Date;
      /** The skip that would apply if nothing changes before the due date. */
      forecast: ReviewAskSkipReason | null;
    }
  | { action: "send"; dueAt: Date }
  | { action: "skip"; reason: ReviewAskSkipReason };

/**
 * The person-level skip rules, checked as of `at`.
 * @param input - Gathered invoice and contact state.
 * @param gapDays - Minimum days between asks; 0 turns the gap off.
 * @param at - The instant to judge the gap against.
 * @returns The first rule that blocks the ask, or null.
 */
function personSkip(input: ReviewAskInput, gapDays: number, at: Date): ReviewAskSkipReason | null {
  if (!input.hasContact) return "no_contact";
  if (!input.address) return "no_email";
  if (input.reviewOptOut) return "review_opt_out";
  if (input.mailingOptOut) return "mailing_opt_out";
  if (
    gapDays > 0 &&
    input.lastAskedAt &&
    at.getTime() - input.lastAskedAt.getTime() < gapDays * DAY_MS
  )
    return "asked_recently";
  return null;
}

/**
 * Decides an undecided invoice's review ask.
 *
 * Waiting is checked before the person-level skips on purpose: an invoice that isn't
 * due yet stays undecided, so adding the customer to Contacts or clearing an opt-out
 * before the due date still gets them asked. The skip that would apply is carried as
 * `forecast` so the admin list can warn ahead of time; its gap check is judged at the
 * due date, since an earlier ask may have aged out by then.
 * @param input - Gathered invoice and contact state.
 * @param timing - Delay and gap from settings.
 * @param now - Current instant.
 * @returns Wait (with due date and forecast), send, or skip with the reason.
 */
export function decideReviewAsk(
  input: ReviewAskInput,
  timing: ReviewAskTiming,
  now: Date,
): ReviewAskDecision {
  if (input.status === "VOIDED") return { action: "skip", reason: "voided" };
  const dueAt = reviewAskDueAt(input.clockStart, timing.delayDays);
  if (now < dueAt) {
    return { action: "wait", dueAt, forecast: personSkip(input, timing.gapDays, dueAt) };
  }
  const reason = personSkip(input, timing.gapDays, now);
  return reason ? { action: "skip", reason } : { action: "send", dueAt };
}
