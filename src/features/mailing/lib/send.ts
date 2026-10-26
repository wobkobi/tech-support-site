// src/features/mailing/lib/send.ts
// Sends mailing-list emails: an atomic claim, one CampaignSend row per recipient (the record
// of truth for resume and retry, re-checked against the list before each delivery), then one
// Resend broadcast when the marketing key is set, else batches of 100 with idempotency keys
// (which count toward the daily send limit). Quiet hours hold every list send unless the
// operator chose to send anyway.

import { audienceOf } from "@/features/mailing/lib/audience";
import {
  deliverByBroadcast,
  finishBroadcasts,
  syncResendContacts,
} from "@/features/mailing/lib/broadcast-send";
import {
  loadSharedRenderParts,
  mailingFrom,
  missingSendEnv,
  oneClickUnsubscribeUrl,
  unsubscribePageUrl,
  type SharedRenderParts,
} from "@/features/mailing/lib/context";
import {
  loadRecipients,
  loadReviewTexts,
  planPendingRefresh,
} from "@/features/mailing/lib/recipients";
import {
  campaignTag,
  listProblems,
  renderCampaign,
  SAMPLE_REVIEW_TEXT,
  type CampaignContent,
} from "@/features/mailing/lib/render";
import { marketingReady, removeFromSegment } from "@/features/mailing/lib/resend-marketing";
import { signUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { sendBatch, sendNow, type BatchMailPayload } from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { nextSendTime, quietHoursOf } from "@/shared/lib/quiet-hours";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Campaign } from "@prisma/client";

/** Resend's batch limit. */
const CHUNK_SIZE = 100;
/** Gap between batches, keeping a big list under Resend's requests-per-second limit. */
const CHUNK_PAUSE_MS = 600;
/** A run "sending" for longer than this died part-way, and the cron resumes it. */
const STUCK_AFTER_MS = 10 * 60_000;
/**
 * A broadcast left waiting on Resend's list upload is picked up after this, well past the
 * minute one run waits for it.
 */
const BROADCAST_RESUME_MS = 2 * 60_000;
/** Hard stop on the batch loop, far above any real list (100 x 50 = 5,000 people). */
const MAX_CHUNKS = 50;

/**
 * Outcome of a send, retry or test. `waiting` means a broadcast is still on its way (Resend
 * is loading the list) and the cron finishes it.
 */
export type SendResult =
  | { ok: true; sent: number; failed: number; waiting?: boolean }
  | { ok: false; error: string; status: number };

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
 * Puts a claimed campaign back to draft when a send can't go ahead.
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
  const { recipients } = await loadRecipients(
    campaign.excludedContactIds,
    audienceOf(campaign.audience),
  );
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
 * Re-checks the pending rows against the list as it stands, so a retried or resumed run never
 * mails someone who unsubscribed, was deleted or was unticked since the rows were written. A
 * changed address moves the row to it, except once a broadcast's list is in Resend: then the
 * row is dropped and the old address taken out of the segment. Skipped once the broadcast has
 * gone, as everyone still pending already has it.
 * @param campaign - The claimed campaign.
 */
async function refreshPendingRows(campaign: Campaign): Promise<void> {
  if (campaign.broadcastSentAt) return;
  const rows = await prisma.campaignSend.findMany({
    where: { campaignId: campaign.id },
    select: { id: true, contactId: true, email: true, status: true },
  });
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length === 0) return;
  const { recipients } = await loadRecipients(
    campaign.excludedContactIds,
    audienceOf(campaign.audience),
  );
  const listLoaded = Boolean(campaign.importId && campaign.segmentId);
  const { drop: dropped, move } = planPendingRefresh(
    pending,
    new Map(recipients.map((r) => [r.contactId, r.email])),
    new Set(rows.filter((r) => r.status !== "pending").map((r) => r.email)),
    listLoaded,
  );
  for (const { row, email } of move) {
    try {
      await prisma.campaignSend.update({ where: { id: row.id }, data: { email } });
    } catch {
      // Two rows swapping addresses trip the unique index; leave this one out, not guess.
      dropped.push(row);
    }
  }
  if (dropped.length === 0) return;

  let removed = dropped;
  if (listLoaded) {
    // The list is already in Resend, so a row only goes once its address is out of the
    // segment; one that won't come out stays, as the broadcast will still reach it.
    removed = [];
    for (const row of dropped) {
      try {
        await removeFromSegment(row.email, campaign.segmentId!);
        removed.push(row);
      } catch (err) {
        console.warn(`[mailing] Couldn't take send ${row.id} off its list:`, err);
      }
    }
  }
  await prisma.campaignSend.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
  console.log(`[mailing] Campaign ${campaign.id}: ${removed.length} pending sends left the list.`);
}

