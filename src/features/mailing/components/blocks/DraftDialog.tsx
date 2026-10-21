"use client";
// src/features/mailing/components/blocks/DraftDialog.tsx
// "Draft with AI": a one-line brief and the kind of email in, a draft out. When the draft says
// a picture fits, a post maker design is made and drawn for it before the dialog hands over.
// The block editor fills it all in as one undo step; nothing is sent here.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { ADMIN_CHECKBOX_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import type { DraftedPicture, PictureJob } from "@/features/mailing/components/blocks/DraftPicture";
import { BRIEF_MAX, DRAFT_KINDS, type AiDraft } from "@/features/mailing/lib/ai-draft";
import { callApi } from "@/features/mailing/lib/api-client";
import dynamic from "next/dynamic";
import type React from "react";
import { useCallback, useId, useState } from "react";

// Konva has no server build, and most drafts never need it.
const DraftPicture = dynamic(
  () => import("@/features/mailing/components/blocks/DraftPicture").then((m) => m.DraftPicture),
  { ssr: false },
);

/** Which part of the draft is being written. */
type Step = "email" | "picture";

const STEP_LABEL: Record<Step, string> = {
  email: "Writing the email...",
  picture: "Making a picture to go with it...",
};

/**
 * The draft dialog.
 * @param props - Component props.
 * @param props.promoId - The email's linked promo, so the draft knows which promo it's about.
 * @param props.buttonUrl - Where the email's first button goes ("" for none), so the
 *   drafted button words match the link they keep.
 * @param props.canPicture - Whether pictures can be stored, so a draft may come with one.
 * @param props.onClose - Dismisses it.
 * @param props.onDraft - Called with the draft, whether to replace the subject and preview text,
 *   and the picture made for it (null for none).
 * @returns The dialog.
 */
export function DraftDialog({
  promoId,
  buttonUrl,
  canPicture,
  onClose,
  onDraft,
}: {
  promoId: string | null;
  buttonUrl: string;
  canPicture: boolean;
  onClose: () => void;
  onDraft: (draft: AiDraft, withSubject: boolean, picture: DraftedPicture | null) => void;
}): React.ReactElement {
  const id = useId();
  const { toast } = useToast();
  const [kind, setKind] = useState(DRAFT_KINDS[0]!.key);
  const [brief, setBrief] = useState("");
  const [withSubject, setWithSubject] = useState(true);
  const [withPicture, setWithPicture] = useState(true);
  const [step, setStep] = useState<Step | null>(null);
  const [job, setJob] = useState<(PictureJob & { draft: AiDraft }) | null>(null);
  const busy = step !== null;

  /**
   * Hands the email over without its picture, saying why.
   * @param draft - The email draft.
   * @param why - What went wrong with the picture.
   */
  const withoutPicture = useCallback(
    (draft: AiDraft, why: string) => {
      toast(`The email is drafted, but the picture couldn't be made: ${why}`, { tone: "error" });
      onDraft(draft, withSubject, null);
    },
    [toast, onDraft, withSubject],
  );

  /** Asks for the draft, then its picture when one fits, and hands them over. */
  async function write(): Promise<void> {
    setStep("email");
    const res = await callApi<{ draft: AiDraft }>("/api/admin/mailing/ai-draft", "POST", {
      brief,
      kind,
      promoId,
      buttonUrl,
      picture: canPicture && withPicture,
    });
    if (!res.ok) {
      setStep(null);
      toast(res.error, { tone: "error" });
      return;
    }
    const { draft } = res;
    if (!draft.picture) {
      onDraft(draft, withSubject, null);
      return;
    }
    setStep("picture");
    const pic = await callApi<PictureJob>("/api/admin/mailing/ai-picture", "POST", {
      brief,
      kind: draft.picture,
      name: draft.heading || draft.subject,
    });
    if (!pic.ok) {
      withoutPicture(draft, pic.error);
      return;
    }
    // DraftPicture draws and stores it, then calls back.
    setJob({ ...pic, draft });
  }

  const onPictureDone = useCallback(
    (picture: DraftedPicture) => {
      if (job) onDraft(job.draft, withSubject, picture);
    },
    [job, onDraft, withSubject],
  );
  const onPictureFail = useCallback(
    (message: string) => {
      if (!job) return;
      withoutPicture(job.draft, `${message} Its design "${job.design.name}" is in Post maker.`);
    },
    [job, withoutPicture],
  );

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
        {canPicture && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className={ADMIN_CHECKBOX_CLS}
              checked={withPicture}
              onChange={(e) => setWithPicture(e.target.checked)}
            />
            <span>
              Make a picture if it fits (a tip, scam warning, promo or news). It&apos;s saved in
              Post maker too, so you can change it there.
            </span>
          </label>
        )}
        <p aria-live="polite" className="min-h-5 text-sm text-admin-muted">
          {step ? STEP_LABEL[step] : ""}
        </p>
      </div>
      {job && <DraftPicture job={job} onDone={onPictureDone} onFail={onPictureFail} />}
    </Modal>
  );
}
