"use client";
// src/features/mailing/components/blocks/DraftDialog.tsx
// "Draft with AI": a one-line brief and the kind of email in, a draft out. The block
// editor fills the draft into its blocks as one undo step; nothing is saved or sent here.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { ADMIN_CHECKBOX_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { BRIEF_MAX, DRAFT_KINDS, type AiDraft } from "@/features/mailing/lib/ai-draft";
import { callApi } from "@/features/mailing/lib/api-client";
import type React from "react";
import { useId, useState } from "react";

/**
 * The draft dialog.
 * @param props - Component props.
 * @param props.promoId - The email's linked promo, so the draft knows which promo it's about.
 * @param props.buttonUrl - Where the email's first button goes ("" for none), so the
 *   drafted button words match the link they keep.
 * @param props.onClose - Dismisses it.
 * @param props.onDraft - Called with the draft and whether to replace the subject and preview text.
 * @returns The dialog.
 */
export function DraftDialog({
  promoId,
  buttonUrl,
  onClose,
  onDraft,
}: {
  promoId: string | null;
  buttonUrl: string;
  onClose: () => void;
  onDraft: (draft: AiDraft, withSubject: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { toast } = useToast();
  const [kind, setKind] = useState(DRAFT_KINDS[0]!.key);
  const [brief, setBrief] = useState("");
  const [withSubject, setWithSubject] = useState(true);
  const [busy, setBusy] = useState(false);

  /** Asks for the draft and hands it over. */
  async function write(): Promise<void> {
    setBusy(true);
    const res = await callApi<{ draft: AiDraft }>("/api/admin/mailing/ai-draft", "POST", {
      brief,
      kind,
      promoId,
      buttonUrl,
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    onDraft(res.draft, withSubject);
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Draft with AI"
      description="Say what the email is about in a sentence or two. The draft goes into your blocks for you to read and change; Undo takes it back."
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
        <AdminField label="Kind of email" htmlFor={`${id}-kind`}>
          <AdminSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
            {DRAFT_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField
          label="What it's about"
          htmlFor={`${id}-brief`}
          hint={`${brief.length} of ${BRIEF_MAX} characters. Put in any dates or prices you want used; it won't make them up.`}
        >
          <AdminTextarea
            id={`${id}-brief`}
            rows={4}
            maxLength={BRIEF_MAX}
            value={brief}
            placeholder="I'm now doing home visits in Titirangi and Laingholm, Tuesdays and Thursdays."
            onChange={(e) => setBrief(e.target.value)}
          />
        </AdminField>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className={ADMIN_CHECKBOX_CLS}
            checked={withSubject}
            onChange={(e) => setWithSubject(e.target.checked)}
          />
          <span>
            Also write the subject and preview text (Undo doesn&apos;t bring the old ones back)
          </span>
        </label>
      </div>
    </Modal>
  );
}
