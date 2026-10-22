// src/features/social/lib/inbox/inbox-data.server.ts
// What the Inbox page shows: the threads its address asks for, the open thread with every
// message, the counts on its filters, the unread count the sidebar badge uses, and why an app's
// comments or messages aren't coming through; plus the Overview's New comments and messages card.

import {
  authorLabel,
  replyOpenUntil,
  SHOW_KINDS,
  snippet,
  type InboxFilter,
  type InboxKind,
  type InboxQuery,
  type InboxShow,
  type MessagingPlatform,
} from "@/features/social/lib/inbox/map";
import { loadCommentsState } from "@/features/social/lib/inbox/sync.server";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { isBlobImageUrl } from "@/shared/lib/blob-image";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma, SocialComment } from "@prisma/client";

/** Most threads one list shows. */
const LIST_MAX = 100;

/** A thread as the list shows it. */
export interface InboxThreadRow {
  id: string;
  platform: SocialPlatformKey;
  kind: InboxKind;
  author: string;
  snippet: string;
  rating: number | null;
  /** ISO. */
  lastActivityAt: string;
  unread: boolean;
  needsReply: boolean;
  replied: boolean;
  hidden: boolean;
  replies: number;
  /** The post's picture, when it's one of ours. */
  imageUrl: string | null;
  /** Our post's name, when the comment is on one made here. */
  postName: string | null;
}

/** One message in an open thread. */
export interface InboxMessage {
  id: string;
  kind: InboxKind;
  fromUs: boolean;
  author: string;
  /** The name the app gave, for the reply suggestion. */
  authorName: string | null;
  text: string;
  rating: number | null;
  /** ISO. */
  postedAt: string;
  editedAt: string | null;
  hidden: boolean;
  gone: boolean;
}

/** The open thread. */
export interface InboxThreadDetail {
  id: string;
  platform: SocialPlatformKey;
  kind: InboxKind;
  read: boolean;
  archived: boolean;
  needsReply: boolean;
  gone: boolean;
  /** Who a conversation is with, as the inbox shows them; null for comments and reviews. */
  with: string | null;
  /** Until when a conversation can be answered from here, as ISO; null when it can't be. */
  openUntil: string | null;
  /** On a conversation, url is where to open it on the app. */
  post: {
    id: string | null;
    name: string | null;
    text: string | null;
    imageUrl: string | null;
    url: string | null;
  };
  messages: InboxMessage[];
}

/** Everything the page needs. */
export interface InboxData {
  threads: InboxThreadRow[];
  /** Threads in the inbox (not archived) per filter, with the address's app. */
  counts: Record<InboxFilter, number>;
  unread: number;
  open: InboxThreadDetail | null;
  /** When the comments were last read, as ISO. */
  ranAt: string | null;
  /** Why an app's read failed. */
  errors: Partial<Record<SocialPlatformKey, string>>;
  /** Why an app's messages couldn't be read. */
  messageErrors: Partial<Record<MessagingPlatform, string>>;
  /** Apps with their keys set. */
  setUp: SocialPlatformKey[];
}

/** A thread's top row that still shows. */
const TOP: Prisma.SocialCommentWhereInput = { threadExternalId: null, goneAt: null };

/**
 * Threads in the inbox nobody has opened since something new came in.
 * @returns The count; 0 when the read fails, so the sidebar never breaks a page.
 */
export async function unreadCount(): Promise<number> {
  try {
    return await prisma.socialComment.count({ where: { ...TOP, readAt: null, archivedAt: null } });
  } catch (error) {
    console.error("[inbox] unread count failed:", error);
    return 0;
  }
}

/**
 * The show switch's part of the list query.
 * @param show - Which kinds of thread to list.
 * @returns Its where clause.
 */
function showWhere(show: InboxShow): Prisma.SocialCommentWhereInput {
  const kinds = SHOW_KINDS[show];
  return kinds ? { kind: { in: kinds } } : {};
}

/**
 * The filter's part of the list query.
 * @param filter - The filter.
 * @returns Its where clause.
 */
function filterWhere(filter: InboxFilter): Prisma.SocialCommentWhereInput {
  switch (filter) {
    case "needs-reply":
      return { needsReply: true };
    case "replied":
      return { repliedAt: { not: null } };
    case "hidden":
      return { hidden: true };
    default:
      return {};
  }
}

/**
 * Loads the page.
 * @param query - The address's tab, filter, app, kinds and words.
 * @param openId - The thread to open.
 * @returns The data.
 */
