// src/features/social/lib/inbox/map.ts
// Inbox rules with no I/O: reading Facebook comments, Instagram comments and Google reviews into
// rows, which thread still needs a reply, the inbox's address, the names and snippets the list
// shows with their times, and the brief for making a post from a review.

import { timeAgo } from "@/features/business/lib/calculator-draft";
import { plainPunctuation } from "@/features/mailing/lib/ai-draft";
import { POST_BRIEF_MAX } from "@/features/social-design/lib/ai-draft";
import { SOCIAL_INBOX_PATH } from "@/features/social/lib/links";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/features/social/lib/validate";
import { NZ_TZ } from "@/shared/lib/timezone-utils";

export type InboxKind = "comment" | "reply" | "review";

/**
 * How long after our reply a message must come to count as new. Google can stamp a review a few
 * moments after the reply that changed it, which would otherwise read as the writer answering.
 */
export const REPLY_GRACE_MS = 5 * 60_000;

/** One message as the sync writes it. */
export interface CommentRow {
  platform: SocialPlatformKey;
  kind: InboxKind;
  externalId: string;
  /** The top-level comment or review it answers; null on a top-level row. */
  threadExternalId: string | null;
  /** The post or media a comment is on; null for a review. */
  objectExternalId: string | null;
  authorName: string | null;
  authorId: string | null;
  fromUs: boolean;
  text: string;
  rating: number | null;
  postedAt: Date;
  editedAt: Date | null;
  hidden: boolean | null;
}

// --- Facebook ---

/** A comment as Facebook gives it with `filter=stream`. */
export interface FacebookComment {
  id?: string;
  message?: string;
  created_time?: string;
  /** Missing when the token can't see who wrote it. */
  from?: { id?: string; name?: string };
  parent?: { id?: string };
  is_hidden?: boolean;
}

/**
 * Reads one post's comments. `filter=stream` lists replies flat with their parent; a reply to a
 * reply is threaded under the top-level comment it hangs from, as Facebook shows it.
 * @param comments - Facebook's list.
 * @param objectId - The post or video they're on.
 * @param pageId - The Page's id, which marks our own replies.
 * @returns The rows, top-level and replies.
 */
export function facebookRows(
  comments: readonly FacebookComment[],
  objectId: string,
  pageId: string | null,
): CommentRow[] {
  const parentOf = new Map<string, string | null>();
  for (const c of comments) if (c.id) parentOf.set(c.id, c.parent?.id ?? null);

  /**
   * The top-level comment a comment hangs from.
   * @param id - A comment id.
   * @returns The top-level id, or null when the comment is top-level itself.
   */
  function rootOf(id: string): string | null {
    let parent = parentOf.get(id) ?? null;
    // Bounded so a loop in a bad answer can't hang the sync.
    for (let hops = 0; parent && hops < 10; hops++) {
      const next = parentOf.get(parent);
      if (!next) return parent;
      parent = next;
    }
    return parent;
  }

  return comments.flatMap((c) => {
    if (!c.id || !c.created_time) return [];
    const thread = rootOf(c.id);
    return [
      {
        platform: "facebook" as const,
        kind: thread ? ("reply" as const) : ("comment" as const),
        externalId: c.id,
        threadExternalId: thread,
        objectExternalId: objectId,
        authorName: c.from?.name?.trim() || null,
        authorId: c.from?.id ?? null,
        fromUs: !!pageId && c.from?.id === pageId,
        text: c.message?.trim() ?? "",
        rating: null,
        postedAt: new Date(c.created_time),
        editedAt: null,
        hidden: c.is_hidden ?? null,
      },
    ];
  });
}

// --- Instagram ---

/** A comment as Instagram gives it, with its replies nested. */
export interface InstagramComment {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  hidden?: boolean;
  from?: { id?: string; username?: string };
  replies?: { data?: InstagramComment[] };
}

