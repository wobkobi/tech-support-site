"use client";
// src/features/social/components/InboxThread.tsx
// One open inbox thread: the post it's on, every message with Hide and Delete, a reply box with
// Suggest a reply, and Archive, Mark unread, Open on the app and, on a review, Make a post from
// this review. A Messenger or Instagram conversation reads as a chat, with the box open only
// within a day of their last message. Opening an unread thread marks it read.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { AppIcons } from "@/features/social/components/AppIcons";
import { Stars } from "@/features/social/components/InboxRow";
import { announceInboxChange } from "@/features/social/hooks/use-inbox-unread";
import type {
  InboxMessage,
  InboxThreadDetail,
} from "@/features/social/lib/inbox/inbox-data.server";
import {
  dmAppLabel,
  messageWhen,
  replyLength,
  replyLimit,
  replyProblem,
  windowClosedText,
} from "@/features/social/lib/inbox/map";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FaArrowLeft, FaArrowUpRightFromSquare } from "react-icons/fa6";

/**
 * The message a reply answers: their latest that still shows, else the thread's first.
 * @param messages - The thread, first message first.
 * @returns The message, or undefined for an empty thread.
 */
function messageToAnswer(messages: InboxMessage[]): InboxMessage | undefined {
  return [...messages].reverse().find((m) => !m.fromUs && !m.gone) ?? messages[0];
}

/**
 * The open thread.
 * @param props - Component props.
 * @param props.thread - The thread with every message.
 * @param props.closeHref - The list's address without this thread open.
 * @param props.now - When the page loaded, as ISO.
 * @param props.canSuggest - Whether an AI provider is set up for Suggest a reply.
 * @param props.reviewTemplateId - The Post maker's review template, if there is one.
 * @returns The thread pane.
 */