/**
 * Sends every pending row in batches and records each outcome on its row.
 * @param campaign - The claimed campaign.
 * @param parts - Shared render parts.
 * @returns True when Resend didn't answer a batch, left pending for the cron to re-send.
 */
async function deliverPending(campaign: Campaign, parts: SharedRenderParts): Promise<boolean> {
  const from = mailingFrom()!;
  const replyTo = process.env.ADMIN_EMAIL?.trim() || undefined;
  const content = contentOf(campaign);
  const tracking = { siteUrl: getSiteUrl(), campaign: campaignTag(campaign.subject) };

  for (let round = 0; round < MAX_CHUNKS; round++) {
    const rows = await prisma.campaignSend.findMany({
      where: { campaignId: campaign.id, status: "pending" },
      orderBy: { id: "asc" },
      take: CHUNK_SIZE,
    });
    if (rows.length === 0) return false;
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));

    const contacts = await prisma.contact.findMany({
      where: { id: { in: rows.map((r) => r.contactId) } },
      select: { id: true, name: true },
    });
    const names = new Map(contacts.map((c) => [c.id, c.name]));
    // Only a reviewers email can use {reviewText} (listProblems blocks it elsewhere).
    const reviewTexts =
      audienceOf(campaign.audience) === "site_reviewers"
        ? await loadReviewTexts(rows.map((r) => r.contactId))
        : null;

    const payloads: BatchMailPayload[] = rows.map((row) => {
      const token = signUnsubscribeToken(row.contactId);
      const email = renderCampaign(
        content,
        {
          name: names.get(row.contactId) ?? null,
          reviewText: reviewTexts?.get(row.contactId) ?? null,
        },
        { ...parts, unsubscribeUrl: unsubscribePageUrl(token), tracking },
      );
      return {
        from,
        replyTo,
        to: row.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // One-click unsubscribe (RFC 8058), expected by bulk-sender rules.
        headers: {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    });

    // Same rows + same attempt = same key, so a resumed run never double-sends a batch.
    const key = `campaign-${campaign.id}-${campaign.sendAttempt}-${rows[0]!.id}-${rows.length}`;
    let outcomes: Awaited<ReturnType<typeof sendBatch>>;
    try {
      outcomes = await sendBatch(payloads, key);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      outcomes = rows.map(() => ({ ok: false, error: message, uncertain: true }));
    }
    // No answer either way: the rows stay pending and the stalled-run resume re-sends them
    // under this same key, which Resend drops if the first copy went. Failed rows would go to
    // Retry, whose new key could send a second copy.
    if (outcomes.every((o) => !o.ok && o.uncertain)) {
      console.warn(
        `[mailing] Resend didn't answer a batch of campaign ${campaign.id}; the cron re-sends it.`,
      );
      return true;
    }

    const now = new Date();
    await Promise.all(
      rows.map((row, i) => {
        const outcome = outcomes[i] ?? { ok: false as const, error: "No result" };
        return prisma.campaignSend.update({
          where: { id: row.id },
          data: outcome.ok
            ? { status: "sent", error: null, sentAt: now }
            : { status: "failed", error: outcome.error.slice(0, 500) },
        });
      }),
    );
  }
  console.warn(`[mailing] Campaign ${campaign.id} hit the batch cap with rows still pending.`);
  return false;
}

