// src/features/social/lib/inbox/sync.server.ts
// The inbox sync: reads comments on the Page's Facebook posts and Instagram media from the last
// 60 days (only posts whose count moved), Google reviews newest first back to the last one read,
// and Messenger and Instagram conversations changed since the last read, keeping them as
// SocialComment rows with each thread's inbox state. The sync-social cron and the Inbox's Refresh
// share one run lock, so they never read at once.

import { readReviews } from "@/features/social/lib/google-business";
import {
  conversationRows,
  countKey,
  facebookRows,
  googleRows,
  INSTAGRAM_DM_URL,
  instagramRows,
  isDirect,
  marksAfterSync,
  MESSAGING_PLATFORMS,
  objectsToRead,
  pruneCounts,
  readCommentsState,
  threadState,
  type CommentRow,
  type CommentsState,
  type FacebookComment,
  type GoogleReview,
  type InstagramComment,
  type MessagingPlatform,
  type MetaConversation,
} from "@/features/social/lib/inbox/map";
import { metaProblem, scopeIn } from "@/features/social/lib/insights/metrics";
import { accountVisible, graph, GraphError, metaConfig } from "@/features/social/lib/meta-graph";
import { PLATFORMS } from "@/features/social/lib/platforms";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import type { SocialComment } from "@prisma/client";

const LOCK_KEY = "social:commentsSync";
const STATE_KEY = "social:commentsState";
/** A run stops starting new reads after this long; the next run carries on. */
const BUDGET_MS = 90_000;
/** Posts older than this aren't read for comments. */
const WINDOW_MS = 60 * 24 * 3_600_000;
/** Most posts whose comments one app reads in a run. */
const MAX_OBJECTS = 30;
/** Pages of comments read per post; a post with more isn't checked for deleted ones. */
const MAX_COMMENT_PAGES = 5;
/** Pages of reviews read on a full read (50 each). */
const MAX_REVIEW_PAGES = 20;
/** A Refresh press within this long of the last read is turned away. */
export const REFRESH_EVERY_MS = 2 * 60_000;
/** Pages of conversations (25 each) read per app in a run. */
const MAX_CONVERSATION_PAGES = 4;
/**
 * Messages read per conversation, newest first. The conversations list nests at most this many,
 * so a longer conversation keeps the older messages already stored.
 */
const MESSAGES_PER_CONVERSATION = 20;
/**
 * Conversations changed within this long are read again every run, whatever the mark says, so a
 * message the sender unsent leaves the inbox even if Meta doesn't move the conversation's time.
 */
const RECHECK_MS = 7 * 24 * 3_600_000;
const MESSAGE_FIELDS = "id,created_time,from,message,attachments{mime_type},sticker,story,shares";

/**
 * How a run went: rows written per app, or why its read failed. Messages are keyed
 * "facebook:messages" and "instagram:messages".
 */
export type CommentsSyncResult = Partial<
  Record<SocialPlatformKey | `${MessagingPlatform}:messages`, number | string>
>;

/** A page of a Graph list. */
interface Paged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** The post a thread is on, as the app gave it. */
interface ObjectInfo {
  text: string | null;
  imageUrl: string | null;
  url: string | null;
}

/** What one write of rows covers. */
interface KeepOpts {
  now: Date;
  firstRun: boolean;
  /**
   * Messages this read saw all of: everything on a post, or everything in some threads (with
   * `after`, only their messages after that time, as a long chat's newest were read). Stored
   * ones it didn't see are gone. Null when the read stopped early.
   */
  complete: { objectExternalId: string } | { threadIds: string[]; after?: Date } | null;
  object?: ObjectInfo | null;
  postId?: string | null;
}

/**
 * Reads the sync's record.
 * @returns The state, fresh when there's none.
 */
export async function loadCommentsState(): Promise<CommentsState> {
  const row = await prisma.setting.findFirst({
    where: { key: STATE_KEY },
    select: { value: true },
  });
  return readCommentsState(row?.value);
}

/**
 * Saves the sync's record.
 * @param state - The state.
 */
async function saveState(state: CommentsState): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
}

