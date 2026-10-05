// src/features/mailing/lib/send.ts
// Sends mailing-list emails. A run claims the campaign with one atomic status flip, writes
// a CampaignSend row per recipient, then sends the pending rows in batches of 100. Rows
// are the record of truth: a resumed run only sends what is still pending, a retry only
// what failed, and Resend idempotency keys cover a crash between sending and recording.
// Quiet hours hold every list send: the cron waits for morning, and a manual send or
// retry inside them is refused unless the operator chose to send anyway.

import {
  loadSharedRenderParts,
  missingSendEnv,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  type SharedRenderParts,
} from "@/features/mailing/lib/context";
import { loadRecipients } from "@/features/mailing/lib/recipients";
import { listProblems, renderCampaign, type CampaignContent } from "@/features/mailing/lib/render";
import { signUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { sendBatch, sendNow, type BatchMailPayload } from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { nextSendTime, quietHoursOf } from "@/shared/lib/quiet-hours";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Campaign } from "@prisma/client";

/** Resend's batch limit. */
const CHUNK_SIZE = 100;
/** Gap between batches, keeping a big list under Resend's requests-per-second limit. */
const CHUNK_PAUSE_MS = 600;
/** A run "sending" for longer than this died part-way, and the cron resumes it. */
const STUCK_AFTER_MS = 10 * 60_000;
/** Hard stop on the batch loop, far above any real list (100 x 50 = 5,000 people). */
const MAX_CHUNKS = 50;

/** Outcome of a send, retry or test. */
export type SendResult =
  { ok: true; sent: number; failed: number } | { ok: false; error: string; status: number };

/**
 * When a list send triggered at `at` must wait until, under the live quiet-hours window.
 * @param at - The moment to check (defaults to now).
 * @returns The end of quiet hours, or null when it may go straight away.
 */
export async function quietHoldUntil(at: Date = new Date()): Promise<Date | null> {
  const { comms } = await getSettings();
  return nextSendTime(quietHoursOf(comms), at);
}

/**
 * Splits a list into chunks.
 * @param items - Items to split.
 * @param size - Chunk size.
 * @returns The chunks, in order.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The renderable parts of a campaign row.
 * @param campaign - Campaign row.
 * @returns Subject, preheader and body.
 */
function contentOf(campaign: Campaign): CampaignContent {
  return { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body };
}

/**
 * Puts a claimed campaign back to draft when a send can't go ahead, so it
 * reappears in Drafts for the operator to fix rather than sitting in "sending".
 * @param id - Campaign id.
 */
async function releaseToDraft(id: string): Promise<void> {
  await prisma.campaign.update({
    where: { id },
    data: { status: "draft", scheduledAt: null, sendingStartedAt: null },
  });
}

/**
 * Writes one pending row per recipient, unless a previous run already did.
 * @param campaign - The claimed campaign.
 * @returns How many recipients the campaign has.
 */
async function ensureSendRows(campaign: Campaign): Promise<number> {
  const existing = await prisma.campaignSend.count({ where: { campaignId: campaign.id } });
  if (existing > 0) return existing;
  const { recipients } = await loadRecipients(campaign.excludedContactIds);
  if (recipients.length === 0) return 0;
  await prisma.campaignSend.createMany({
    data: recipients.map((r) => ({
      campaignId: campaign.id,
      contactId: r.contactId,
      email: r.email,
    })),
  });
  return recipients.length;
}

/**
 * Sends every pending row in batches and records each outcome on its row.
 * @param campaign - The claimed campaign.
 * @param parts - Shared render parts.
 */
