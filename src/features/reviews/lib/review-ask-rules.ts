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

/**
 * When review asks started leading with Google (PR #348 went live). An ask by any route
 * on or after this is the person's Google ask; earlier asks led with the site form.
 */
export const GOOGLE_ASKS_FROM = new Date("2026-10-06T10:29:13Z");

/**
 * Whether a person's latest ask was a Google-first one.
 * @param askedAt - Latest ask by any route, or null.
 * @returns True when they have already had their Google ask.
 */
export function hadGoogleAsk(askedAt: Date | null): boolean {
  return !!askedAt && askedAt >= GOOGLE_ASKS_FROM;
}

/** Why the job stamped an invoice `skipped` (stored in Invoice.reviewAskNote). */
export type ReviewAskSkipReason =
  | "voided"
  | "unsuccessful"
  | "no_contact"
  | "no_email"
  | "review_opt_out"
  | "mailing_opt_out"
  | "google_asked"
  | "asked_recently"
  | "before_auto"
  | "cancellation_fee";

/** Notes on a `cancelled` or `failed` invoice that aren't free-text error messages. */
export type ReviewAskOtherNote = "unticked" | "skipped_in_admin" | "interrupted";

/** Plain-English text for every coded note, shown in admin. */
export const REVIEW_ASK_NOTE_LABELS: Record<ReviewAskSkipReason | ReviewAskOtherNote, string> = {
  voided: "invoice was voided",
  unsuccessful: "the job couldn't be fixed",
  no_contact: "not in your contacts",
  no_email: "no email address",
  review_opt_out: "they asked not to get review asks",
  mailing_opt_out: "they unsubscribed from your emails",
  google_asked: "they've already had their Google review ask",
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
  /** Days after payment the ask goes out. */
  delayDays: number;
  /** The date it's due if the invoice is sent now, e.g. "8 Oct 2026"; null while unpaid. */
  dueLabel: string | null;
  /** Settings reviews.reviewAskGapDays, for the "at most once every" wording. */
  gapDays: number;
  /** The skip that will apply on the due date if nothing changes, or null when it sends. */
  skip: ReviewAskSkipReason | null;
  /**
   * `asked_recently` and `google_asked` only: the blocking ask; `queued` when it is another
   * invoice's ask due first.
   */
  blockingAsk: { label: string; queued: boolean } | null;
}

/** The invoice fields the clock reads. */
export interface ReviewAskClockFields {
  status: string;
  sentAt: Date | null;
  paidAt: Date | null;
}

/**
 * When the review-ask clock starts: once the invoice is paid, from the later of the
 * payment and the invoice email (paid on the day, emailed that evening). Asking before
 * payment can land a "please review" ahead of an overdue reminder.
 * @param invoice - Status and stamps.
 * @returns Clock start, or null when unpaid or the paid row has neither stamp.
 */