/**
 * Runs the sync for every app that's set up: comments or reviews, then messages. One read
 * failing doesn't stop the others; its reason is kept for the Inbox to show.
 * @param now - Now.
 * @param opts - How long to keep starting reads.
 * @param opts.budgetMs - The budget.
 * @returns How it went, or null when another run holds the lock.
 */
export async function syncComments(
  now: Date,
  opts: { budgetMs?: number } = {},
): Promise<CommentsSyncResult | null> {
  if (!(await acquireRunLock(LOCK_KEY, 5 * 60_000))) return null;
  try {
    const deadline = Date.now() + (opts.budgetMs ?? BUDGET_MS);
    const state = await loadCommentsState();
    const result: CommentsSyncResult = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const messaging = (MESSAGING_PLATFORMS as readonly string[]).includes(platform)
        ? (platform as MessagingPlatform)
        : null;
      if (PLATFORMS[platform].missingEnv().length > 0) {
        delete state.errors[platform];
        if (messaging) delete state.messageErrors[messaging];
        continue;
      }
      if (Date.now() > deadline) break;
      // Per app and per kind, so an app whose permission arrives later doesn't fill the inbox
      // with months.
      const firstRun = !(await prisma.socialComment.findFirst({
        where: { platform, kind: { notIn: ["conversation", "message"] } },
        select: { id: true },
      }));
      try {
        const ctx = { state, now, firstRun, deadline };
        result[platform] =
          platform === "google"
            ? await syncGoogle(ctx)
            : platform === "facebook"
              ? await syncFacebook(ctx)
              : await syncInstagram(ctx);
        delete state.errors[platform];
      } catch (error) {
        const message = readableError(error);
        console.error(`[inbox/sync] ${platform} failed:`, message);
        result[platform] = message;
        state.errors[platform] = message;
      }
      if (!messaging || Date.now() > deadline) continue;
      try {
        const firstMessages = !(await prisma.socialComment.findFirst({
          where: { platform, kind: "conversation" },
          select: { id: true },
        }));
        result[`${messaging}:messages`] = await syncMessages(messaging, {
          state,
          now,
          firstRun: firstMessages,
          deadline,
        });
        delete state.messageErrors[messaging];
      } catch (error) {
        const message = readableError(error);
        console.error(`[inbox/sync] ${platform} messages failed:`, message);
        result[`${messaging}:messages`] = message;
        state.messageErrors[messaging] = message;
      }
    }
    state.ranAt = now.toISOString();
    await saveState(state);
    return result;
  } finally {
    await releaseRunLock(LOCK_KEY);
  }
}

/** What each app's read is given. */
interface SyncCtx {
  state: CommentsState;
  now: Date;
  firstRun: boolean;
  deadline: number;
}

/**
 * Turns a failed read into words for the Inbox, naming the permission Meta asks for.
 * @param error - What the read threw.
 * @returns The reason.
 */
export function readableError(error: unknown): string {
  if (error instanceof GraphError && metaProblem(error.code, error.raw) === "permission") {
    const scope = scopeIn(error.raw);
    return scope
      ? `Needs the ${scope} permission, which the Meta token doesn't have.`
      : "Needs a permission the Meta token doesn't have.";
  }
  return error instanceof Error ? error.message : "The read failed.";
}

// --- Facebook ---

interface FacebookPost {
  id?: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  comments?: { summary?: { total_count?: number } };
}

/**
 * Reads comments on the Page's recent posts whose count moved.
 * @param ctx - The run.
 * @returns Messages written.
 */