export async function loadInbox(query: InboxQuery, openId: string | null): Promise<InboxData> {
  const app: Prisma.SocialCommentWhereInput = query.app === "all" ? {} : { platform: query.app };
  const show = showWhere(query.show);
  const tab: Prisma.SocialCommentWhereInput =
    query.tab === "archive" ? { archivedAt: { not: null } } : { archivedAt: null };

  // Words match the thread's top message, its writer, or any reply in it.
  let search: Prisma.SocialCommentWhereInput = {};
  if (query.q) {
    const contains = { contains: query.q, mode: "insensitive" as const };
    const inReplies = await prisma.socialComment.findMany({
      where: { ...app, threadExternalId: { not: null }, goneAt: null, text: contains },
      select: { threadExternalId: true },
      take: 500,
    });
    const roots = [...new Set(inReplies.map((r) => r.threadExternalId!))];
    search = {
      OR: [
        { text: contains },
        { authorName: contains },
        ...(roots.length ? [{ externalId: { in: roots } }] : []),
      ],
    };
  }

  const [rows, counts, unread, state, open] = await Promise.all([
    prisma.socialComment.findMany({
      where: { ...TOP, ...app, ...show, ...tab, ...filterWhere(query.filter), ...search },
      orderBy: { lastActivityAt: "desc" },
      take: LIST_MAX,
    }),
    countFilters({ ...app, ...show }),
    unreadCount(),
    loadCommentsState(),
    openId ? loadThread(openId) : Promise.resolve(null),
  ]);

  return {
    threads: await toThreadRows(rows),
    counts,
    unread,
    open,
    ranAt: state.ranAt,
    errors: state.errors,
    messageErrors: state.messageErrors,
    setUp: SOCIAL_PLATFORMS.filter((p) => PLATFORMS[p].missingEnv().length === 0),
  };
}

/**
 * Threads' top rows as the list shows them, with their reply counts and our posts.
 * @param rows - Top rows.
 * @returns The list rows, in the same order.
 */
async function toThreadRows(rows: SocialComment[]): Promise<InboxThreadRow[]> {
  const [replyCounts, posts] = await Promise.all([
    prisma.socialComment.groupBy({
      by: ["platform", "threadExternalId"],
      where: { threadExternalId: { in: rows.map((r) => r.externalId) }, goneAt: null },
      _count: { _all: true },
    }),
    postInfo(rows.map((r) => r.postId)),
  ]);
  const repliesOf = new Map(
    replyCounts.map((g) => [`${g.platform}:${g.threadExternalId}`, g._count._all]),
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    kind: r.kind,
    author: authorLabel(r.platform, r.authorName, r.fromUs),
    snippet: snippet(r.text) || (r.rating ? "Stars only, no words" : ""),
    rating: r.rating,
    lastActivityAt: (r.lastActivityAt ?? r.postedAt).toISOString(),
    unread: r.readAt === null,
    needsReply: r.needsReply === true,
    replied: r.repliedAt !== null,
    hidden: r.hidden === true,
    replies: repliesOf.get(`${r.platform}:${r.externalId}`) ?? 0,
    imageUrl: pictureOf(r.objectImageUrl, r.postId ? posts.get(r.postId) : undefined),
    postName: r.postId ? (posts.get(r.postId)?.name ?? null) : null,
  }));
}

/** The Overview's New comments and messages card. */
export interface InboxSummary {
  unread: number;
  needsReply: number;
  /** The newest unread threads. */
  latest: InboxThreadRow[];
  /** Apps whose read failed. */
  failing: SocialPlatformKey[];
}

/** Most threads the Overview card names. */
const SUMMARY_MAX = 4;

/**
 * Loads the Overview's New comments and messages card.
 * @returns The summary; an empty one when the read fails, so the Overview still opens.
 */
export async function loadInboxSummary(): Promise<InboxSummary> {
  try {
    const inbox = { ...TOP, archivedAt: null };
    const [unread, needsReply, rows, state] = await Promise.all([
      unreadCount(),
      prisma.socialComment.count({ where: { ...inbox, ...filterWhere("needs-reply") } }),
      prisma.socialComment.findMany({
        where: { ...inbox, readAt: null },
        orderBy: { lastActivityAt: "desc" },
        take: SUMMARY_MAX,
      }),
      loadCommentsState(),
    ]);
    return {
      unread,
      needsReply,
      latest: await toThreadRows(rows),
      failing: SOCIAL_PLATFORMS.filter(
        (p) => state.errors[p] || (p !== "google" && state.messageErrors[p]),
      ),
    };
  } catch (error) {
    console.error("[inbox] summary failed:", error);
    return { unread: 0, needsReply: 0, latest: [], failing: [] };
  }
}

