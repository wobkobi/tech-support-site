// src/features/social/lib/inbox/actions.server.ts
// What the Inbox does to a message on the app itself (reply, hide or show, delete) and to its
// marks (read, archived), then the stored rows and the thread's state. A message the app says is
// gone is marked gone, and a missing permission is named. Direct messages can only be answered:
// the apps don't let a business hide or delete them, and only within a day of their last one.

import {
  deleteReviewReply,
  GoogleGoneError,
  replyToReview,
} from "@/features/social/lib/google-business";
import {
  dmAppLabel,
  isDirect,
  isWindowError,
  replyOpenUntil,
  replyProblem,
  windowClosedText,
  type InboxKind,
} from "@/features/social/lib/inbox/map";
import { readableError, refreshThreads } from "@/features/social/lib/inbox/sync.server";
import { metaProblem } from "@/features/social/lib/insights/metrics";
import { accountVisible, graph, GraphError, metaConfig } from "@/features/social/lib/meta-graph";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { errorResponse } from "@/shared/lib/api-response";
import { prisma } from "@/shared/lib/prisma";
import type { NextResponse } from "next/server";

/** A refused or failed action, with the status the route answers with. */
export class InboxActionError extends Error {
  /** The HTTP status. */
  readonly status: number;
  /**
   * Creates the error.
   * @param message - What to tell the operator.
   * @param status - The HTTP status.
   */
  constructor(message: string, status: number) {
    super(message);
    this.name = "InboxActionError";
    this.status = status;
  }
}

/**
 * The route's answer when an action throws.
 * @param error - What it threw.
 * @param where - The route, for the log.
 * @returns The error response.
 */
export function actionErrorResponse(error: unknown, where: string): NextResponse {
  if (error instanceof InboxActionError) return errorResponse(error.message, error.status);
  console.error(`[${where}] failed:`, error);
  return errorResponse("That didn't work. Try again.", 500);
}

/** A stored message, as the actions need it. */
interface Message {
  id: string;
  platform: SocialPlatformKey;
  kind: InboxKind;
  externalId: string;
  threadExternalId: string | null;
  fromUs: boolean;
  hidden: boolean | null;
  goneAt: Date | null;
}

/**
 * Loads a message, refusing one that's gone.
 * @param id - Our id.
 * @returns The message.
 */
async function loadMessage(id: string): Promise<Message> {
  const row = await prisma.socialComment.findUnique({
    where: { id },
    select: {
      id: true,
      platform: true,
      kind: true,
      externalId: true,
      threadExternalId: true,
      fromUs: true,
      hidden: true,
      goneAt: true,
    },
  });
  if (!row) throw new InboxActionError("That message has been deleted.", 404);
  if (row.goneAt) {
    throw new InboxActionError(`That's no longer on ${PLATFORM_LABEL[row.platform]}.`, 410);
  }
  return row;
}

/**
 * The top-level id of a message's thread.
 * @param message - The message.
 * @returns The thread's id.
 */
function rootOf(message: Message): string {
  return message.threadExternalId ?? message.externalId;
}

/**
 * Turns an app's refusal into an action error, marking the message gone when the app says so.
 * A direct message is never marked gone this way: Meta's "does not exist" there can mean the
 * person, not the conversation.
 * @param message - The message acted on.
 * @param error - What the app threw.
 * @param now - Now.
 * @returns The error to throw.
 */