/**
 * Reads one Instagram comment and its replies (Instagram threads are one deep).
 * @param comment - Instagram's comment.
 * @param mediaId - The media it's on.
 * @param us - Our account's id and username, which mark our own replies.
 * @param us.id - The Instagram account id.
 * @param us.username - Its username, or null when it couldn't be read.
 * @returns The comment's row, then its replies'.
 */
export function instagramRows(
  comment: InstagramComment,
  mediaId: string,
  us: { id: string | null; username: string | null },
): CommentRow[] {
  /**
   * Reads one comment or reply.
   * @param c - Instagram's comment.
   * @param thread - The top-level comment, for a reply.
   * @returns The row, or null when it lacks an id or time.
   */
  function row(c: InstagramComment, thread: string | null): CommentRow | null {
    if (!c.id || !c.timestamp) return null;
    const username = c.from?.username ?? c.username ?? null;
    return {
      platform: "instagram",
      kind: thread ? "reply" : "comment",
      externalId: c.id,
      threadExternalId: thread,
      objectExternalId: mediaId,
      authorName: username,
      authorId: c.from?.id ?? null,
      fromUs:
        (!!us.id && c.from?.id === us.id) ||
        (!!us.username && username?.toLowerCase() === us.username.toLowerCase()),
      text: c.text?.trim() ?? "",
      rating: null,
      postedAt: new Date(c.timestamp),
      editedAt: null,
      hidden: c.hidden ?? null,
    };
  }
  const top = row(comment, null);
  if (!top) return [];
  const replies = (comment.replies?.data ?? []).map((r) => row(r, top.externalId));
  return [top, ...replies.filter((r): r is CommentRow => r !== null)];
}

// --- Google ---