/**
 * How many inbox threads each filter holds.
 * @param scope - The app and kinds parts of the query.
 * @returns The counts.
 */
async function countFilters(
  scope: Prisma.SocialCommentWhereInput,
): Promise<Record<InboxFilter, number>> {
  const base = { ...TOP, ...scope, archivedAt: null };
  const [all, needsReply, replied, hidden] = await Promise.all([
    prisma.socialComment.count({ where: base }),
    prisma.socialComment.count({ where: { ...base, ...filterWhere("needs-reply") } }),
    prisma.socialComment.count({ where: { ...base, ...filterWhere("replied") } }),
    prisma.socialComment.count({ where: { ...base, ...filterWhere("hidden") } }),
  ]);
  return { all, "needs-reply": needsReply, replied, hidden };
}

/** What the inbox shows of one of our posts. */
interface PostInfo {
  name: string;
  picture: string | null;
}

/**
 * Our posts' names and pictures (a video's cover frame, else picture 1).
 * @param ids - Post ids, nulls skipped.
 * @returns Info by id.
 */
async function postInfo(ids: (string | null)[]): Promise<Map<string, PostInfo>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const posts = await prisma.socialPost.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, imageUrl: true, video: true },
  });
  return new Map(
    posts.map((p) => [p.id, { name: p.name, picture: p.video?.coverUrl ?? p.imageUrl ?? null }]),
  );
}

/**
 * The picture to show for a thread's post. The site's image policy only lets in our own Blob
 * pictures, and the apps' picture links are signed and run out, so an app's picture shows only
 * when it's one of ours.
 * @param appPicture - The picture the app gave.
 * @param post - Our post, when the comment is on one made here.
 * @returns A picture address, or null.
 */
function pictureOf(appPicture: string | null, post: PostInfo | undefined): string | null {
  if (post?.picture && isBlobImageUrl(post.picture)) return post.picture;
  return appPicture && isBlobImageUrl(appPicture) ? appPicture : null;
}

/**
 * Loads one thread with every message, oldest first. A reply's id opens its thread. A
 * conversation's top row stands for the person, so only its messages are listed.
 * @param id - Our id for any message in it.
 * @returns The thread, or null when there's no such message.
 */
export async function loadThread(id: string): Promise<InboxThreadDetail | null> {
  const any = await prisma.socialComment.findUnique({
    where: { id },
    select: { platform: true, externalId: true, threadExternalId: true },
  });
  if (!any) return null;
  const root = any.threadExternalId ?? any.externalId;
  const rows = await prisma.socialComment.findMany({
    where: {
      platform: any.platform,
      OR: [{ externalId: root }, { threadExternalId: root }],
    },
    orderBy: { postedAt: "asc" },
  });
  const top = rows.find((r) => r.externalId === root);
  if (!top) return null;
  const posts = await postInfo([top.postId]);
  const post = top.postId ? posts.get(top.postId) : undefined;
  const conversation = top.kind === "conversation";
  // A comment or review first, then replies in time order.
  const messages = conversation
    ? rows.filter((r) => r.id !== top.id)
    : [top, ...rows.filter((r) => r.id !== top.id)];
  const until = conversation
    ? replyOpenUntil(
        messages.map((r) => ({ fromUs: r.fromUs, postedAt: r.postedAt, gone: r.goneAt !== null })),
      )
    : null;
  return {
    id: top.id,
    platform: top.platform,
    kind: top.kind,
    read: top.readAt !== null,
    archived: top.archivedAt !== null,
    needsReply: top.needsReply === true,
    gone: top.goneAt !== null,
    with: conversation ? authorLabel(top.platform, top.authorName, false) : null,
    openUntil: until?.toISOString() ?? null,
    post: {
      id: top.postId,
      name: post?.name ?? null,
      text: top.objectText,
      imageUrl: pictureOf(top.objectImageUrl, post),
      url: top.objectUrl,
    },
    messages: messages.map((r) => ({
      id: r.id,
      kind: r.kind,
      fromUs: r.fromUs,
      author: authorLabel(r.platform, r.authorName, r.fromUs),
      authorName: r.authorName,
      text: r.text,
      rating: r.rating,
      postedAt: r.postedAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      hidden: r.hidden === true,
      gone: r.goneAt !== null,
    })),
  };
}