async function failed(message: Message, error: unknown, now: Date): Promise<InboxActionError> {
  // Meta sends the window refusal as code 10, which otherwise reads as a missing permission.
  if (error instanceof GraphError && isWindowError(error.raw)) {
    return new InboxActionError(windowClosedText(message.platform, true), 400);
  }
  // Lost access reads the same as a deleted comment, so only a visible account confirms it.
  const gone =
    !isDirect(message.kind) &&
    (error instanceof GoogleGoneError ||
      (error instanceof GraphError &&
        message.platform !== "google" &&
        metaProblem(error.code, error.raw) === "gone" &&
        (await accountVisible(message.platform))));
  if (gone) {
    await markGone(message, now);
    return new InboxActionError(`That's no longer on ${PLATFORM_LABEL[message.platform]}.`, 410);
  }
  const permission =
    error instanceof GraphError && metaProblem(error.code, error.raw) === "permission";
  console.error(`[inbox/actions] ${message.platform} refused:`, error);
  return new InboxActionError(readableError(error), permission ? 403 : 502);
}

/**
 * Marks a message gone, with its replies when it's the top of a thread (the apps delete those
 * with it), then works the thread out again.
 * @param message - The message.
 * @param now - Now.
 */
async function markGone(message: Message, now: Date): Promise<void> {
  const top = message.threadExternalId === null;
  await prisma.socialComment.updateMany({
    where: top
      ? {
          platform: message.platform,
          OR: [{ id: message.id }, { threadExternalId: message.externalId }],
        }
      : { id: message.id },
    data: { goneAt: now, syncedAt: now },
  });
  await refreshThreads(message.platform, [rootOf(message)], { now, firstRun: false });
}

/**
 * Saves what was just sent. The app has it by now, so a failed save says so rather than reading
 * as a failed send, which would invite a second copy; the next sync picks it up.
 * @param platform - The app it went to.
 * @param save - The saving.
 * @returns Our id for what was sent.
 */
async function keepSent(platform: SocialPlatformKey, save: () => Promise<string>): Promise<string> {
  try {
    return await save();
  } catch (error) {
    console.error(`[inbox/actions] ${platform} sent but not saved:`, error);
    throw new InboxActionError(
      "It was sent, but couldn't be saved here. It shows after the next sync, so don't send it again.",
      500,
    );
  }
}

/**
 * Replies on the app and keeps the reply. Facebook threads one deep and Instagram replies only
 * to top-level comments, so a reply always goes on the thread's top message; a Google review
 * holds one reply, which a new one replaces.
 * @param id - The message being answered.
 * @param text - The reply.
 * @param now - Now.
 * @returns Our id for the reply.
 */
export async function replyTo(id: string, text: string, now: Date): Promise<string> {
  const message = await loadMessage(id);
  if (isDirect(message.kind)) return sendMessage(message, text, now);
  const problem = replyProblem(message.platform, text);
  if (problem) throw new InboxActionError(problem, 400);
  const root = rootOf(message);
  const reply = text.trim();

  let externalId: string;
  let postedAt = now;
  try {
    if (message.platform === "google") {
      postedAt = await replyToReview(root, reply);
      externalId = `${root}/reply`;
    } else {
      const edge = message.platform === "facebook" ? "comments" : "replies";
      const res = await graph<{ id?: string }>(`/${root}/${edge}`, "POST", { message: reply });
      if (!res.id) throw new Error(`${PLATFORM_LABEL[message.platform]} didn't say it was sent.`);
      externalId = res.id;
    }
  } catch (error) {
    throw await failed(message, error, now);
  }

  return keepSent(message.platform, async () => {
    const kept = await prisma.socialComment.upsert({
      where: { platform_externalId: { platform: message.platform, externalId } },
      create: {
        platform: message.platform,
        kind: "reply",
        externalId,
        threadExternalId: root,
        objectExternalId: null,
        postId: null,
        objectText: null,
        objectImageUrl: null,
        objectUrl: null,
        authorName: null,
        authorId: null,
        fromUs: true,
        text: reply,
        rating: null,
        postedAt,
        editedAt: null,
        hidden: null,
        lastActivityAt: null,
        needsReply: null,
        repliedAt: null,
        readAt: null,
        archivedAt: null,
        goneAt: null,
        syncedAt: now,
      },
      update: { text: reply, postedAt, goneAt: null, syncedAt: now },
      select: { id: true },
    });
    // Copy the post fields from the thread's top so the reply reads like the sync's own rows.
    const top = await prisma.socialComment.findUnique({
      where: { platform_externalId: { platform: message.platform, externalId: root } },
      select: { objectExternalId: true, postId: true },
    });
    if (top) {
      await prisma.socialComment.update({
        where: { id: kept.id },
        data: { objectExternalId: top.objectExternalId, postId: top.postId },
      });
    }
    await refreshThreads(message.platform, [root], { now, firstRun: false });
    await setMarks(id, { read: true }, now);
    return kept.id;
  });
}