/** A review as the Business Profile v4 API gives it. */
export interface GoogleReview {
  name?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

/** Google's star words as numbers. */
export const GOOGLE_STARS: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

/** Google moves a review's updateTime by a moment on its own; a smaller change isn't an edit. */
const EDIT_MIN_MS = 60_000;

/**
 * Reads a review and our reply to it, if any. A review whose writer changed it carries editedAt;
 * a change that lands with our reply is Google stamping the reply, not an edit.
 * @param review - Google's review.
 * @returns The review's row, then the reply's.
 */
export function googleRows(review: GoogleReview): CommentRow[] {
  if (!review.name || !review.createTime) return [];
  const created = new Date(review.createTime);
  const updated = review.updateTime ? new Date(review.updateTime) : null;
  const replied = review.reviewReply?.updateTime ? new Date(review.reviewReply.updateTime) : null;
  const edited =
    !!updated &&
    updated.getTime() - created.getTime() > EDIT_MIN_MS &&
    !(replied && Math.abs(updated.getTime() - replied.getTime()) <= REPLY_GRACE_MS);
  const rows: CommentRow[] = [
    {
      platform: "google",
      kind: "review",
      externalId: review.name,
      threadExternalId: null,
      objectExternalId: null,
      authorName: review.reviewer?.isAnonymous
        ? null
        : review.reviewer?.displayName?.trim() || null,
      authorId: null,
      fromUs: false,
      text: review.comment?.trim() ?? "",
      rating: GOOGLE_STARS[review.starRating ?? ""] ?? null,
      postedAt: created,
      editedAt: edited ? updated : null,
      hidden: null,
    },
  ];
  const reply = review.reviewReply;
  if (reply?.comment?.trim()) {
    rows.push({
      platform: "google",
      kind: "reply",
      externalId: `${review.name}/reply`,
      threadExternalId: review.name,
      objectExternalId: null,
      authorName: null,
      authorId: null,
      fromUs: true,
      text: reply.comment.trim(),
      rating: null,
      postedAt: replied ?? updated ?? created,
      editedAt: null,
      hidden: null,
    });
  }
  return rows;
}

// --- Threads ---

/** One message of a thread, as the needs-reply rule reads it. */
export interface ThreadMessage {
  fromUs: boolean;
  /** When it was written or last changed. */
  at: Date;
  hidden: boolean | null;
  gone: boolean;
}

/** The inbox state worked out from a thread. */
export interface ThreadState {
  lastActivityAt: Date;
  needsReply: boolean;
  /** Our latest reply. */
  repliedAt: Date | null;
  /** Someone else's latest message that's still showing. */
  theirsAt: Date | null;
}

/**
 * Works out a thread's inbox state: it needs a reply when someone else's latest message, hidden
 * and deleted ones left out, came after our latest reply.
 * @param messages - Every message in the thread, the top-level one included.
 * @returns The state.
 */
export function threadState(messages: readonly ThreadMessage[]): ThreadState {
  const live = messages.filter((m) => !m.gone);
  const pool = live.length > 0 ? live : messages;
  /**
   * The latest time among some messages.
   * @param list - The messages.
   * @returns The time, or null for none.
   */
  const latest = (list: readonly ThreadMessage[]): Date | null =>
    list.reduce<Date | null>((max, m) => (max && max >= m.at ? max : m.at), null);
  const repliedAt = latest(live.filter((m) => m.fromUs));
  const theirs = latest(live.filter((m) => !m.fromUs && !m.hidden));
  return {
    lastActivityAt: latest(pool) ?? new Date(0),
    needsReply: isAfterReply(theirs, repliedAt),
    repliedAt,
    theirsAt: theirs,
  };
}

/**
 * Whether someone else's message came after our reply, past the grace.
 * @param theirs - Their latest message.
 * @param repliedAt - Our latest reply.
 * @returns True when theirs is the newer.
 */
function isAfterReply(theirs: Date | null, repliedAt: Date | null): boolean {
  return (
    theirs !== null &&
    (repliedAt === null || theirs.getTime() > repliedAt.getTime() + REPLY_GRACE_MS)
  );
}

/** A thread's read and archive marks. */
export interface ThreadMarks {
  readAt: Date | null;
  archivedAt: Date | null;
}

/** Threads older than this come in as read on the first run, so the inbox doesn't open on years. */
export const FIRST_RUN_UNREAD_MS = 14 * 24 * 3_600_000;

/**
 * How a sync changes a thread's marks: something new from someone else brings it back unread and
 * out of the archive; a new thread is unread unless it's only ours, or old on the first run.
 * @param prev - The thread as stored, or null when it's new.
 * @param prev.lastActivityAt - Its last activity as stored.
 * @param prev.readAt - When it was read.
 * @param prev.archivedAt - When it was archived.
 * @param state - The thread as read now.
 * @param ctx - The run.
 * @param ctx.now - Now.
 * @param ctx.firstRun - Whether this is the first run.
 * @returns The marks to keep.
 */
export function marksAfterSync(
  prev: { lastActivityAt: Date | null; readAt: Date | null; archivedAt: Date | null } | null,
  state: ThreadState,
  ctx: { now: Date; firstRun: boolean },
): ThreadMarks {
  const { theirsAt } = state;
  if (prev === null) {
    const old =
      ctx.firstRun &&
      theirsAt !== null &&
      ctx.now.getTime() - theirsAt.getTime() > FIRST_RUN_UNREAD_MS;
    return { readAt: theirsAt === null || old ? ctx.now : null, archivedAt: null };
  }
  const fresh =
    theirsAt !== null &&
    (prev.lastActivityAt === null || theirsAt > prev.lastActivityAt) &&
    isAfterReply(theirsAt, state.repliedAt);
  return fresh
    ? { readAt: null, archivedAt: null }
    : { readAt: prev.readAt, archivedAt: prev.archivedAt };
}

// --- The sync's record ---

/** What the comments sync keeps between runs. */
export interface CommentsState {
  ranAt: string | null;
  /** Comment counts last read, keyed by {@link countKey}. */
  counts: Record<string, number>;
  /** How many reviews Google counted last time; fewer means one went. */
  googleTotal: number | null;
  /** The newest review change read, as ISO; later runs read back to it. */
  googleSeen: string | null;
  /** Why an app's read failed, by app. */
  errors: Partial<Record<SocialPlatformKey, string>>;
}

/**
 * The key a post's comment count is kept under.
 * @param platform - The app.
 * @param objectId - The post or media id.
 * @returns The key.
 */
export function countKey(platform: SocialPlatformKey, objectId: string): string {
  return `${platform}:${objectId}`;
}

/**
 * Reads the stored record.
 * @param raw - The Setting's value.
 * @returns The record, fresh when there's none or it doesn't parse.
 */
export function readCommentsState(raw: string | null | undefined): CommentsState {
  const empty: CommentsState = {
    ranAt: null,
    counts: {},
    googleTotal: null,
    googleSeen: null,
    errors: {},
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<CommentsState>;
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.counts ?? {})) {
      if (Number.isInteger(value) && value >= 0) counts[key] = value;
    }
    const errors: CommentsState["errors"] = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const message = parsed.errors?.[platform];
      if (typeof message === "string") errors[platform] = message;
    }
    return {
      ranAt: typeof parsed.ranAt === "string" ? parsed.ranAt : null,
      counts,
      googleTotal: Number.isInteger(parsed.googleTotal) ? (parsed.googleTotal as number) : null,
      googleSeen: typeof parsed.googleSeen === "string" ? parsed.googleSeen : null,
      errors,
    };
  } catch {
    return empty;
  }
}

