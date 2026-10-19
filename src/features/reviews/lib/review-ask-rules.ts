// src/features/reviews/lib/review-ask-rules.ts
// When an invoice's automatic review ask goes out, and why not. Pure, so the job and the
// admin forecast always agree.

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

/** What the invoice send modal shows about the invoice's automatic review ask. */
export interface InvoiceReviewAskInfo {
  /** Days after sending the ask goes out. */
  delayDays: number;
  /** The date it's due if the invoice is sent now, e.g. "8 Oct 2026". */
  dueLabel: string;
  /** Settings reviews.reviewAskGapDays, for the "at most once every" wording. */
  gapDays: number;
  /** The skip that will apply on the due date if nothing changes, or null when it sends. */
  skip: ReviewAskSkipReason | null;
  /** `asked_recently` only: the blocking ask; `queued` when it is another invoice's ask due first. */
  blockingAsk: { label: string; queued: boolean } | null;
}

/** The invoice fields the clock reads. */
export interface ReviewAskClockFields {
  status: string;
  sentAt: Date | null;
  paidAt: Date | null;
}

/**
 * When the review-ask clock starts: the invoice email, else the payment for an invoice
 * paid without ever being emailed.
 * @param invoice - Status and stamps.
 * @returns Clock start, or null when the invoice has neither (drafts, legacy rows).
 */
export function reviewAskClockStart(invoice: ReviewAskClockFields): Date | null {
  if (invoice.sentAt) return invoice.sentAt;
  if (invoice.status === "PAID" && invoice.paidAt) return invoice.paidAt;
  return null;
}

/**
 * First moment the ask may go out: NZ midnight `delayDays` calendar days after the clock
 * start. Uses the DST-safe NZ date helpers.
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
 * The invoice's address when it belongs to the contact, else the contact's primary
 * (invoices can carry a company accounts or stale address).
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
 * Decides an undecided invoice's review ask. Waiting is checked before person-level skips
 * so fixes before the due date still count; the would-be skip rides along as `forecast`.
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

/**
 * A contact's standing for a hand-sent review ask. Only the opt-outs block; `reviewed` is
 * the "post on Google too" nudge, `text_only` has a phone but no email.
 */
export type AskPersonStatus =
  | "ready"
  | "recent"
  | "reviewed"
  | "text_only"
  | "review_opt_out"
  | "mailing_opt_out"
  | "no_details";

/** What {@link askPersonStatus} reads about one contact. */
export interface AskPersonInput {
  hasEmail: boolean;
  hasPhone: boolean;
  /** Latest ask by any route: manual link, invoice, booking. */
  lastAskedAt: Date | null;
  /** A review on the site is already tied to them. */
  reviewed: boolean;
  reviewOptOut: boolean;
  mailingOptOut: boolean;
}

/**
 * Classifies one contact for the hand-sent ask list. A mailing unsubscribe only blocks
 * email, so a contact with a phone falls through to `text_only`.
 * @param input - The contact's ask state.
 * @param gapDays - Minimum days between asks from settings; 0 turns `recent` off.
 * @param now - Current instant.
 * @returns The contact's status.
 */
export function askPersonStatus(
  input: AskPersonInput,
  gapDays: number,
  now: Date,
): AskPersonStatus {
  if (input.reviewOptOut) return "review_opt_out";
  if (!input.hasEmail || input.mailingOptOut) {
    if (input.hasPhone) return "text_only";
    return input.mailingOptOut ? "mailing_opt_out" : "no_details";
  }
  if (input.reviewed) return "reviewed";
  if (
    gapDays > 0 &&
    input.lastAskedAt &&
    now.getTime() - input.lastAskedAt.getTime() < gapDays * DAY_MS
  ) {
    return "recent";
  }
  return "ready";
}