/**
 * Answers a direct message conversation on Messenger or Instagram and keeps the message. The
 * apps only take it within a day of their latest message, so that's checked here first, and
 * again by the app.
 * @param message - The conversation or one of its messages.
 * @param text - The message to send.
 * @param now - Now.
 * @returns Our id for the sent message.
 */
async function sendMessage(message: Message, text: string, now: Date): Promise<string> {
  const problem = replyProblem(message.platform, text, true);
  if (problem) throw new InboxActionError(problem, 400);
  const root = rootOf(message);
  const thread = await prisma.socialComment.findMany({
    where: { platform: message.platform, OR: [{ externalId: root }, { threadExternalId: root }] },
    select: { kind: true, authorId: true, fromUs: true, postedAt: true, goneAt: true },
  });
  const top = thread.find((r) => r.kind === "conversation");
  if (!top?.authorId) {
    throw new InboxActionError(
      `Couldn't tell who this is with. Answer it on ${dmAppLabel(message.platform)} instead.`,
      400,
    );
  }
  const until = replyOpenUntil(
    thread
      .filter((r) => r.kind === "message")
      .map((r) => ({ fromUs: r.fromUs, postedAt: r.postedAt, gone: r.goneAt !== null })),
  );
  if (!until || now > until) {
    throw new InboxActionError(windowClosedText(message.platform, until !== null), 400);
  }
  const { pageId } = metaConfig();
  if (!pageId) throw new InboxActionError("META_PAGE_ID isn't set.", 503);
  const reply = text.trim();

  let externalId: string;
  try {
    // Both apps answer through the Page; Instagram's recipient is the person's Instagram id.
    const res = await graph<{ message_id?: string }>(`/${pageId}/messages`, "POST", {
      recipient: JSON.stringify({ id: top.authorId }),
      messaging_type: "RESPONSE",
      message: JSON.stringify({ text: reply }),
    });
    if (!res.message_id) {
      throw new Error(`${dmAppLabel(message.platform)} didn't say it was sent.`);
    }
    externalId = res.message_id;
  } catch (error) {
    throw await failed(message, error, now);
  }

  return keepSent(message.platform, async () => {
    const kept = await prisma.socialComment.upsert({
      where: { platform_externalId: { platform: message.platform, externalId } },
      create: {
        platform: message.platform,
        kind: "message",
        externalId,
        threadExternalId: root,
        objectExternalId: null,
        postId: null,
        objectText: null,
        objectImageUrl: null,
        objectUrl: null,
        authorName: null,
        authorId: null,
        fromUs: true,
        text: reply,
        rating: null,
        postedAt: now,
        editedAt: null,
        hidden: null,
        lastActivityAt: null,
        needsReply: null,
        repliedAt: null,
        readAt: null,
        archivedAt: null,
        goneAt: null,
        syncedAt: now,
      },
      update: { text: reply, goneAt: null, syncedAt: now },
      select: { id: true },
    });
    // The list shows a conversation's latest message, as the sync writes it.
    await prisma.socialComment.updateMany({
      where: { platform: message.platform, externalId: root },
      data: { text: `You: ${reply}` },
    });
    await refreshThreads(message.platform, [root], { now, firstRun: false });
    await setMarks(message.id, { read: true }, now);
    return kept.id;
  });
}