async function deliverPending(campaign: Campaign, parts: SharedRenderParts): Promise<void> {
  const from = process.env.EMAIL_FROM!;
  const replyTo = process.env.ADMIN_EMAIL?.trim() || undefined;
  const content = contentOf(campaign);

  for (let round = 0; round < MAX_CHUNKS; round++) {
    const rows = await prisma.campaignSend.findMany({
      where: { campaignId: campaign.id, status: "pending" },
      orderBy: { id: "asc" },
      take: CHUNK_SIZE,
    });
    if (rows.length === 0) return;
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));

    const contacts = await prisma.contact.findMany({
      where: { id: { in: rows.map((r) => r.contactId) } },
      select: { id: true, name: true },
    });
    const names = new Map(contacts.map((c) => [c.id, c.name]));

    const payloads: BatchMailPayload[] = rows.map((row) => {
      const token = signUnsubscribeToken(row.contactId);
      const email = renderCampaign(
        content,
        { name: names.get(row.contactId) ?? null },
        { ...parts, unsubscribeUrl: unsubscribePageUrl(token) },
      );
      return {
        from,
        replyTo,
        to: row.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // One-click unsubscribe (RFC 8058): Gmail and Apple Mail show their own
        // Unsubscribe button, and bulk-sender rules expect it.
        headers: {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });

    // Same rows + same attempt = same key, so a resumed run that re-sends a batch
    // Resend already accepted gets the original answer back instead of a second send.
    const key = `campaign-${campaign.id}-${campaign.sendAttempt}-${rows[0]!.id}-${rows.length}`;
    let outcomes: Awaited<ReturnType<typeof sendBatch>>;
    try {
      outcomes = await sendBatch(payloads, key);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      outcomes = rows.map(() => ({ ok: false, error: message }));
    }

    const now = new Date();
    await Promise.all(
      rows.map((row, i) => {
        const outcome = outcomes[i] ?? { ok: false as const, error: "No result" };
        return prisma.campaignSend.update({
          where: { id: row.id },
          data: outcome.ok
            ? { status: "sent", resendId: outcome.id, error: null, sentAt: now }
            : { status: "failed", error: outcome.error.slice(0, 500) },
        });
      }),
    );
  }
  console.warn(`[mailing] Campaign ${campaign.id} hit the batch cap with rows still pending.`);
}

/**
 * Totals the rows and closes the run: "sent" when anything went out, otherwise
 * "failed".
 * @param campaign - The claimed campaign.
 * @returns Sent and failed counts.
 */
async function finishRun(campaign: Campaign): Promise<{ sent: number; failed: number }> {
  const [sent, failed] = await Promise.all([
    prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "sent" } }),
    prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "failed" } }),
  ]);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: sent > 0 ? "sent" : "failed",
      sentAt: campaign.sentAt ?? new Date(),
      sendingStartedAt: null,
      sentCount: sent,
      failedCount: failed,
    },
  });
  return { sent, failed };
}

/**
 * Sends a draft or scheduled campaign now. The atomic claim is what stops a
 * double-click, or the cron racing a manual send, from sending it twice.
 * @param id - Campaign id.
 * @param excludedIds - Contacts unticked in the send dialog; omitted to keep the stored list.
 * @param sendDuringQuietHours - The operator chose "Send now anyway" inside quiet hours.
 * @returns Counts, or the reason it didn't send.
 */
export async function startCampaignSend(
  id: string,
  excludedIds?: string[],
  sendDuringQuietHours = false,
): Promise<SendResult> {
  const missing = missingSendEnv();
  if (missing.length > 0) {
    return { ok: false, error: `Sending is off until ${missing.join(", ")} is set.`, status: 503 };
  }
  const hold = sendDuringQuietHours ? null : await quietHoldUntil();
  if (hold) {
    return {
      ok: false,
      error: `It's quiet hours until ${formatDateTimeShort(hold)}. Schedule it for then, or send now anyway.`,
      status: 409,
    };
  }

  const claimed = await prisma.campaign.updateMany({
    where: { id, isPreset: false, status: { in: ["draft", "scheduled"] } },
    data: {
      status: "sending",
      sendingStartedAt: new Date(),
      ...(excludedIds ? { excludedContactIds: excludedIds } : {}),
    },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "This email is already sending or has been sent.", status: 409 };
  }
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });

  const parts = await loadSharedRenderParts(campaign.promoId);
  if (!parts.linkedPromoLive) {
    await releaseToDraft(id);
    return {
      ok: false,
      error: "The promo this email is about has ended or been switched off, so it wasn't sent.",
      status: 409,
    };
  }
  const problems = listProblems(contentOf(campaign), parts.promo !== null);
  if (problems.length > 0) {
    await releaseToDraft(id);
    return { ok: false, error: problems.join(" "), status: 400 };
  }

  const total = await ensureSendRows(campaign);
  if (total === 0) {
    await releaseToDraft(id);
    return { ok: false, error: "There's nobody to send this to.", status: 400 };
  }

  await deliverPending(campaign, parts);
  const counts = await finishRun(campaign);
  return { ok: true, ...counts };
}

/**
 * Re-sends only the rows that failed last time. Waits out quiet hours like a first send.
 * @param id - Campaign id.
 * @returns Counts, or the reason it didn't run.
 */