/**
 * Sends the pending rows, once re-checked: as one broadcast when the marketing key is set,
 * else in batches. A broadcast step that fails marks the pending rows failed with its
 * reason, so Retry failed carries on from that step.
 * @param campaign - The claimed campaign.
 * @param parts - Shared render parts.
 * @returns True while a broadcast is still on its way or a batch awaits Resend's answer, for
 *   the cron to finish.
 */
async function deliver(campaign: Campaign, parts: SharedRenderParts): Promise<boolean> {
  await refreshPendingRows(campaign);
  if (!marketingReady()) return deliverPending(campaign, parts);
  try {
    return (await deliverByBroadcast(campaign.id, parts)) === "waiting";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    console.error(`[mailing] Broadcast for campaign ${campaign.id} failed:`, err);
    await prisma.campaignSend.updateMany({
      where: { campaignId: campaign.id, status: "pending" },
      data: { status: "failed", error: message.slice(0, 500) },
    });
    return false;
  }
}

/** The result for a broadcast the cron will finish. */
const WAITING: SendResult = { ok: true, sent: 0, failed: 0, waiting: true };

/**
 * Totals the rows and closes the run: "sent" when anything went out, else "failed".
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
 * Sends a draft or scheduled campaign now; the atomic claim stops a double-click or the
 * cron from sending it twice.
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
  const problems = listProblems(
    contentOf(campaign),
    parts.promo !== null,
    audienceOf(campaign.audience),
  );
  if (problems.length > 0) {
    await releaseToDraft(id);
    return { ok: false, error: problems.join(" "), status: 400 };
  }

  // Resend-side unsubscribes must land before the recipients are picked.
  if (marketingReady()) await syncResendContacts();
  const total = await ensureSendRows(campaign);
  if (total === 0) {
    await releaseToDraft(id);
    return { ok: false, error: "There's nobody to send this to.", status: 400 };
  }

  if (await deliver(campaign, parts)) return WAITING;
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
  if (before.broadcastSentAt) {
    return {
      ok: false,
      error:
        "These went out but bounced, or Resend won't send to the address, so sending again won't help.",
      status: 409,
    };
  }
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
  if (await deliver(campaign, parts)) return WAITING;
  const counts = await finishRun(campaign);
  return { ok: true, ...counts };
}

/**
 * Cron: gives back the segments of finished broadcasts, then sends due scheduled campaigns
 * and resumes stalled runs. Sends nothing inside quiet hours; a stalled run whose promo has
 * ended is closed, not resumed.
 * @returns When quiet hours end (null outside them), and one line per campaign touched.
 */
export async function runScheduledSends(): Promise<{
  heldUntil: Date | null;
  results: { id: string; name: string; result: SendResult }[];
}> {
  const now = new Date();
  const results: { id: string; name: string; result: SendResult }[] = [];
  if (marketingReady()) await finishBroadcasts();
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
      OR: [
        { sendingStartedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
        {
          importId: { not: null },
          sendingStartedAt: { lt: new Date(now.getTime() - BROADCAST_RESUME_MS) },
        },
      ],
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
      if (await deliver(campaign, parts)) {
        results.push({ id: campaign.id, name: campaign.name, result: WAITING });
        continue;
      }
    } else {
      // Part of the list may already have it, so close the run; the rest fail with a reason.
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
 * Sends one unrecorded copy to the operator's inbox, filled in for them with a sample
 * {reviewText}; its unsubscribe link goes to a test explainer page.
 * @param content - Subject, preheader and body to test.
 * @param promoId - Linked promo id, or null.
 * @returns Success, or the reason it didn't send.
 */
export async function sendTestEmail(
  content: CampaignContent,
  promoId: string | null,
): Promise<SendResult> {
  const to = process.env.ADMIN_EMAIL?.trim();
  const from = mailingFrom();
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
    { name: identity.name, reviewText: SAMPLE_REVIEW_TEXT },
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
