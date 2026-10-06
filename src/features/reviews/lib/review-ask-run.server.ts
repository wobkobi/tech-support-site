// src/features/reviews/lib/review-ask-run.server.ts
// Sends the review asks that are due and stamps every decision on its invoice. Run by
// the daily cron and by the admin "Send now" button. Each send claims its invoice first
// (outcome "sending"), so the cron and a Send now press can't both email the same
// person, and a run that dies mid-send is recovered as "failed" an hour later instead of
// sitting in "sending" for ever.

import { ensureContactReviewToken } from "@/features/business/lib/contact-review-token";
import { invoiceRecipient } from "@/features/business/lib/invoice-recipient";
import { sendReviewAsk } from "@/features/reviews/lib/email-review-ask";
import {
  loadReviewAskCandidates,
  type ReviewAskCandidate,
} from "@/features/reviews/lib/review-ask-queue.server";
import {
  contactAddresses,
  type ReviewAskSkipReason,
} from "@/features/reviews/lib/review-ask-rules";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A claim older than this belongs to a run that died mid-send. */
const STUCK_AFTER_MS = 60 * 60 * 1000;

/** Counts from one run. */
export interface ReviewAskRunResult {
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
  errors: string[];
  /** Set when the run did nothing: automatic asks are off, or email isn't set up. */
  stopped?: "disabled" | "not_configured";
  /** Send now only: why the one invoice wasn't sent. */
  blockedBy?: ReviewAskSkipReason | "not_due" | "already_decided";
}

/** Options for {@link runReviewAsks}. */
export interface ReviewAskRunOptions {
  /** Only this invoice (local testing, Send now). */
  onlyInvoiceId?: string;
  /**
   * Send now: send whatever the delay and the gap say, and even with automatic asks
   * switched off. Opt-outs still apply, and a person-level skip is reported back
   * rather than stamped, so the operator can fix it (add the contact) and press again.
   */
  force?: boolean;
}

/**
 * Sets claims left behind by a run that died mid-send to failed. The idempotency key
 * means a retry of a send that did reach Resend won't email twice.
 * @param now - Current instant.
 */
async function recoverStuckClaims(now: Date): Promise<void> {
  const { count } = await prisma.invoice.updateMany({
    where: {
      reviewAskOutcome: "sending",
      reviewAskDecidedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    },
    data: { reviewAskOutcome: "failed", reviewAskNote: "interrupted" },
  });
  if (count > 0) console.warn(`[review-asks] recovered ${count} interrupted send(s)`);
}

/**
 * Stamps a skip on an undecided invoice. Conditional on the outcome still being open,
 * so a concurrent run's decision is never overwritten.
 * @param invoiceId - Invoice id.
 * @param reason - Skip reason.
 * @param now - Current instant.
 */
async function stampSkip(invoiceId: string, reason: ReviewAskSkipReason, now: Date): Promise<void> {
  await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      OR: [
        { reviewAskOutcome: null },
        { reviewAskOutcome: { isSet: false } },
        { reviewAskOutcome: "failed" },
      ],
    },
    data: { reviewAskOutcome: "skipped", reviewAskNote: reason, reviewAskDecidedAt: now },
  });
}

/**
 * Whether this person was asked through another invoice since the loader ran: one of
 * their other invoices is mid-send, or (unless forced) was sent inside the gap. Covers
 * the cron and Send now overlapping, and one person billed under two addresses.
 * @param candidate - The claimed candidate (has a contact).
 * @param gapDays - Minimum days between asks; ignored when forced.
 * @param force - Send now.
 * @param now - Current instant.
 * @returns True when this ask should be skipped as asked_recently.
 */
async function askedElsewhere(
  candidate: ReviewAskCandidate,
  gapDays: number,
  force: boolean,
  now: Date,
): Promise<boolean> {
  const contact = candidate.contact!;
  const addresses = contactAddresses(contact);
  const samePerson = [
    { contactId: contact.id },
    ...addresses.map((a) => ({ clientEmail: { equals: a, mode: "insensitive" as const } })),
  ];
  const sinceGap = new Date(now.getTime() - gapDays * DAY_MS);
  const other = await prisma.invoice.findFirst({
    where: {
      id: { not: candidate.invoice.id },
      AND: [
        { OR: samePerson },
        {
          OR: [
            { reviewAskOutcome: "sending" },
            ...(!force && gapDays > 0 ? [{ reviewLinkSentAt: { gte: sinceGap } }] : []),
          ],
        },
      ],
    },
    select: { id: true },
  });
  return other !== null;
}

/**
 * Claims, sends and stamps one due ask.
 * @param candidate - A candidate whose decision is "send" (or forced), with a contact
 *   and an address.
 * @param ctx - Run context.
 * @param ctx.gapDays - Minimum days between asks.
 * @param ctx.force - Send now.
 * @param ctx.now - Current instant.
 * @returns What happened.
 */