async function syncFacebook(ctx: SyncCtx): Promise<number> {
  const { pageId } = metaConfig();
  if (!pageId) throw new Error("META_PAGE_ID isn't set.");
  const since = String(Math.floor((ctx.now.getTime() - WINDOW_MS) / 1000));
  const posts: FacebookPost[] = [];
  let after: string | undefined;
  for (let page = 0; page < 4; page++) {
    const res = await graph<Paged<FacebookPost>>(`/${pageId}/posts`, "GET", {
      fields:
        "id,message,full_picture,permalink_url,comments.filter(stream).limit(0).summary(true)",
      since,
      limit: "50",
      ...(after ? { after } : {}),
    });
    posts.push(...(res.data ?? []));
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after) break;
  }
  const objects = posts.flatMap((p) =>
    p.id ? [{ id: p.id, count: p.comments?.summary?.total_count ?? 0 }] : [],
  );
  const info = new Map(posts.map((p) => [p.id, p]));
  const postIds = await ourPosts(
    "facebook",
    objects.map((o) => o.id),
  );

  let written = 0;
  for (const id of objectsToRead("facebook", objects, ctx.state.counts).slice(0, MAX_OBJECTS)) {
    if (Date.now() > ctx.deadline) break;
    const post = info.get(id);
    try {
      const { items, complete } = await readAll<FacebookComment>(`/${id}/comments`, {
        fields: "id,message,created_time,from{id,name},parent{id},is_hidden",
        filter: "stream",
        order: "chronological",
        limit: "100",
      });
      written += await keepRows("facebook", facebookRows(items, id, pageId), {
        now: ctx.now,
        firstRun: ctx.firstRun,
        complete: complete ? { objectExternalId: id } : null,
        object: {
          text: post?.message?.trim() || null,
          imageUrl: post?.full_picture ?? null,
          url: post?.permalink_url ?? null,
        },
        postId: postIds.get(id) ?? null,
      });
      ctx.state.counts[countKey("facebook", id)] = objects.find((o) => o.id === id)?.count ?? 0;
    } catch (error) {
      if (!(await markObjectGone("facebook", id, error, ctx))) throw error;
    }
  }
  ctx.state.counts = pruneCounts(
    ctx.state.counts,
    "facebook",
    objects.map((o) => o.id),
  );
  return written;
}

// --- Instagram ---

interface InstagramMedia {
  id?: string;
  timestamp?: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  comments_count?: number;
}

/**
 * Reads comments on the account's recent media whose count moved.
 * @param ctx - The run.
 * @returns Messages written.
 */
async function syncInstagram(ctx: SyncCtx): Promise<number> {
  const { igAccountId } = metaConfig();
  if (!igAccountId) throw new Error("INSTAGRAM_ACCOUNT_ID isn't set.");
  const account = await graph<{ username?: string }>(`/${igAccountId}`, "GET", {
    fields: "username",
  });
  const us = { id: igAccountId, username: account.username ?? null };
  const oldest = ctx.now.getTime() - WINDOW_MS;
  const media: InstagramMedia[] = [];
  let after: string | undefined;
  for (let page = 0; page < 4; page++) {
    const res = await graph<Paged<InstagramMedia>>(`/${igAccountId}/media`, "GET", {
      fields: "id,timestamp,caption,media_url,thumbnail_url,permalink,comments_count",
      limit: "50",
      ...(after ? { after } : {}),
    });
    const list = res.data ?? [];
    media.push(...list.filter((m) => m.timestamp && Date.parse(m.timestamp) >= oldest));
    const last = list.at(-1)?.timestamp;
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after || (last && Date.parse(last) < oldest)) break;
  }
  const objects = media.flatMap((m) => (m.id ? [{ id: m.id, count: m.comments_count ?? 0 }] : []));
  const info = new Map(media.map((m) => [m.id, m]));
  const postIds = await ourPosts(
    "instagram",
    objects.map((o) => o.id),
  );
  const replyFields = "id,text,timestamp,username,hidden,from{id,username}";

  let written = 0;
  for (const id of objectsToRead("instagram", objects, ctx.state.counts).slice(0, MAX_OBJECTS)) {
    if (Date.now() > ctx.deadline) break;
    const item = info.get(id);
    try {
      const { items, complete } = await readAll<InstagramComment>(`/${id}/comments`, {
        fields: `${replyFields},replies.limit(50){${replyFields}}`,
        limit: "50",
      });
      written += await keepRows(
        "instagram",
        items.flatMap((c) => instagramRows(c, id, us)),
        {
          now: ctx.now,
          firstRun: ctx.firstRun,
          complete: complete ? { objectExternalId: id } : null,
          object: {
            text: item?.caption?.trim() || null,
            imageUrl: item?.thumbnail_url ?? item?.media_url ?? null,
            url: item?.permalink ?? null,
          },
          postId: postIds.get(id) ?? null,
        },
      );
      ctx.state.counts[countKey("instagram", id)] = objects.find((o) => o.id === id)?.count ?? 0;
    } catch (error) {
      if (!(await markObjectGone("instagram", id, error, ctx))) throw error;
    }
  }
  ctx.state.counts = pruneCounts(
    ctx.state.counts,
    "instagram",
    objects.map((o) => o.id),
  );
  return written;
}