/**
 * The posts whose comments need reading: the count moved since the last read, or a post not
 * read before has some.
 * @param platform - The app.
 * @param objects - The posts with their counts now.
 * @param counts - The counts last read.
 * @returns The post ids, in the order given.
 */
export function objectsToRead(
  platform: SocialPlatformKey,
  objects: readonly { id: string; count: number }[],
  counts: Readonly<Record<string, number>>,
): string[] {
  return objects
    .filter((o) => {
      const before = counts[countKey(platform, o.id)];
      return before === undefined ? o.count > 0 : before !== o.count;
    })
    .map((o) => o.id);
}

/**
 * Drops an app's counts for posts no longer read, so the record doesn't grow forever.
 * @param counts - The counts.
 * @param platform - The app.
 * @param keep - The post ids still read.
 * @returns The counts left.
 */
export function pruneCounts(
  counts: Readonly<Record<string, number>>,
  platform: SocialPlatformKey,
  keep: Iterable<string>,
): Record<string, number> {
  const kept = new Set([...keep].map((id) => countKey(platform, id)));
  return Object.fromEntries(
    Object.entries(counts).filter(([key]) => !key.startsWith(`${platform}:`) || kept.has(key)),
  );
}

// --- Replies ---

/** Longest reply each app takes. */
export const REPLY_MAX: Record<SocialPlatformKey, number> = {
  facebook: 8000,
  instagram: 2200,
  google: 4000,
};

/**
 * What's wrong with a reply before it's sent.
 * @param platform - The app.
 * @param text - The reply.
 * @returns The problem, or null when it can go.
 */
export function replyProblem(platform: SocialPlatformKey, text: string): string | null {
  const reply = text.trim();
  if (!reply) return "Write a reply first.";
  if (reply.length > REPLY_MAX[platform]) {
    return `Keep it to ${REPLY_MAX[platform].toLocaleString("en-NZ")} characters.`;
  }
  return null;
}

/** Longest message, earlier message or post words sent for a suggestion. */
export const REPLY_INPUT_MAX = 2000;

/** What a reply suggestion is wanted for. */
export interface ReplyRequest {
  platform: SocialPlatformKey;
  kind: "comment" | "review";
  /** A review's stars, 1 to 5. */
  rating: number | null;
  /** The writer's name as the app gave it. */
  author: string | null;
  /** The message to answer. */
  text: string;
  /** What was said before it in the thread, oldest first. */
  earlier: { fromUs: boolean; text: string }[];
  /** The words of the post a comment is on. */
  postText: string | null;
}