async function sendOne(
  candidate: ReviewAskCandidate,
  ctx: { gapDays: number; force: boolean; now: Date },
): Promise<"sent" | "skipped" | "failed" | "not_configured" | "lost_claim"> {
  const { invoice } = candidate;
  const contact = candidate.contact!;
  const address = candidate.address!;
  const { now } = ctx;

  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      OR: [
        { reviewAskOutcome: null },
        { reviewAskOutcome: { isSet: false } },
        { reviewAskOutcome: "failed" },
      ],
    },
    data: {
      reviewAskOutcome: "sending",
      reviewAskDecidedAt: now,
      reviewAskAttempts: invoice.attempts + 1,
    },
  });
  if (claim.count === 0) return "lost_claim";

  if (await askedElsewhere(candidate, ctx.gapDays, ctx.force, now)) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { reviewAskOutcome: "skipped", reviewAskNote: "asked_recently" },
    });
    return "skipped";
  }

  const reviewToken = contact.reviewToken ?? (await ensureContactReviewToken(contact.id));
  if (!reviewToken) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { reviewAskOutcome: "failed", reviewAskNote: "couldn't create their review link" },
    });
    return "failed";
  }

  const result = await sendReviewAsk(
    {
      to: address,
      firstName: invoiceRecipient(invoice.clientName, contact).greetingName,
      contactId: contact.id,
      reviewToken,
    },
    // One key per invoice: a retry after an interrupted run is a no-op at Resend.
    `review-ask:${invoice.id}`,
  );

  if (result === "not_configured") {
    // Nothing went out, so hand the invoice back exactly as it was.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        reviewAskOutcome: invoice.outcome,
        reviewAskAttempts: invoice.attempts,
        reviewAskDecidedAt: null,
      },
    });
    return "not_configured";
  }
  if (result === "failed") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { reviewAskOutcome: "failed", reviewAskNote: "the email didn't send" },
    });
    return "failed";
  }
  const sentAt = new Date();
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      reviewAskOutcome: "sent",
      reviewAskNote: null,
      reviewAskDecidedAt: sentAt,
      reviewLinkSentAt: sentAt,
    },
  });
  return "sent";
}

/**
 * Decides every open review ask and sends the due ones. Invoices are handled in clock
 * order, and a person asked earlier in the same run is skipped for the rest of it.
 * @param now - Current instant.
 * @param opts - Options.
 * @returns Counts, plus why a Send now didn't send.
 */
export async function runReviewAsks(
  now: Date,
  opts: ReviewAskRunOptions = {},
): Promise<ReviewAskRunResult> {
  const result: ReviewAskRunResult = { sent: 0, skipped: 0, failed: 0, waiting: 0, errors: [] };
  const force = !!opts.force;
  const { reviews } = await getSettings();
  if (!reviews.reviewAskEnabled && !force) return { ...result, stopped: "disabled" };

  await recoverStuckClaims(now);

  // Forced: due straight away, and no gap.
  const timing = force
    ? { delayDays: 0, gapDays: 0 }
    : { delayDays: reviews.reviewAskDelayDays, gapDays: reviews.reviewAskGapDays };
  const candidates = await loadReviewAskCandidates(now, timing, {
    onlyInvoiceId: opts.onlyInvoiceId,
  });
  if (force && candidates.length === 0) return { ...result, blockedBy: "already_decided" };

  const askedThisRun = new Set<string>();
  for (const candidate of candidates) {
    const { decision, invoice } = candidate;
    try {
      if (decision.action === "wait") {
        result.waiting++;
        if (force) result.blockedBy = "not_due";
        continue;
      }
      if (decision.action === "skip") {
        if (force) {
          result.blockedBy = decision.reason;
          continue;
        }
        await stampSkip(invoice.id, decision.reason, now);
        result.skipped++;
        continue;
      }

      const contactId = candidate.contact!.id;
      if (askedThisRun.has(contactId)) {
        await stampSkip(invoice.id, "asked_recently", now);
        result.skipped++;
        continue;
      }

      const outcome = await sendOne(candidate, { gapDays: timing.gapDays, force, now });
      if (outcome === "not_configured") return { ...result, stopped: "not_configured" };
      if (outcome === "lost_claim") continue;
      if (outcome === "sent") {
        askedThisRun.add(contactId);
        result.sent++;
      } else if (outcome === "skipped") {
        result.skipped++;
        if (force) result.blockedBy = "asked_recently";
      } else {
        result.failed++;
        result.errors.push(`${invoice.number}: send failed`);
      }
    } catch (error) {
      result.failed++;
      result.errors.push(`${invoice.number}: ${error instanceof Error ? error.message : "error"}`);
      console.error(`[review-asks] ${invoice.number} failed:`, error);
    }
  }
  return result;
}
