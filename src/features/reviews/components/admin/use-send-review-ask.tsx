"use client";
// src/features/reviews/components/admin/use-send-review-ask.tsx
// One dialog for hand-sending a review ask to someone already in the book, shared by the
// "Who you can ask" list and the link history. Email shows the exact email before it
// goes; a text is composed server-side and copied, since there's no SMS provider. Both
// send with `resend`, so someone asked before gets the ask again under the same link.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { apiFetch } from "@/shared/lib/api-client";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

/** The person a review ask is about to go to. */
export interface ReviewAskTarget {
  name: string;
  email: string | null;
  phone: string | null;
  /** ISO time of their latest ask by any route, or null when never asked. */
  lastAskedAt: string | null;
}

type DialogState =
  | { kind: "closed" }
  | { kind: "email"; target: ReviewAskTarget; html: string | null }
  | { kind: "sms"; target: ReviewAskTarget; text: string | null };

/** What {@link useSendReviewAsk} hands back. */
export interface SendReviewAsk {
  /** Opens the dialog for one person on the given channel. */
  start: (target: ReviewAskTarget, channel: "email" | "sms") => void;
  /** The dialog element; render it once, anywhere in the component. */
  dialog: React.ReactElement;
}

/**
 * Hand-send a review ask from a list row: preview then send for email, copy for text.
 * @param onSent - Called after an email ask goes out, with the person it went to.
 * @returns The opener and the dialog element.
 */
export function useSendReviewAsk(onSent?: (target: ReviewAskTarget) => void): SendReviewAsk {
  const { toast } = useToast();
  const [state, setState] = useState<DialogState>({ kind: "closed" });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Opens the dialog and loads its content: the rendered email, or the text to copy.
   * @param target - Who the ask is for.
   * @param channel - Email or text.
   */
  async function start(target: ReviewAskTarget, channel: "email" | "sms"): Promise<void> {
    setCopied(false);
    if (channel === "email") {
      setState({ kind: "email", target, html: null });
      const res = await apiFetch<{ html: string }>("/api/admin/preview-review-email", {
        method: "POST",
        json: { name: target.name },
      });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        setState({ kind: "closed" });
        return;
      }
      setState({ kind: "email", target, html: res.data.html });
      return;
    }
    setState({ kind: "sms", target, text: null });
    const res = await apiFetch<{ smsText: string }>("/api/admin/send-review-link", {
      method: "POST",
      json: { name: target.name, phone: target.phone, mode: "sms", resend: true },
    });
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      setState({ kind: "closed" });
      return;
    }
    setState({ kind: "sms", target, text: res.data.smsText });
  }

  /** Sends the previewed email. */
  async function sendEmail(): Promise<void> {
    if (state.kind !== "email") return;
    const { target } = state;
    setSending(true);
    const res = await apiFetch("/api/admin/send-review-link", {
      method: "POST",
      json: { name: target.name, email: target.email, mode: "email", resend: true },
    });
    setSending(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`Review ask sent to ${target.name}.`, { tone: "success" });
    setState({ kind: "closed" });
    onSent?.(target);
  }

  /** Copies the composed text. */
  async function copyText(): Promise<void> {
    if (state.kind !== "sms" || !state.text) return;
    await navigator.clipboard.writeText(state.text);
    setCopied(true);
  }

  /** Closes whichever dialog is open. */
  function close(): void {
    setState({ kind: "closed" });
  }

  const target = state.kind === "closed" ? null : state.target;
  const lastAsked = target?.lastAskedAt
    ? `Last asked ${formatDateShort(target.lastAskedAt)}.`
    : "Not asked before.";

  const dialog = (
    <>
      <Modal
        open={state.kind === "email"}
        onClose={close}
        title={`Review ask for ${target?.name ?? ""}`}
        description={`To ${target?.email ?? ""}. ${lastAsked}`}
        size="lg"
        footer={
          <>
            <AdminButton variant="secondary" onClick={close}>
              Cancel
            </AdminButton>
            <AdminButton
              onClick={() => void sendEmail()}
              busy={sending}
              disabled={state.kind !== "email" || state.html === null}
            >
              {sending ? "Sending..." : "Send email"}
            </AdminButton>
          </>
        }
      >
        {state.kind === "email" && state.html !== null ? (
          <iframe
            srcDoc={state.html}
            title="Email preview"
            className="h-[60vh] w-full rounded-lg border border-slate-200"
            sandbox="allow-same-origin"
          />
        ) : (
          <p className="text-sm text-admin-muted">Loading the email...</p>
        )}
      </Modal>

      <Modal
        open={state.kind === "sms"}
        onClose={close}
        title={`Text for ${target?.name ?? ""}`}
        description={`Copy it and send it from your phone. ${lastAsked}`}
        footer={
          <>
            <AdminButton variant="secondary" onClick={close}>
              Close
            </AdminButton>
            <AdminButton
              onClick={() => void copyText()}
              disabled={state.kind !== "sms" || state.text === null}
            >
              {copied ? "Copied!" : "Copy message"}
            </AdminButton>
          </>
        }
      >
        <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">
          {state.kind === "sms" && state.text !== null ? state.text : "Writing the text..."}
        </p>
      </Modal>
    </>
  );

  /**
   * Fire-and-forget wrapper so row buttons can call {@link start} from onClick.
   * @param t - Who the ask is for.
   * @param channel - Email or text.
   */
  function open(t: ReviewAskTarget, channel: "email" | "sms"): void {
    void start(t, channel);
  }

  return { start: open, dialog };
}