/**
 * Reads every page of a Graph list, up to {@link MAX_COMMENT_PAGES}.
 * @param path - The list's path.
 * @param params - Its parameters.
 * @returns The items, and whether the list ended before the page cap.
 */
async function readAll<T>(
  path: string,
  params: Record<string, string>,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const res = await graph<Paged<T>>(path, "GET", { ...params, ...(after ? { after } : {}) });
    items.push(...(res.data ?? []));
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * When a post's comments can't be read because the post is gone, marks its comments gone and
 * forgets its count.
 * @param platform - The app.
 * @param objectId - The post or media.
 * @param error - What the read threw.
 * @param ctx - The run.
 * @returns True when the error was the post being gone.
 */
async function markObjectGone(
  platform: "facebook" | "instagram",
  objectId: string,
  error: unknown,
  ctx: SyncCtx,
): Promise<boolean> {
  if (!(error instanceof GraphError) || metaProblem(error.code, error.raw) !== "gone") {
    return false;
  }
  // Lost access reads the same as a deleted post, so only a visible account confirms it.
  if (!(await accountVisible(platform))) return false;
  await keepRows(platform, [], {
    now: ctx.now,
    firstRun: ctx.firstRun,
    complete: { objectExternalId: objectId },
  });
  delete ctx.state.counts[countKey(platform, objectId)];
  return true;
}

/**
 * Our posts behind some Facebook posts or Instagram media.
 * @param platform - The app.
 * @param objectIds - The app's ids.
 * @returns Our post id by the app's id.
 */
async function ourPosts(
  platform: "facebook" | "instagram",
  objectIds: string[],
): Promise<Map<string, string>> {
  if (objectIds.length === 0) return new Map();
  const posts = await prisma.socialPost.findMany({
    where: { targets: { some: { platform, externalId: { in: objectIds } } } },
    select: { id: true, targets: true },
  });
  const out = new Map<string, string>();
  for (const post of posts) {
    for (const t of post.targets) {
      if (t.platform === platform && t.externalId) out.set(t.externalId, post.id);
    }
  }
  return out;
}

// --- Google ---

/**
 * Reads reviews newest change first, back to the last one read. A full read (the first, or when
 * Google counts fewer reviews than before) also marks reviews no longer listed as gone.
 * @param ctx - The run.
 * @returns Messages written.
 */
async function syncGoogle(ctx: SyncCtx): Promise<number> {
  const seen = ctx.state.googleSeen ? Date.parse(ctx.state.googleSeen) : null;
  const reviews: GoogleReview[] = [];
  let full = ctx.firstRun || seen === null;
  let total: number | null = null;
  let pageToken: string | undefined;
  let ended = false;
  for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
    const res = await readReviews(pageToken);
    if (page === 0) {
      total = res.totalReviewCount ?? null;
      if (ctx.state.googleTotal !== null && total !== null && total < ctx.state.googleTotal) {
        full = true;
      }
    }
    const list = res.reviews ?? [];
    reviews.push(...list);
    pageToken = res.nextPageToken;
    if (!pageToken) {
      ended = true;
      break;
    }
    const last = list.at(-1)?.updateTime;
    if (!full && seen !== null && last && Date.parse(last) < seen) break;
    if (Date.now() > ctx.deadline) break;
  }

  const rows = reviews.flatMap(googleRows);
  const names = rows.filter((r) => r.kind === "review").map((r) => r.externalId);
  let written = await keepRows("google", rows, {
    now: ctx.now,
    firstRun: ctx.firstRun,
    complete: { threadIds: names },
  });
  if (full && ended) {
    const gone = await prisma.socialComment.findMany({
      where: { platform: "google", kind: "review", goneAt: null, externalId: { notIn: names } },
      select: { externalId: true },
    });
    if (gone.length > 0) {
      written += await keepRows("google", [], {
        now: ctx.now,
        firstRun: ctx.firstRun,
        complete: { threadIds: gone.map((g) => g.externalId) },
      });
    }
  }
  const newest = reviews.reduce<number>(
    (max, r) => Math.max(max, r.updateTime ? Date.parse(r.updateTime) : 0),
    seen ?? 0,
  );
  ctx.state.googleSeen = newest > 0 ? new Date(newest).toISOString() : null;
  ctx.state.googleTotal = total;
  return written;
}