export async function retryFailedSends(id: string): Promise<SendResult> {
  const missing = missingSendEnv();
  if (missing.length > 0) {
    return { ok: false, error: `Sending is off until ${missing.join(", ")} is set.`, status: 503 };
  }
  const hold = await quietHoldUntil();
  if (hold) {
    return {
      ok: false,
      error: `It's quiet hours until ${formatDateTimeShort(hold)}, so retry them then.`,
      status: 409,
    };
  }
  const before = await prisma.campaign.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Email not found.", status: 404 };
  const parts = await loadSharedRenderParts(before.promoId);
  if (!parts.linkedPromoLive) {
    return {
      ok: false,
      error: "The promo this email is about has ended, so the failed ones weren't re-sent.",
      status: 409,
    };
  }

  const claimed = await prisma.campaign.updateMany({
    where: { id, status: { in: ["sent", "failed"] }, failedCount: { gt: 0 } },
    data: { status: "sending", sendingStartedAt: new Date(), sendAttempt: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "There's nothing to retry on this email.", status: 409 };
  }
  await prisma.campaignSend.updateMany({
    where: { campaignId: id, status: "failed" },
    data: { status: "pending", error: null },
  });
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  await deliverPending(campaign, parts);
  const counts = await finishRun(campaign);
  return { ok: true, ...counts };
}

/**
 * Cron: sends scheduled campaigns that are due, then resumes any run that died
 * part-way. Does nothing inside quiet hours: the schedule route already keeps new times
 * out of them, so this catches a window changed after scheduling and a stalled run that
 * would otherwise resume overnight. Both go on the first run after quiet hours end.
 * A stalled run whose linked promo has since ended is closed, not resumed, so nobody
 * gets an email with the promo wording blanked out.
 * @returns When quiet hours end (null outside them), and one line per campaign touched.
 */
export async function runScheduledSends(): Promise<{
  heldUntil: Date | null;
  results: { id: string; name: string; result: SendResult }[];
}> {
  const now = new Date();
  const results: { id: string; name: string; result: SendResult }[] = [];
  const heldUntil = await quietHoldUntil(now);
  if (heldUntil) return { heldUntil, results };

  const due = await prisma.campaign.findMany({
    where: { isPreset: false, status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true, name: true },
    orderBy: { scheduledAt: "asc" },
  });
  for (const c of due) {
    results.push({ id: c.id, name: c.name, result: await startCampaignSend(c.id) });
  }

  const stuck = await prisma.campaign.findMany({
    where: {
      status: "sending",
      sendingStartedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    },
  });
  for (const campaign of stuck) {
    // Re-claim by the old timestamp so two overlapping cron runs can't both resume it.
    const claimed = await prisma.campaign.updateMany({
      where: { id: campaign.id, status: "sending", sendingStartedAt: campaign.sendingStartedAt },
      data: { sendingStartedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const parts = await loadSharedRenderParts(campaign.promoId);
    if (parts.linkedPromoLive) {
      await ensureSendRows(campaign);
      await deliverPending(campaign, parts);
    } else {
      // Part of the list may already have it, so close the run rather than release to
      // draft: the rest fail with a reason, and Retry stays blocked while the promo is off.
      await prisma.campaignSend.updateMany({
        where: { campaignId: campaign.id, status: "pending" },
        data: { status: "failed", error: "The promo ended before this went out." },
      });
    }
    const counts = await finishRun(campaign);
    results.push({ id: campaign.id, name: campaign.name, result: { ok: true, ...counts } });
  }
  return { heldUntil: null, results };
}

/**
 * Sends one copy to the operator's own inbox, filled in as if it were for them.
 * Not recorded anywhere, and its unsubscribe link goes to a page that explains
 * it came from a test.
 * @param content - Subject, preheader and body to test.
 * @param promoId - Linked promo id, or null.
 * @returns Success, or the reason it didn't send.
 */
export async function sendTestEmail(
  content: CampaignContent,
  promoId: string | null,
): Promise<SendResult> {
  const to = process.env.ADMIN_EMAIL?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!to || !from || !process.env.RESEND_API_KEY?.trim()) {
    return {
      ok: false,
      error: "Test sends need RESEND_API_KEY, EMAIL_FROM and ADMIN_EMAIL set.",
      status: 503,
    };
  }
  const [parts, identity] = await Promise.all([loadSharedRenderParts(promoId), getIdentity()]);
  const email = renderCampaign(
    content,
    { name: identity.name },
    { ...parts, unsubscribeUrl: unsubscribePageUrl("preview") },
  );
  const result = await sendNow({
    from,
    to,
    subject: `[Test] ${email.subject}`,
    html: email.html,
    text: email.text,
  });
  if (result.error) return { ok: false, error: result.error.message, status: 502 };
  return { ok: true, sent: 1, failed: 0 };
}
