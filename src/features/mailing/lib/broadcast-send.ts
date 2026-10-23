// src/features/mailing/lib/broadcast-send.ts
// Sends a campaign as one Resend broadcast instead of per-person transactional emails.
// Steps: a segment for this send, a contact import into it, a draft broadcast, then the
// send call. Each step's id is claimed on the Campaign before the next starts, so a run
// that dies resumes where it stopped and two runs can't both send.

import { audienceOf } from "@/features/mailing/lib/audience";
import {
  BROADCAST_PROPERTIES,
  importCsv,
  sendDecision,
  type ImportRow,
} from "@/features/mailing/lib/broadcast";
import {
  mailingFrom,
  unsubscribePageUrl,
  type SharedRenderParts,
} from "@/features/mailing/lib/context";
import type { BroadcastFailure } from "@/features/mailing/lib/delivery-events";
import { optOutByEmail } from "@/features/mailing/lib/opt-out";
import { loadRecipients, loadReviewTexts } from "@/features/mailing/lib/recipients";
import { campaignTag, renderBroadcast } from "@/features/mailing/lib/render";
import {
  broadcastStatus,
  contactImportStatus,
  createBroadcast,
  createSegment,
  ensureContactProperties,
  listMarketingContacts,
  removeBroadcast,
  removeMarketingContact,
  removeSegment,
  sendBroadcast,
  startContactImport,
} from "@/features/mailing/lib/resend-marketing";
import { signUnsubscribeToken } from "@/features/mailing/lib/unsubscribe-token";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Campaign, Prisma } from "@prisma/client";

/** How long one run waits for Resend to finish loading the list before leaving it to the cron. */
const IMPORT_WAIT_MS = 60_000;
const IMPORT_POLL_MS = 3_000;

/** The step fields a run claims, one at a time. */
type StepField = "segmentId" | "importId" | "broadcastId";

/**
 * Matches a campaign whose field is still empty. Mongo's `null` filter skips a field that
 * was never written, which is every row from before broadcasts, so test for both.
 * @param field - Step field.
 * @returns Where clause.
 */
function unset(field: StepField | "broadcastSentAt"): Prisma.CampaignWhereInput {
  return { OR: [{ [field]: null }, { [field]: { isSet: false } }] };
}

/**
 * Stores a step's new id unless another run stored one first, in which case the spare is
 * undone and the other run's id kept.
 * @param id - Campaign id.
 * @param field - Step field.
 * @param value - The new id.
 * @param undo - Removes the spare from Resend.
 * @returns The campaign as stored now.
 */
async function claimStep(
  id: string,
  field: StepField,
  value: string,
  undo?: () => Promise<void>,
): Promise<Campaign> {
  const won = await prisma.campaign.updateMany({
    where: { id, ...unset(field) },
    data: { [field]: value },
  });
  if (won.count === 0 && undo) {
    await undo().catch((err) => console.warn(`[mailing] Couldn't undo a spare ${field}:`, err));
  }
  return prisma.campaign.findUniqueOrThrow({ where: { id } });
}

/**
 * Pulls Resend-side unsubscribes into the site's opt-outs, then deletes Resend contacts no
 * longer on the list (unsubscribed, deleted or without an email), keeping the account under
 * the free plan's 1,000 contacts. Runs before each broadcast picks its recipients. Never
 * throws: Resend skips its own unsubscribed contacts anyway, so a failed pull isn't unsafe.
 */
export async function syncResendContacts(): Promise<void> {
  try {
    const contacts = await listMarketingContacts();
    const known = new Set(
      (await prisma.emailOptOut.findMany({ select: { email: true } })).map((o) => o.email),
    );
    for (const c of contacts) {
      if (c.unsubscribed && !known.has(c.email)) await optOutByEmail(c.email, "one_click");
    }
    const { recipients } = await loadRecipients();
    const onList = new Set(recipients.map((r) => r.email));
    for (const c of contacts) {
      if (!onList.has(c.email)) await removeMarketingContact(c.id);
    }
  } catch (err) {
    console.warn("[mailing] Resend contact sync failed:", err);
  }
}

/**
 * One import row per pending recipient, with their name, review and unsubscribe page.
 * @param campaign - The campaign.
 * @returns The rows.
 */