// --- Messages ---

/**
 * Reads Messenger or Instagram conversations changed since the last read or within the last 7
 * days, whichever reaches further back (the last 60 days on the first run), newest first, with
 * each one's latest messages. The list is sorted by its last change, so the read stops at the
 * first conversation older than that. Reading the last week every time is what drops a message
 * the sender unsent: it's missing from the read, so it's marked gone and its words are cleared.
 * The mark only moves on when the run read everything it found, so a run cut short by the
 * budget is picked up again.
 * @param platform - The app.
 * @param ctx - The run.
 * @returns Rows written.
 */
async function syncMessages(platform: MessagingPlatform, ctx: SyncCtx): Promise<number> {
  const { pageId, igAccountId } = metaConfig();
  if (!pageId) throw new Error("META_PAGE_ID isn't set.");
  const us = platform === "facebook" ? pageId : igAccountId;
  if (!us) throw new Error("INSTAGRAM_ACCOUNT_ID isn't set.");
  const seen = ctx.state.messagesSeen[platform];
  const since = Math.min(
    seen && !ctx.firstRun ? Date.parse(seen) : ctx.now.getTime() - WINDOW_MS,
    ctx.now.getTime() - RECHECK_MS,
  );

  const conversations: MetaConversation[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_CONVERSATION_PAGES; page++) {
    const res = await graph<Paged<MetaConversation>>(`/${pageId}/conversations`, "GET", {
      platform: platform === "facebook" ? "messenger" : "instagram",
      // Instagram gives no link to a conversation.
      fields: `id,updated_time,${platform === "facebook" ? "link," : ""}participants,messages.limit(${MESSAGES_PER_CONVERSATION}){${MESSAGE_FIELDS}}`,
      limit: "25",
      ...(after ? { after } : {}),
    });
    const list = res.data ?? [];
    // Ones read last time come again, which writes nothing unless they changed.
    conversations.push(
      ...list.filter((c) => c.updated_time && Date.parse(c.updated_time) >= since),
    );
    const last = list.at(-1)?.updated_time;
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
    if (!after || (last && Date.parse(last) < since)) break;
  }

  let written = 0;
  let finished = true;
  for (const conv of conversations) {
    if (Date.now() > ctx.deadline) {
      finished = false;
      break;
    }
    if (!conv.id) continue;
    const rows = conversationRows(platform, conv, us);
    const partial = !!conv.messages?.paging?.next;
    if (rows.length === 0) {
      // Every message unsent: the chat leaves the inbox, and comes back if they write again.
      if (!partial) {
        written += await keepRows(platform, [], {
          now: ctx.now,
          firstRun: ctx.firstRun,
          complete: { threadIds: [conv.id] },
        });
      }
      continue;
    }
    written += await keepRows(platform, rows, {
      now: ctx.now,
      firstRun: ctx.firstRun,
      // A long chat only gives its newest messages, so only stored ones newer than the oldest
      // of those can be told apart as unsent. rows[1] is the oldest message read.
      complete: partial
        ? { threadIds: [conv.id], after: rows[1]!.postedAt }
        : { threadIds: [conv.id] },
      object: {
        text: null,
        imageUrl: null,
        url:
          platform === "facebook"
            ? conv.link
              ? `https://www.facebook.com${conv.link}`
              : null
            : INSTAGRAM_DM_URL,
      },
    });
  }
  if (finished) {
    const newest = conversations.reduce<number>(
      (max, c) => Math.max(max, c.updated_time ? Date.parse(c.updated_time) : 0),
      seen ? Date.parse(seen) : 0,
    );
    if (newest > 0) ctx.state.messagesSeen[platform] = new Date(newest).toISOString();
  }
  return written;
}