/**
 * Hides or shows a comment on the app. Google reviews and direct messages can't be hidden, and
 * nor can our own.
 * @param id - The comment.
 * @param hidden - Whether to hide it.
 * @param now - Now.
 */
export async function setHidden(id: string, hidden: boolean, now: Date): Promise<void> {
  const message = await loadMessage(id);
  if (message.platform === "google") {
    throw new InboxActionError("Google reviews can't be hidden.", 400);
  }
  if (isDirect(message.kind)) throw new InboxActionError("Messages can't be hidden.", 400);
  if (message.fromUs) throw new InboxActionError("Your own replies can't be hidden.", 400);
  try {
    await graph(`/${message.externalId}`, "POST", {
      [message.platform === "facebook" ? "is_hidden" : "hide"]: String(hidden),
    });
  } catch (error) {
    throw await failed(message, error, now);
  }
  await prisma.socialComment.update({
    where: { id },
    data: { hidden, syncedAt: now },
  });
  await refreshThreads(message.platform, [rootOf(message)], { now, firstRun: false });
}

/**
 * Deletes a message on the app. On Google only our reply can go: a review is its writer's. The
 * apps don't let a business delete direct messages.
 * @param id - The message.
 * @param now - Now.
 */
export async function deleteMessage(id: string, now: Date): Promise<void> {
  const message = await loadMessage(id);
  if (isDirect(message.kind)) {
    throw new InboxActionError(
      `Messages can't be deleted from here. You can delete the chat on ${dmAppLabel(message.platform)} itself.`,
      400,
    );
  }
  try {
    if (message.platform === "google") {
      if (message.kind === "review") {
        throw new InboxActionError(
          "Only the person who wrote a review can delete it. You can report it from your Business Profile.",
          400,
        );
      }
      await deleteReviewReply(rootOf(message));
    } else {
      await graph(`/${message.externalId}`, "DELETE");
    }
  } catch (error) {
    if (error instanceof InboxActionError) throw error;
    // Already deleted on the app is what was asked for. Lost access reads the same as a
    // deleted comment, so, as for replies, only a visible account confirms it.
    const gone =
      error instanceof GraphError &&
      message.platform !== "google" &&
      metaProblem(error.code, error.raw) === "gone" &&
      (await accountVisible(message.platform));
    if (!gone) throw await failed(message, error, now);
  }
  await markGone(message, now);
}

/**
 * Sets a thread's read and archive marks. A reply's id sets its thread's.
 * @param id - A message in the thread.
 * @param marks - The marks to change; a missing one stays as it is.
 * @param marks.read - Whether it's read.
 * @param marks.archived - Whether it's archived.
 * @param now - Now.
 */
export async function setMarks(
  id: string,
  marks: { read?: boolean; archived?: boolean },
  now: Date,
): Promise<void> {
  const row = await prisma.socialComment.findUnique({
    where: { id },
    select: { platform: true, externalId: true, threadExternalId: true },
  });
  if (!row) throw new InboxActionError("That message has been deleted.", 404);
  const externalId = row.threadExternalId ?? row.externalId;
  await prisma.socialComment.updateMany({
    where: { platform: row.platform, externalId },
    data: {
      ...(marks.read !== undefined ? { readAt: marks.read ? now : null } : {}),
      ...(marks.archived !== undefined ? { archivedAt: marks.archived ? now : null } : {}),
    },
  });
}

/**
 * Marks every unread thread in the inbox read.
 * @param platform - Only this app's, or every app's when null.
 * @param now - Now.
 * @returns How many were marked.
 */
export async function markAllRead(platform: SocialPlatformKey | null, now: Date): Promise<number> {
  const { count } = await prisma.socialComment.updateMany({
    where: {
      threadExternalId: null,
      readAt: null,
      archivedAt: null,
      goneAt: null,
      ...(platform ? { platform } : {}),
    },
    data: { readAt: now },
  });
  return count;
}
