"use client";
// src/features/social/components/PostEmailPanel.tsx
// The composer's Email card: draft a mailing-list email from the post, or the email already
// linked to it either way round, with its status and a way into Mailing.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { CAMPAIGN_STATUS_PILL } from "@/features/mailing/lib/campaign-row";
import type { PostEmail } from "@/features/social/lib/email-step.server";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";

/**
 * When the linked email went or goes out, for its status line.
 * @param email - The linked email.
 * @returns The line, or null for a draft.
 */
function whenLine(email: PostEmail): string | null {
  if (email.sentAt) return `Sent ${formatDateTimeShort(email.sentAt)}.`;
  if (email.status === "scheduled" && email.scheduledAt) {
    return `Sending ${formatDateTimeShort(email.scheduledAt)}.`;
  }
  return null;
}

/**
 * The Email card.
 * @param props - Component props.
 * @param props.email - The linked email, or null.
 * @param props.aiReady - Whether Draft with AI is set up, which offers Redo it with AI.
 * @param props.busy - The composer's busy marker, so this card's buttons spin.
 * @param props.onDraft - Opens Email this too.
 * @param props.onRedo - Opens the email in Mailing with Draft with AI ready on the post's words.
 * @param props.onUnlink - Unlinks the email; it stays in Mailing.
 * @returns The card.
 */
export function PostEmailPanel({
  email,
  aiReady,
  busy,
  onDraft,
  onRedo,
  onUnlink,
}: {
  email: PostEmail | null;
  aiReady: boolean;
  busy: string | null;
  onDraft: () => void;
  onRedo: () => void;
  onUnlink: () => void;
}): React.ReactElement {
  if (!email) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-admin-text">Email</h2>
        <p className="mt-1 text-sm text-admin-text-secondary">
          Make a draft email for your mailing list from this post. Nothing is sent until you send it
          from Mailing.
        </p>
        <AdminButton variant="secondary" className="mt-3" busy={busy === "email"} onClick={onDraft}>
          Draft an email
        </AdminButton>
      </Card>
    );
  }

  const pill = CAMPAIGN_STATUS_PILL[email.status];
  const when = whenLine(email);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-admin-text">Email</h2>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>
      <p className="mt-1 text-sm text-admin-text-secondary">
        {email.fromEmail ? (
          <>
            This post was shared from the email <strong>{email.name}</strong>.
          </>
        ) : (
          <>
            <strong>{email.name}</strong> was drafted from this post.
          </>
        )}
        {when && ` ${when}`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <AdminButton variant="secondary" href={`/admin/mailing/${email.id}`}>
          Open in Mailing
        </AdminButton>
        {aiReady && !email.fromEmail && email.status === "draft" && (
          <AdminButton variant="secondary" busy={busy === "email-redo"} onClick={onRedo}>
            Redo it with AI
          </AdminButton>
        )}
        <AdminButton variant="ghost" busy={busy === "email-unlink"} onClick={onUnlink}>
          Unlink
        </AdminButton>
      </div>
    </Card>
  );
}