// --- Writing rows ---

/** The parts of a stored row a fresh read can change. */
type StoredRow = Pick<
  SocialComment,
  | "text"
  | "authorName"
  | "authorId"
  | "fromUs"
  | "rating"
  | "postedAt"
  | "editedAt"
  | "hidden"
  | "threadExternalId"
  | "goneAt"
>;

/**
 * Whether a stored row differs from what the app gives now.
 * @param old - The stored row.
 * @param row - The row as read.
 * @returns True when it needs writing.
 */
function rowChanged(old: StoredRow, row: CommentRow): boolean {
  return (
    old.goneAt !== null ||
    old.text !== row.text ||
    old.authorName !== row.authorName ||
    old.authorId !== row.authorId ||
    old.fromUs !== row.fromUs ||
    old.rating !== row.rating ||
    old.postedAt.getTime() !== row.postedAt.getTime() ||
    (old.editedAt?.getTime() ?? null) !== (row.editedAt?.getTime() ?? null) ||
    old.hidden !== row.hidden ||
    old.threadExternalId !== row.threadExternalId
  );
}

/**
 * Writes what a read saw: new rows, changed rows, gone ones, then each touched thread's state.
 * @param platform - The app.
 * @param rows - The messages read.
 * @param opts - What the read covers.
 * @returns Rows written.
 */
export async function keepRows(
  platform: SocialPlatformKey,
  rows: CommentRow[],
  opts: KeepOpts,
): Promise<number> {
  const ids = rows.map((r) => r.externalId);
  const scope = !opts.complete
    ? []
    : "objectExternalId" in opts.complete
      ? [{ objectExternalId: opts.complete.objectExternalId }]
      : [
          { externalId: { in: opts.complete.threadIds } },
          {
            threadExternalId: { in: opts.complete.threadIds },
            // Strictly after: Meta's times are to the second, so another message in the oldest
            // one's second may simply not have been read.
            ...(opts.complete.after ? { postedAt: { gt: opts.complete.after } } : {}),
          },
        ];
  const existing = await prisma.socialComment.findMany({
    where: { platform, OR: [{ externalId: { in: ids } }, ...scope] },
  });
  const byId = new Map(existing.map((r) => [r.externalId, r]));
  const touched = new Set<string>();
  const created = new Set<string>();
  const fresh: CommentRow[] = [];
  let written = 0;

  for (const row of rows) {
    const old = byId.get(row.externalId);
    const root = row.threadExternalId ?? row.externalId;
    const object =
      row.threadExternalId === null && opts.object
        ? {
            objectText: opts.object.text,
            objectImageUrl: opts.object.imageUrl,
            objectUrl: opts.object.url,
          }
        : null;
    if (!old) {
      fresh.push(row);
      created.add(row.externalId);
      touched.add(root);
      continue;
    }
    const objectMoved =
      !!object &&
      (old.objectText !== object.objectText ||
        old.objectImageUrl !== object.objectImageUrl ||
        old.objectUrl !== object.objectUrl);
    const postMoved = opts.postId !== undefined && old.postId !== opts.postId;
    if (!rowChanged(old, row) && !objectMoved && !postMoved) continue;
    await prisma.socialComment.update({
      where: { id: old.id },
      data: {
        text: row.text,
        authorName: row.authorName,
        authorId: row.authorId,
        fromUs: row.fromUs,
        rating: row.rating,
        postedAt: row.postedAt,
        editedAt: row.editedAt,
        hidden: row.hidden,
        threadExternalId: row.threadExternalId,
        goneAt: null,
        syncedAt: opts.now,
        ...(object ?? {}),
        ...(opts.postId !== undefined ? { postId: opts.postId } : {}),
      },
    });
    touched.add(root);
    written++;
  }

  if (fresh.length > 0) {
    await prisma.socialComment.createMany({
      data: fresh.map((row) => ({
        ...row,
        postId: opts.postId ?? null,
        objectText: row.threadExternalId === null ? (opts.object?.text ?? null) : null,
        objectImageUrl: row.threadExternalId === null ? (opts.object?.imageUrl ?? null) : null,
        objectUrl: row.threadExternalId === null ? (opts.object?.url ?? null) : null,
        lastActivityAt: null,
        needsReply: null,
        repliedAt: null,
        readAt: null,
        archivedAt: null,
        goneAt: null,
        syncedAt: opts.now,
      })),
    });
    written += fresh.length;
  }

  // Gone: in what the read covered, but not seen
  if (opts.complete) {
    const read = new Set(ids);
    const missing = existing.filter((r) => !read.has(r.externalId) && r.goneAt === null);
    if (missing.length > 0) {
      // An unsent message's words aren't kept, as Meta's rules ask; a chat's top row holds a copy.
      for (const chat of [true, false]) {
        const gone = missing.filter((r) => isDirect(r.kind) === chat).map((r) => r.id);
        if (gone.length === 0) continue;
        await prisma.socialComment.updateMany({
          where: { id: { in: gone } },
          data: { goneAt: opts.now, syncedAt: opts.now, ...(chat ? { text: "" } : {}) },
        });
      }
      for (const r of missing) touched.add(r.threadExternalId ?? r.externalId);
      written += missing.length;
    }
  }

  await refreshThreads(platform, [...touched], { ...opts, created });
  return written;
}

