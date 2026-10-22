// src/features/social/lib/inbox/actions.server.ts
// What the Inbox does to a message on the app itself (reply, hide or show, delete) and to its
// marks (read, archived), then the stored rows and the thread's state. A message the app says is
// gone is marked gone, and a missing permission is named.

import {
  deleteReviewReply,
  GoogleGoneError,
  replyToReview,
} from "@/features/social/lib/google-business";
import { replyProblem } from "@/features/social/lib/inbox/map";
import { readableError, refreshThreads } from "@/features/social/lib/inbox/sync.server";
import { metaProblem } from "@/features/social/lib/insights/metrics";
import { graph, GraphError } from "@/features/social/lib/meta-graph";
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
  kind: "comment" | "reply" | "review";
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
 * @param message - The message acted on.
 * @param error - What the app threw.
 * @param now - Now.
 * @returns The error to throw.
 */
async function failed(message: Message, error: unknown, now: Date): Promise<InboxActionError> {
  const gone =
    error instanceof GoogleGoneError ||
    (error instanceof GraphError && metaProblem(error.code, error.raw) === "gone");
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
}

/**
 * Hides or shows a comment on the app. Google reviews can't be hidden, and nor can our own.
 * @param id - The comment.
 * @param hidden - Whether to hide it.
 * @param now - Now.
 */
export async function setHidden(id: string, hidden: boolean, now: Date): Promise<void> {
  const message = await loadMessage(id);
  if (message.platform === "google") {
    throw new InboxActionError("Google reviews can't be hidden.", 400);
  }
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
 * Deletes a message on the app. On Google only our reply can go: a review is its writer's.
 * @param id - The message.
 * @param now - Now.
 */
export async function deleteMessage(id: string, now: Date): Promise<void> {
  const message = await loadMessage(id);
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
    // Already deleted on the app is what was asked for.
    const gone = error instanceof GraphError && metaProblem(error.code, error.raw) === "gone";
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