/**
 * Reads a suggestion request's body, cutting long words to {@link REPLY_INPUT_MAX}.
 * @param raw - The parsed body.
 * @returns The request, or why it can't be read.
 */
export function parseReplyRequest(raw: unknown): ReplyRequest | { error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  /**
   * A string field, trimmed and cut to {@link REPLY_INPUT_MAX}.
   * @param value - The raw field.
   * @returns The words, or null when it's blank or not a string.
   */
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, REPLY_INPUT_MAX) : null;
  const platform = body.platform as SocialPlatformKey;
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    return { error: "Say which app it's on." };
  }
  const kind = body.kind === "review" ? "review" : "comment";
  if (kind === "review" && platform !== "google") return { error: "Only Google has reviews." };
  const rating =
    kind === "review" && Number.isInteger(body.rating) && (body.rating as number) >= 1
      ? Math.min(5, body.rating as number)
      : null;
  const text = str(body.text) ?? "";
  if (!text && rating === null) return { error: "There's nothing to reply to." };
  const earlier = (Array.isArray(body.earlier) ? body.earlier : [])
    .slice(-10)
    .flatMap((m: unknown) => {
      const item = (m ?? {}) as { fromUs?: unknown; text?: unknown };
      const said = str(item.text);
      return said ? [{ fromUs: item.fromUs === true, text: said }] : [];
    });
  return {
    platform,
    kind,
    rating,
    author: str(body.author)?.slice(0, 100) ?? null,
    text,
    earlier,
    postText: str(body.postText),
  };
}

/** A suggested reply. */
export interface ReplySuggestion {
  reply: string;
  /** Whether it reads as spam to hide rather than answer. */
  hide: boolean;
}

/**
 * Reads the AI's answer: plain punctuation, no hashtags, capped to what the app takes.
 * @param raw - The parsed JSON.
 * @param platform - The app it's for.
 * @returns The suggestion.
 */
export function readReplySuggestion(raw: unknown, platform: SocialPlatformKey): ReplySuggestion {
  const value = (raw ?? {}) as { reply?: unknown; hide?: unknown };
  const reply =
    typeof value.reply === "string"
      ? plainPunctuation(value.reply)
          .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/[ \t]{2,}/g, " ")
          .trim()
          .slice(0, REPLY_MAX[platform])
      : "";
  return { reply, hide: value.hide === true };
}

// --- The inbox's address ---

export const INBOX_FILTERS = ["all", "needs-reply", "replied", "hidden"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABEL: Record<InboxFilter, string> = {
  all: "All",
  "needs-reply": "Needs a reply",
  replied: "Replied",
  hidden: "Hidden",
};

export type InboxTab = "inbox" | "archive";
export type InboxApp = SocialPlatformKey | "all";

/** What the inbox's address asks for. */
export interface InboxQuery {
  tab: InboxTab;
  filter: InboxFilter;
  app: InboxApp;
  q: string;
}

/**
 * Reads the inbox's address, falling back to every thread in the inbox.
 * @param params - The search params.
 * @param params.tab - "archive" or anything else.
 * @param params.filter - One of {@link INBOX_FILTERS}.
 * @param params.app - An app key.
 * @param params.q - Words to find.
 * @returns The query.
 */
export function readInboxQuery(params: {
  tab?: string;
  filter?: string;
  app?: string;
  q?: string;
}): InboxQuery {
  return {
    tab: params.tab === "archive" ? "archive" : "inbox",
    filter: (INBOX_FILTERS as readonly string[]).includes(params.filter ?? "")
      ? (params.filter as InboxFilter)
      : "all",
    app: (SOCIAL_PLATFORMS as readonly string[]).includes(params.app ?? "")
      ? (params.app as SocialPlatformKey)
      : "all",
    q: (params.q ?? "").trim().slice(0, 100),
  };
}

/**
 * The inbox's address for a query, leaving out what's already the default.
 * @param query - The query.
 * @param open - A thread to open.
 * @returns The path and search.
 */
export function inboxHref(query: InboxQuery, open?: string | null): string {
  const params = new URLSearchParams();
  if (query.tab !== "inbox") params.set("tab", query.tab);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.app !== "all") params.set("app", query.app);
  if (query.q) params.set("q", query.q);
  if (open) params.set("open", open);
  const search = params.toString();
  return search ? `${SOCIAL_INBOX_PATH}?${search}` : SOCIAL_INBOX_PATH;
}

