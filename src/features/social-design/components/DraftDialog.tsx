"use client";
// src/features/social-design/components/DraftDialog.tsx
// "Draft with AI" in the post maker: a one-line brief and the kind of post in, words for
// the picture and the post out. The editor fills them into the layers as one undo step;
// nothing is saved or posted here.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import {
  POST_BRIEF_MAX,
  POST_DRAFT_KINDS,
  type DesignDraft,
  type DraftRoom,
} from "@/features/social-design/lib/ai-draft";
import type React from "react";
import { useId, useState } from "react";

/**
 * Says in words what a draft will fill, so nothing lands somewhere unexpected.
 * @param room - What the design has room for.
 * @returns A list like "the headline, 3 ticked points and the post words".
 */
function fillsLine(room: DraftRoom): string {
  const parts = [
    room.headline && "the headline",
    room.support && "the short line",
    room.bullets > 0 && `${room.bullets} ticked points`,
    room.quote && "the review quote",
    room.name && "who said it",
  ].filter((p): p is string => Boolean(p));
  parts.push("the post words");
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The draft dialog.
 * @param props - Component props.
 * @param props.startKind - Kind of post picked to begin with, from the design's kind.
 * @param props.room - What the design has room for.
 * @param props.paidAd - The design's paid-ad switch, which keeps contact details out.
 * @param props.onClose - Dismisses it.
 * @param props.onDraft - Called with the draft.
 * @returns The dialog.
 */
export function DraftDialog({
  startKind,
  room,
  paidAd,
  onClose,
  onDraft,
}: {
  startKind: string;
  room: DraftRoom;
  paidAd: boolean;
  onClose: () => void;
  onDraft: (draft: DesignDraft) => void;
}): React.ReactElement {
  const id = useId();
  const { toast } = useToast();
  const [kind, setKind] = useState(startKind);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const example = POST_DRAFT_KINDS.find((k) => k.key === kind)?.example ?? "";

  /** Asks for the draft and hands it over. */
  async function write(): Promise<void> {
    setBusy(true);
    const res = await callApi<{ draft: DesignDraft }>(
      "/api/admin/social/designs/ai-draft",
      "POST",
      { brief, kind, room, paidAd },
    );
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    onDraft(res.draft);
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Draft with AI"
      description={`Say what the post is about in a sentence or two. The draft fills ${fillsLine(room)}, for you to read and change; Undo takes it back.`}
      dirty={brief.trim() !== ""}
      footer={
        <>
          <AdminButton variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton busy={busy} disabled={!brief.trim()} onClick={() => void write()}>
            Write draft
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AdminField label="Kind of post" htmlFor={`${id}-kind`}>
          <AdminSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
            {POST_DRAFT_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField
          label="What it's about"
          htmlFor={`${id}-brief`}
          hint={`${brief.length} of ${POST_BRIEF_MAX} characters. Put in any dates or prices you want used; it won't make them up.`}
        >
          <AdminTextarea
            id={`${id}-brief`}
            rows={4}
            maxLength={POST_BRIEF_MAX}
            value={brief}
            placeholder={example}
            onChange={(e) => setBrief(e.target.value)}
          />
        </AdminField>
        {room.quote && (
          <p className="text-sm text-admin-text-secondary">
            The review quote is only ever cut from words you paste in here. A review post with no
            review words in the brief isn&apos;t written.
          </p>
        )}
      </div>
    </Modal>
  );
}