async function importRows(campaign: Campaign): Promise<ImportRow[]> {
  const rows = await prisma.campaignSend.findMany({
    where: { campaignId: campaign.id, status: "pending" },
    select: { contactId: true, email: true },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.contactId);
  const [contacts, reviewTexts] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    // Only a reviewers email can use {reviewText} (listProblems blocks it elsewhere).
    audienceOf(campaign.audience) === "site_reviewers" ? loadReviewTexts(ids) : null,
  ]);
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    email: r.email,
    name: names.get(r.contactId) ?? null,
    reviewText: reviewTexts?.get(r.contactId) ?? null,
    unsubscribeUrl: unsubscribePageUrl(signUnsubscribeToken(r.contactId)),
  }));
}

/**
 * Frees the segments of finished sends: broadcasts Resend reports sent, and failed runs.
 * A failed one also drops its unsent draft broadcast, which points at that segment, so a
 * retry starts the steps afresh.
 */
async function freeSegments(): Promise<void> {
  await finishBroadcasts();
  const holders = await prisma.campaign.findMany({
    where: { segmentId: { not: null }, status: "failed" },
  });
  for (const c of holders) {
    await removeSegment(c.segmentId!).catch((err) =>
      console.warn(`[mailing] Couldn't remove segment ${c.segmentId}:`, err),
    );
    const unsent = c.broadcastId && !c.broadcastSentAt ? c.broadcastId : null;
    if (unsent) await removeBroadcast(unsent).catch(() => undefined);
    await prisma.campaign.update({
      where: { id: c.id },
      data: {
        segmentId: null,
        importId: null,
        ...(unsent ? { broadcastId: null } : {}),
      },
    });
  }
}

/**
 * Makes this send's segment. When Resend refuses (the free plan allows 3), finished sends
 * give theirs back and it tries once more.
 * @param name - Campaign name.
 * @returns The segment id.
 */
async function makeSegment(name: string): Promise<string> {
  const label = `Mailing: ${name}`.slice(0, 100);
  try {
    return await createSegment(label);
  } catch (first) {
    await freeSegments();
    try {
      return await createSegment(label);
    } catch {
      throw new Error(
        `${first instanceof Error ? first.message : "Resend refused the segment."} Resend's free plan allows 3 segments: delete a spare one in Resend's Audience page, then retry.`,
      );
    }
  }
}

/**
 * Waits for Resend to finish loading the list, polling every few seconds.
 * @param campaign - Campaign with an import id.
 * @returns "loaded", or "waiting" when it's still going at the time limit.
 */
async function waitForImport(campaign: Campaign): Promise<"loaded" | "waiting"> {
  const until = Date.now() + IMPORT_WAIT_MS;
  for (;;) {
    const { status, failed } = await contactImportStatus(campaign.importId!);
    if (status === "completed") {
      if (failed > 0) {
        console.warn(`[mailing] Resend skipped ${failed} rows of campaign ${campaign.id}.`);
      }
      return "loaded";
    }
    if (status === "failed") {
      // Clear it so a retry uploads the list again.
      await prisma.campaign.update({ where: { id: campaign.id }, data: { importId: null } });
      throw new Error("Resend couldn't load the list.");
    }
    if (Date.now() >= until) return "waiting";
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
  }
}

/**
 * Calls send on the broadcast at most once across every run, following
 * {@link sendDecision}.
 * @param campaign - Campaign with a broadcast id.
 * @returns True once the broadcast has gone, false when another run may be mid-call.
 */
async function sendOnce(campaign: Campaign): Promise<boolean> {
  const broadcastId = campaign.broadcastId!;
  const claimedAt = campaign.broadcastSentAt;
  const status = claimedAt ? await broadcastStatus(broadcastId) : "draft";
  const decision = sendDecision(claimedAt, status, new Date());
  if (decision !== "send") return decision === "done";

  // Claim by the old value so only one run makes the call.
  const claimed = await prisma.campaign.updateMany({
    where: {
      id: campaign.id,
      ...(claimedAt ? { broadcastSentAt: claimedAt } : unset("broadcastSentAt")),
    },
    data: { broadcastSentAt: new Date() },
  });
  if (claimed.count === 0) return false;
  try {
    await sendBroadcast(broadcastId);
    return true;
  } catch (err) {
    // A timeout can land after Resend took it, so ask before calling it a failure.
    const after = await broadcastStatus(broadcastId).catch(() => "draft" as const);
    if (after !== "draft") return true;
    await prisma.campaign.update({ where: { id: campaign.id }, data: { broadcastSentAt: null } });
    throw err;
  }
}