// --- Names and snippets ---

/**
 * The name to greet someone by: the first word of a Facebook or Google name that reads as a
 * name. Instagram usernames and anonymous writers get none.
 * @param platform - The app.
 * @param authorName - The name the app gave.
 * @returns The first name, or null.
 */
export function firstName(platform: SocialPlatformKey, authorName: string | null): string | null {
  if (platform === "instagram" || !authorName) return null;
  const first = authorName.trim().split(/\s+/)[0] ?? "";
  return /^\p{Lu}[\p{L}'-]{1,30}$/u.test(first) ? first : null;
}

/**
 * Who wrote a message, as the inbox shows it.
 * @param platform - The app.
 * @param authorName - The name the app gave.
 * @param fromUs - Whether it's ours.
 * @returns The name to show.
 */
export function authorLabel(
  platform: SocialPlatformKey,
  authorName: string | null,
  fromUs: boolean,
): string {
  if (fromUs) return "You";
  if (authorName) return platform === "instagram" ? `@${authorName}` : authorName;
  return platform === "google" ? "A Google user" : "Someone";
}

/**
 * A message cut to a line for the list.
 * @param text - The message.
 * @param max - Most characters.
 * @returns The snippet.
 */
export function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}...` : flat;
}

/**
 * The Post maker's Draft with AI brief for sharing a review: its words as written, then who left
 * it by first name only (as the review kind's example asks) and its stars, like "Mary, Google
 * review, 5 stars". Long reviews are cut to fit.
 * @param text - The review's words.
 * @param authorName - The name Google gave.
 * @param rating - Its stars.
 * @returns The brief, at most {@link POST_BRIEF_MAX} characters.
 */
export function reviewBrief(
  text: string,
  authorName: string | null,
  rating: number | null,
): string {
  const who = [firstName("google", authorName), "Google review", rating && `${rating} stars`];
  const tail = `\n\n${who.filter(Boolean).join(", ")}`;
  const room = POST_BRIEF_MAX - tail.length;
  const words = text.trim();
  return `${words.length > room ? `${words.slice(0, room - 3).trimEnd()}...` : words}${tail}`;
}

// --- Times ---

/**
 * The NZ year of an instant.
 * @param at - Epoch ms.
 * @returns The year.
 */
function nzYear(at: number): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, year: "numeric" }).format(at);
}

/**
 * When a thread last moved, for the list: "5 min ago" within a day, then the date, with the year
 * once it isn't this year's.
 * @param iso - The time.
 * @param now - Epoch ms to measure from.
 * @returns The label.
 */
export function listWhen(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (now - at < 24 * 3_600_000) return timeAgo(at, now);
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    day: "numeric",
    month: "short",
    ...(nzYear(at) === nzYear(now) ? {} : { year: "numeric" as const }),
  }).format(at);
}

/**
 * When a message was written, for the open thread, with the year once it isn't this year's.
 * @param iso - The time.
 * @param now - Epoch ms, for the year check.
 * @returns The label, like "Tue 21 Oct, 9:05 am".
 */
export function messageWhen(iso: string, now: number): string {
  const at = Date.parse(iso);
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(nzYear(at) === nzYear(now) ? {} : { year: "numeric" as const }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}