export function reviewAskClockStart(invoice: ReviewAskClockFields): Date | null {
  if (invoice.status !== "PAID") return null;
  const stamps = [invoice.sentAt, invoice.paidAt].filter((d): d is Date => !!d);
  return stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
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
 * (invoices can carry a company accounts or stale address). A contact with no address on
 * file has nothing to prefer, so the invoice's address is used as is.
 * @param clientEmail - Invoice.clientEmail.
 * @param contact - The resolved contact.
 * @returns Normalised address, or null when neither the invoice nor the contact has one.
 */
export function pickReviewAskAddress(
  clientEmail: string | null | undefined,
  contact: ReviewAskContactAddresses,
): string | null {
  const invoiceAddress = normaliseEmail(clientEmail);
  const addresses = contactAddresses(contact);
  if (invoiceAddress && (addresses.length === 0 || addresses.includes(invoiceAddress))) {
    return invoiceAddress;
  }
  return normaliseEmail(contact.email) || null;
}

/** What {@link jobWhollyFailed} reads off an invoice. */
export interface FailedJobFields {
  unsuccessful: boolean;
  unsuccessfulDiscount: number | null;
  promoDiscount: number | null;
  goldCardDiscount: number | null;
  lineItems: { description: string; lineTotal: number; minutes?: number | null }[];
}

// Flat rows that are never labour, for invoices issued before lines carried minutes.
const NOT_LABOUR = /travel|parking|toll|parts?\b|surcharge/i;

/**
 * Whether the whole job failed, not just a task on it. Invoice.unsuccessful is set by any
 * not-fixed task, so compare the discount with the labour: it takes (1 - factor) of the
 * failed labour after promo and Gold Card, and reaches that share of ALL labour only when
 * every hourly task failed. 5c of slack covers rounding.
 * @param inv - The invoice's discount fields and lines.
 * @param factor - Share still charged on failed work (settings unsuccessfulWorkFactor).
 * @returns True when nothing on the job could be fixed.
 */
export function jobWhollyFailed(inv: FailedJobFields, factor: number): boolean {
  if (!inv.unsuccessful || !inv.unsuccessfulDiscount) return false;
  const timed = inv.lineItems.filter((l) => (l.minutes ?? 0) > 0);
  const labourLines = timed.length
    ? timed
    : inv.lineItems.filter((l) => !NOT_LABOUR.test(l.description));
  const labour = labourLines.reduce((s, l) => s + l.lineTotal, 0);
  const due = labour - (inv.promoDiscount ?? 0) - (inv.goldCardDiscount ?? 0);
  if (due <= 0) return true;
  return inv.unsuccessfulDiscount >= due * (1 - factor) - 0.05;
}

/** Everything {@link decideReviewAsk} needs, gathered by the loader. */
export interface ReviewAskInput {
  status: string;
  /** From {@link reviewAskClockStart}; null while the invoice is unpaid. */
  clockStart: Date | null;
  /** From {@link jobWhollyFailed}: nothing on the job could be fixed. */
  unsuccessful: boolean;
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
  /**
   * Send now: the owner's own call, so the payment wait, the one-Google-ask limit and the
   * unsuccessful-job skip don't apply. Opt-outs still do.
   */
  manual?: boolean;
}

/** What the job does with an undecided invoice right now. */
export type ReviewAskDecision =
  | {
      action: "wait";
      /** Null while the invoice is unpaid: the clock hasn't started. */
      dueAt: Date | null;
      /** The skip that would apply if nothing changes before the due date. */
      forecast: ReviewAskSkipReason | null;
    }
  | { action: "send"; dueAt: Date }
  | { action: "skip"; reason: ReviewAskSkipReason };

/**
 * The person-level skip rules, checked as of `at`.
 * @param input - Gathered invoice and contact state.
 * @param timing - Gap from settings, plus whether this is a manual send.
 * @param at - The instant to judge the gap against.
 * @returns The first rule that blocks the ask, or null.
 */
function personSkip(
  input: ReviewAskInput,
  timing: ReviewAskTiming,
  at: Date,
): ReviewAskSkipReason | null {
  if (!input.hasContact) return "no_contact";
  if (!input.address) return "no_email";
  if (input.reviewOptOut) return "review_opt_out";
  if (input.mailingOptOut) return "mailing_opt_out";
  if (!timing.manual && hadGoogleAsk(input.lastAskedAt)) return "google_asked";
  if (
    timing.gapDays > 0 &&
    input.lastAskedAt &&
    at.getTime() - input.lastAskedAt.getTime() < timing.gapDays * DAY_MS
  )
    return "asked_recently";
  return null;
}

/**
 * Decides an undecided invoice's review ask: one automatic Google ask per person, a few
 * days after they pay. Waiting is checked before person-level skips so fixes before the
 * due date still count; the would-be skip rides along as `forecast`.
 * @param input - Gathered invoice and contact state.
 * @param timing - Delay and gap from settings; `manual` for Send now.
 * @param now - Current instant.
 * @returns Wait (due date null while unpaid, plus forecast), send, or skip with the reason.
 */
export function decideReviewAsk(
  input: ReviewAskInput,
  timing: ReviewAskTiming,
  now: Date,
): ReviewAskDecision {
  if (input.status === "VOIDED") return { action: "skip", reason: "voided" };
  if (!timing.manual && input.unsuccessful) return { action: "skip", reason: "unsuccessful" };
  if (!input.clockStart && !timing.manual) {
    return { action: "wait", dueAt: null, forecast: personSkip(input, timing, now) };
  }
  const dueAt = input.clockStart ? reviewAskDueAt(input.clockStart, timing.delayDays) : now;
  if (now < dueAt) {
    return { action: "wait", dueAt, forecast: personSkip(input, timing, dueAt) };
  }
  const reason = personSkip(input, timing, now);
  return reason ? { action: "skip", reason } : { action: "send", dueAt };
}

/**
 * A contact's standing for a hand-sent review ask. Only the opt-outs block; `reviewed` is
 * the "post on Google too" nudge, `google_asked` already had a Google-first ask,
 * `text_only` has a phone but no email.
 */
export type AskPersonStatus =
  | "ready"
  | "recent"
  | "google_asked"
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
  /** A review on the site is already tied to them (`google_asked` outranks it). */
  reviewed: boolean;
  reviewOptOut: boolean;
  mailingOptOut: boolean;
}

/**
 * Classifies one contact for the hand-sent ask list. A mailing unsubscribe only blocks
 * email, so a contact with a phone falls through to `text_only`. `google_asked` only
 * informs: a hand-sent ask can still go to someone who had their automatic one.
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
  if (hadGoogleAsk(input.lastAskedAt)) return "google_asked";
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