export function InboxThread({
  thread,
  closeHref,
  now,
  canSuggest,
  reviewTemplateId,
}: {
  thread: InboxThreadDetail;
  closeHref: string;
  now: string;
  canSuggest: boolean;
  reviewTemplateId: string | null;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const replyId = useId();
  // Google keeps one reply per review, so the box starts with it to edit.
  const googleReply =
    thread.platform === "google" ? thread.messages.find((m) => m.fromUs && !m.gone) : undefined;
  const [text, setText] = useState(googleReply?.text ?? "");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [looksLikeSpam, setLooksLikeSpam] = useState(false);
  // The message an action is running on, so only its buttons wait.
  const [acting, setActing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<InboxMessage | null>(null);
  const [making, setMaking] = useState(false);
  const markedRead = useRef<string | null>(null);

  const direct = thread.kind === "conversation";
  const app = direct ? dmAppLabel(thread.platform) : PLATFORM_LABEL[thread.platform];
  const top = thread.messages[0];
  const answer = messageToAnswer(thread.messages);
  const ourReply = thread.messages.some((m) => m.fromUs && !m.gone);
  const nowMs = Date.parse(now);
  const problem = text.trim() ? replyProblem(thread.platform, text, direct) : null;
  const unchanged = googleReply !== undefined && text.trim() === googleReply.text.trim();
  // The apps only take a business's message within a day of the person's last one.
  const windowOpen = !direct || (thread.openUntil !== null && Date.parse(thread.openUntil) > nowMs);
  const sendLabel = direct ? "Send message" : "Send reply";

  // Opening an unread thread marks it read, once per thread.
  useEffect(() => {
    if (thread.read || markedRead.current === thread.id) return;
    markedRead.current = thread.id;
    void (async () => {
      const res = await callApi(`/api/admin/social/inbox/${thread.id}`, "PATCH", { read: true });
      if (!res.ok) return;
      announceInboxChange();
      router.refresh();
    })();
  }, [thread.id, thread.read, router]);

  /**
   * Runs one action, then reloads the page's data and the sidebar count.
   * @param key - What it's running on, for the busy state.
   * @param url - Route path.
   * @param method - HTTP method.
   * @param body - Request body.
   * @param done - The toast once it works.
   * @returns Whether it worked.
   */
  async function act(
    key: string,
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown> | undefined,
    done: string,
  ): Promise<boolean> {
    setActing(key);
    const res = await callApi(url, method, body);
    setActing(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return false;
    }
    toast(done, { tone: "success" });
    announceInboxChange();
    router.refresh();
    return true;
  }

  /** Sends the reply on the app. */
  async function send(): Promise<void> {
    const wrong = replyProblem(thread.platform, text, direct);
    if (wrong) {
      toast(wrong, { tone: "error" });
      return;
    }
    setSending(true);
    const res = await callApi<{ id: string }>(
      `/api/admin/social/inbox/${thread.id}/reply`,
      "POST",
      { text },
    );
    setSending(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    if (thread.platform !== "google") setText("");
    setLooksLikeSpam(false);
    toast(direct ? `Message sent on ${app}.` : `Reply posted on ${app}.`, { tone: "success" });
    announceInboxChange();
    router.refresh();
  }

  /** Asks the AI for a reply and puts it in the box to check. */
  async function suggest(): Promise<void> {
    if (!answer) return;
    setSuggesting(true);
    const at = thread.messages.indexOf(answer);
    const res = await callApi<{ reply: string; hide: boolean }>(
      "/api/admin/social/inbox/suggest",
      "POST",
      {
        platform: thread.platform,
        kind: direct ? "message" : thread.kind === "review" ? "review" : "comment",
        rating: top?.rating ?? null,
        author: answer.authorName,
        text: answer.text,
        earlier: thread.messages
          .slice(0, at)
          .filter((m) => !m.gone)
          .map((m) => ({ fromUs: m.fromUs, text: m.text })),
        postText: direct ? null : thread.post.text,
      },
    );
    setSuggesting(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setLooksLikeSpam(res.hide && thread.platform !== "google");
    if (res.reply) setText(res.reply);
  }

  /** Copies the review template and opens it with Draft with AI ready to fill from this review. */
  async function makePost(): Promise<void> {
    if (!reviewTemplateId) return;
    setMaking(true);
    const res = await callApi<{ design: { id: string } }>("/api/admin/social/designs", "POST", {
      source: "copy",
      sourceId: reviewTemplateId,
    });
    if (!res.ok) {
      setMaking(false);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/social/design/${res.design.id}?review=${thread.id}`);
  }

  /** Deletes the message the confirm is open for. */
  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const ok = await act(
      deleting.id,
      `/api/admin/social/inbox/${deleting.id}`,
      "DELETE",
      undefined,
      deleting.fromUs ? "Your reply is deleted." : `Deleted from ${app}.`,
    );
    setDeleting(null);
    // Deleting the thread's first message takes the whole thread away.
    if (ok && deleting.id === top?.id) router.push(closeHref);
  }

  const title = direct
    ? `${app} chat with ${thread.with ?? "someone"}`
    : thread.kind === "review"
      ? "Google review"
      : thread.post.name
        ? `Comment on ${thread.post.name}`
        : `Comment on your ${app} post`;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link
          href={closeHref}
          scroll={false}
          className="inline-flex items-center gap-2 self-start text-base font-semibold text-moonstone-700 hover:underline lg:hidden"
        >
          <FaArrowLeft aria-hidden className="size-3.5" /> Back to the list
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold text-russian-violet">
            <AppIcons platforms={[thread.platform]} />
            <span className="min-w-0 wrap-break-word">{title}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <AdminButton
              variant="outline"
              size="xs"
              busy={acting === "archive"}
              onClick={async () => {
                const ok = await act(
                  "archive",
                  `/api/admin/social/inbox/${thread.id}`,
                  "PATCH",
                  { archived: !thread.archived },
                  thread.archived ? "Moved back to the inbox." : "Archived.",
                );
                if (ok) router.push(closeHref, { scroll: false });
              }}
            >
              {thread.archived ? "Move to the inbox" : "Archive"}
            </AdminButton>
            <AdminButton
              variant="outline"
              size="xs"
              busy={acting === "unread"}
              onClick={async () => {
                const ok = await act(
                  "unread",
                  `/api/admin/social/inbox/${thread.id}`,
                  "PATCH",
                  { read: false },
                  "Marked unread.",
                );
                if (ok) router.push(closeHref, { scroll: false });
              }}
            >
              Mark unread
            </AdminButton>
            {thread.post.url && (
              <a
                href={thread.post.url}
                target="_blank"
                rel="noopener noreferrer"
                className={adminButtonClass({ variant: "outline", size: "xs" })}
              >
                Open on {app} <FaArrowUpRightFromSquare aria-hidden className="size-3" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {thread.kind === "comment" && (thread.post.text || thread.post.imageUrl) && (
        <div className="flex gap-3 rounded-lg border border-admin-border bg-admin-bg p-3">
          {thread.post.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Blob picture of unknown size, which next/image needs up front.
            <img
              src={thread.post.imageUrl}
              alt=""
              className="size-16 shrink-0 rounded-md object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-admin-muted">Your post</p>
            {thread.post.text && (
              <p className="line-clamp-3 text-base whitespace-pre-line text-admin-text">
                {thread.post.text}
              </p>
            )}
          </div>
        </div>
      )}

      {thread.gone && (
        <Notice tone="warn" onGrey>
          This is no longer on {app}, so it can&apos;t be answered.
        </Notice>
      )}

      <ol className="flex flex-col gap-3">
        {thread.messages.map((m, i) => (
          <li
            key={m.id}
            className={cn(
              "rounded-lg border p-3",
              // A chat sets theirs and ours on opposite sides; a comment thread indents replies.
              m.fromUs
                ? "ml-6 border-moonstone-200 bg-moonstone-50"
                : direct
                  ? "mr-6 border-admin-border"
                  : i > 0
                    ? "ml-6 border-admin-border"
                    : "border-admin-border",
              m.gone && "opacity-60",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-admin-text">{m.author}</span>
              {m.rating !== null && <Stars rating={m.rating} />}
              <span className="text-sm text-admin-muted">
                {messageWhen(m.postedAt, nowMs)}
                {m.editedAt && " (edited)"}
              </span>
              {m.hidden && <StatusPill tone="warning">Hidden</StatusPill>}
              {m.gone && <StatusPill tone="neutral">Deleted</StatusPill>}
            </div>
            {m.text ? (
              <p className="mt-1.5 text-base wrap-break-word whitespace-pre-line text-admin-text">
                {m.text}
              </p>
            ) : (
              <p className="mt-1.5 text-base text-admin-muted italic">Stars only, no words.</p>
            )}
            {!m.gone && !direct && (
              <MessageActions
                message={m}
                platform={thread.platform}
                busy={acting === m.id}
                onHide={() =>
                  void act(
                    m.id,
                    `/api/admin/social/inbox/${m.id}/hide`,
                    "POST",
                    { hidden: !m.hidden },
                    m.hidden ? "It shows again." : "Hidden.",
                  )
                }
                onDelete={() => setDeleting(m)}
              />
            )}
          </li>
        ))}
      </ol>

      {!thread.gone && !windowOpen && (
        <Notice tone="info" onGrey>
          {windowClosedText(
            thread.platform,
            thread.messages.some((m) => !m.fromUs && !m.gone),
          )}
          {thread.post.url && (
            <>
              {" "}
              <a
                href={thread.post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                Open it on {app}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </>
          )}
        </Notice>
      )}

      {!thread.gone && windowOpen && (
        <div className="flex flex-col gap-3 border-t border-admin-border pt-4">
          <label htmlFor={replyId} className="text-base font-semibold text-admin-text">
            {thread.platform === "google" && ourReply ? "Change your reply" : "Your reply"}
          </label>
          {looksLikeSpam && direct && (
            <Notice tone="warn" onGrey>
              This reads like spam. You don&apos;t have to answer it: Archive puts it away.
            </Notice>
          )}
          {looksLikeSpam && !direct && (
            <Notice tone="warn" onGrey>
              <span className="flex flex-wrap items-center gap-3">
                This reads like spam. Hide it rather than answer?
                {answer && (
                  <AdminButton
                    variant="outline"
                    size="xs"
                    busy={acting === answer.id}
                    onClick={async () => {
                      const ok = await act(
                        answer.id,
                        `/api/admin/social/inbox/${answer.id}/hide`,
                        "POST",
                        { hidden: true },
                        "Hidden.",
                      );
                      if (ok) setLooksLikeSpam(false);
                    }}
                  >
                    Hide it
                  </AdminButton>
                )}
              </span>
            </Notice>
          )}
          <AdminTextarea
            id={replyId}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              direct
                ? "Write a message."
                : thread.kind === "review"
                  ? "Thank them, or answer what they said."
                  : "Write a reply."
            }
            aria-describedby={`${replyId}-hint`}
          />
          <p id={`${replyId}-hint`} className="text-sm text-admin-muted">
            {replyLength(thread.platform, direct, text)} of {replyLimit(thread.platform, direct)}{" "}
            characters.{" "}
            {direct
              ? `Only they see it. You can answer from here until ${messageWhen(thread.openUntil!, nowMs)}.`
              : thread.platform === "google"
                ? "It shows under the review for everyone, and sending again replaces it."
                : "It shows under their comment for everyone."}
            {problem && <span className="block font-semibold text-coquelicot-700">{problem}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {canSuggest && (
              <AdminButton
                variant="secondary"
                busy={suggesting}
                disabled={sending || !answer}
                onClick={() => void suggest()}
              >
                Suggest a reply
              </AdminButton>
            )}
            <AdminButton
              busy={sending}
              disabled={suggesting || !text.trim() || problem !== null || unchanged}
              onClick={() => void send()}
            >
              {sendLabel}
            </AdminButton>
          </div>
          {canSuggest && (
            <p className="text-sm text-admin-muted">
              A suggestion only fills the box. Nothing goes out until you press {sendLabel}.
            </p>
          )}
        </div>
      )}

      {thread.kind === "review" && reviewTemplateId && top?.text && (
        <div className="flex flex-wrap items-center gap-3 border-t border-admin-border pt-4">
          <p className="min-w-0 flex-1 basis-60 text-base text-admin-text-secondary">
            Share this review as a post. It copies your review template in the Post maker, and Draft
            with AI fills it from their words.
          </p>
          <AdminButton variant="outline" busy={making} onClick={() => void makePost()}>
            Make a post from this review
          </AdminButton>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.fromUs ? "Delete your reply?" : "Delete this comment?"}
        body={deleting ? deleteWarning(deleting, deleting.id === top?.id, thread.platform) : ""}
        confirmLabel="Delete"
        tone="danger"
        busy={deleting !== null && acting === deleting.id}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}

/**
 * What deleting a message does, for the confirm.
 * @param message - The message.
 * @param first - Whether it's the thread's first message, which takes the replies with it.
 * @param platform - Its app.
 * @returns The warning.
 */
function deleteWarning(
  message: InboxMessage,
  first: boolean,
  platform: InboxThreadDetail["platform"],
): string {
  const app = PLATFORM_LABEL[platform];
  if (message.fromUs) return `It comes off ${app} for good.`;
  const who = platform === "facebook" ? "them and their friends" : "them";
  return `It comes off ${app} for good${first ? ", with every reply under it" : ""}. Hiding it instead keeps it from everyone but ${who}.`;
}

/**
 * Hide and Delete for one message, where the app allows them: Google reviews can't be hidden,
 * and only our own reply to one can be deleted.
 * @param props - Component props.
 * @param props.message - The message.
 * @param props.platform - Its app.
 * @param props.busy - Whether an action on it is running.
 * @param props.onHide - Hides it, or shows it again.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The buttons, or null when there are none.
 */
function MessageActions({
  message,
  platform,
  busy,
  onHide,
  onDelete,
}: {
  message: InboxMessage;
  platform: InboxThreadDetail["platform"];
  busy: boolean;
  onHide: () => void;
  onDelete: () => void;
}): React.ReactElement | null {
  const canHide = platform !== "google" && !message.fromUs;
  const canDelete = platform !== "google" || message.fromUs;
  if (!canHide && !canDelete) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {canHide && (
        <AdminButton variant="ghost" size="xs" busy={busy} onClick={onHide}>
          {message.hidden ? "Show it again" : "Hide"}
        </AdminButton>
      )}
      {canDelete && (
        <AdminButton variant="ghost" size="xs" disabled={busy} onClick={onDelete}>
          Delete
        </AdminButton>
      )}
    </div>
  );
}