/**
 * Sends the campaign's pending rows as one broadcast, carrying on from whichever step a
 * previous run reached. Throws when a step fails.
 * @param campaignId - The claimed campaign.
 * @param parts - Shared render parts.
 * @returns "sent" once Resend has it (pending rows become sent), or "waiting" when the
 *   list is still loading or another run is mid-send, for the cron's next pass.
 */
export async function deliverByBroadcast(
  campaignId: string,
  parts: SharedRenderParts,
): Promise<"sent" | "waiting"> {
  let campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });

  if (!campaign.segmentId) {
    const segmentId = await makeSegment(campaign.name);
    campaign = await claimStep(campaignId, "segmentId", segmentId, () => removeSegment(segmentId));
  }

  if (!campaign.importId) {
    const rows = await importRows(campaign);
    if (rows.length === 0) return "sent";
    await ensureContactProperties(BROADCAST_PROPERTIES);
    const importId = await startContactImport(
      importCsv(rows),
      BROADCAST_PROPERTIES,
      campaign.segmentId!,
    );
    campaign = await claimStep(campaignId, "importId", importId);
  }
  if ((await waitForImport(campaign)) === "waiting") return "waiting";

  if (!campaign.broadcastId) {
    const email = renderBroadcast(
      { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body },
      { ...parts, tracking: { siteUrl: getSiteUrl(), campaign: campaignTag(campaign.subject) } },
    );
    const broadcastId = await createBroadcast({
      name: campaign.name,
      from: mailingFrom()!,
      replyTo: process.env.ADMIN_EMAIL?.trim() || undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
      segmentId: campaign.segmentId!,
    });
    campaign = await claimStep(campaignId, "broadcastId", broadcastId, () =>
      removeBroadcast(broadcastId),
    );
  }

  if (!(await sendOnce(campaign))) return "waiting";
  await prisma.campaignSend.updateMany({
    where: { campaignId, status: "pending" },
    data: { status: "sent", error: null, sentAt: new Date() },
  });
  return "sent";
}

/**
 * Cron: once Resend reports a broadcast sent, gives its segment back (the free plan
 * allows 3). The contacts stay for the next send.
 */
export async function finishBroadcasts(): Promise<void> {
  const open = await prisma.campaign.findMany({
    where: { status: "sent", segmentId: { not: null } },
    select: { id: true, segmentId: true, broadcastId: true },
  });
  for (const c of open) {
    try {
      if (c.broadcastId && (await broadcastStatus(c.broadcastId)) !== "sent") continue;
      await removeSegment(c.segmentId!);
      await prisma.campaign.update({ where: { id: c.id }, data: { segmentId: null } });
    } catch (err) {
      console.warn(`[mailing] Couldn't finish broadcast for campaign ${c.id}:`, err);
    }
  }
}

/**
 * Marks broadcast copies that never arrived and recounts the campaign.
 * @param failure - Which broadcast, which addresses and why, from the webhook.
 */
export async function recordBroadcastFailure(failure: BroadcastFailure): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { broadcastId: failure.broadcastId },
    select: { id: true },
  });
  if (!campaign) return;
  await prisma.campaignSend.updateMany({
    where: { campaignId: campaign.id, email: { in: failure.emails } },
    data: { status: "failed", error: failure.reason },
  });
  const [sent, failed] = await Promise.all([
    prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "sent" } }),
    prisma.campaignSend.count({ where: { campaignId: campaign.id, status: "failed" } }),
  ]);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { sentCount: sent, failedCount: failed },
  });
}

/**
 * Gives a deleted campaign's segment back, best effort.
 * @param segmentId - Segment id, or null.
 */
export async function releaseSegment(segmentId: string | null): Promise<void> {
  if (!segmentId) return;
  await removeSegment(segmentId).catch((err) =>
    console.warn(`[mailing] Couldn't remove segment ${segmentId}:`, err),
  );
}