/**
 * Works out each thread's inbox state again and stores it on its top-level row.
 * @param platform - The app.
 * @param roots - The threads' top-level ids.
 * @param opts - The run.
 * @param opts.now - Now.
 * @param opts.firstRun - Whether this is the app's first run.
 * @param opts.created - Threads made by this write, which have no marks yet.
 */
export async function refreshThreads(
  platform: SocialPlatformKey,
  roots: string[],
  opts: { now: Date; firstRun: boolean; created?: ReadonlySet<string> },
): Promise<void> {
  if (roots.length === 0) return;
  const all = await prisma.socialComment.findMany({
    where: {
      platform,
      OR: [{ externalId: { in: roots } }, { threadExternalId: { in: roots } }],
    },
    select: {
      id: true,
      kind: true,
      externalId: true,
      threadExternalId: true,
      fromUs: true,
      postedAt: true,
      editedAt: true,
      hidden: true,
      goneAt: true,
      lastActivityAt: true,
      needsReply: true,
      repliedAt: true,
      readAt: true,
      archivedAt: true,
    },
  });
  for (const root of roots) {
    const top = all.find((r) => r.externalId === root);
    // A reply whose top-level comment wasn't read has no thread to keep state on.
    if (!top) continue;
    const thread = all.filter((r) => r.externalId === root || r.threadExternalId === root);
    // A conversation's top row stands for the person, not a message they wrote.
    const said = top.kind === "conversation" ? thread.filter((r) => r.id !== top.id) : thread;
    const state = threadState(
      (said.length > 0 ? said : thread).map((r) => ({
        fromUs: r.fromUs,
        at: r.editedAt ?? r.postedAt,
        hidden: r.hidden,
        gone: r.goneAt !== null,
      })),
    );
    const marks = marksAfterSync(
      opts.created?.has(root) || top.lastActivityAt === null
        ? null
        : { lastActivityAt: top.lastActivityAt, readAt: top.readAt, archivedAt: top.archivedAt },
      state,
      opts,
    );
    const same =
      top.lastActivityAt?.getTime() === state.lastActivityAt.getTime() &&
      top.needsReply === state.needsReply &&
      (top.repliedAt?.getTime() ?? null) === (state.repliedAt?.getTime() ?? null) &&
      (top.readAt?.getTime() ?? null) === (marks.readAt?.getTime() ?? null) &&
      (top.archivedAt?.getTime() ?? null) === (marks.archivedAt?.getTime() ?? null);
    if (same) continue;
    await prisma.socialComment.update({
      where: { id: top.id },
      data: {
        lastActivityAt: state.lastActivityAt,
        needsReply: state.needsReply,
        repliedAt: state.repliedAt,
        readAt: marks.readAt,
        archivedAt: marks.archivedAt,
      },
    });
  }
}
