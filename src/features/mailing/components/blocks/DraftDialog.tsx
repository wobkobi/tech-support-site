"use client";
// src/features/mailing/components/blocks/DraftDialog.tsx
// "Draft with AI": a one-line brief and the kind of email in, a draft out. When the draft says
// a picture fits, it either picks a saved Post maker picture that already says it, or a design
// is made and drawn before the dialog hands over (a redraft draws over the same design). The
// block editor fills it all in as one undo step; nothing is sent here. From Email this too, the
// brief is the social post's words instead.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { ADMIN_CHECKBOX_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  readDraftBrief,
  saveDraftBrief,
  saveDraftPicture,
  type DraftDesign,
} from "@/features/mailing/components/blocks/draft-brief";
import type { DraftedPicture, PictureJob } from "@/features/mailing/components/blocks/DraftPicture";
import {
  BRIEF_MAX,
  DRAFT_KINDS,
  POST_SOURCE_MAX,
  type AiDraft,
  type DraftSource,
  type ReusedPicture,
} from "@/features/mailing/lib/ai-draft";
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

/** The picture handed over with a draft. */
export interface HandedPicture {
  url: string;
  alt: string;
  /** The Post maker design's name when a saved picture was picked, null for a new one. */
  reusedFrom: string | null;
}

/**
 * The draft dialog. It opens with the email's last brief, so a draft can be changed and redone.
 * @param props - Component props.
 * @param props.campaignId - The email, so its last brief comes back.
 * @param props.promoId - The email's linked promo, so the draft knows which promo it's about.
 * @param props.buttonUrl - Where the email's first button goes ("" for none), so the
 *   drafted button words match the link they keep.
 * @param props.canPicture - Whether pictures can be stored, so a draft may come with one.
 * @param props.fromPost - Opened by Email this too, so the brief is the post even when this
 *   browser couldn't store it.
 * @param props.postBrief - The linked post's words, the brief when this browser kept none.
 * @param props.onClose - Dismisses it.
 * @param props.onDraft - Called with the draft, whether to replace the subject and preview text,
 *   the picture made or picked for it (null for none), and, when it has none, the last draft's
 *   picture to take out (null when there's nothing to take out).
 * @returns The dialog.
 */
export function DraftDialog({
  campaignId,
  promoId,
  buttonUrl,
  canPicture,
  fromPost = false,
  postBrief = "",
  onClose,
  onDraft,
}: {
  campaignId: string;
  promoId: string | null;
  buttonUrl: string;
  canPicture: boolean;
  fromPost?: boolean;
  postBrief?: string;
  onClose: () => void;
  onDraft: (
    draft: AiDraft,
    withSubject: boolean,
    picture: HandedPicture | null,
    stale: string | null,
  ) => void;
}): React.ReactElement {
  const id = useId();
  const { toast } = useToast();
  // Only mounts after a click, so storage is safe to read on the first render.
  const [last] = useState(() => readDraftBrief(campaignId));
  const [kind, setKind] = useState(last?.kind ?? DRAFT_KINDS[0]!.key);
  const [brief, setBrief] = useState(last?.brief ?? (fromPost ? postBrief : ""));
  const [withSubject, setWithSubject] = useState(last?.withSubject ?? true);
  const [withPicture, setWithPicture] = useState(last?.withPicture ?? !fromPost);
  const [source, setSource] = useState<DraftSource>(
    fromPost || last?.source === "post" ? "post" : "brief",
  );
  const max = source === "post" ? POST_SOURCE_MAX : BRIEF_MAX;
  const [step, setStep] = useState<Step | null>(null);
  const [job, setJob] = useState<(PictureJob & { draft: AiDraft }) | null>(null);
  const busy = step !== null;

  /**
   * Hands the draft over and remembers which picture it put in. A draft without a picture
   * takes out the last draft's, so its old words don't sit with the new text.
   * @param draft - The email draft.
   * @param picture - The picture made or picked for it, or null.
   * @param design - The design a new picture was made in, for the next draft to draw over.
   */
  const handOver = useCallback(
    (draft: AiDraft, picture: HandedPicture | null, design?: DraftDesign) => {
      const stale = picture ? null : (readDraftBrief(campaignId)?.picture ?? null);
      saveDraftPicture(campaignId, picture?.url ?? null, design);
      onDraft(draft, withSubject, picture, stale);
    },
    [campaignId, onDraft, withSubject],
  );

  /**
   * Hands the email over without its picture, saying why.
   * @param draft - The email draft.
   * @param why - What went wrong with the picture.
   */
  const withoutPicture = useCallback(
    (draft: AiDraft, why: string) => {
      toast(`The email is drafted, but the picture couldn't be made: ${why}`, { tone: "error" });
      handOver(draft, null);
    },
    [toast, handOver],
  );

  /** Asks for the draft, then its picture when one fits, and hands them over. */
  async function write(): Promise<void> {
    setStep("email");
    const last = readDraftBrief(campaignId);
    const design = last?.design ?? null;
    const res = await callApi<{ draft: AiDraft; reuse: ReusedPicture | null }>(
      "/api/admin/mailing/ai-draft",
      "POST",
      {
        brief,
        kind,
        promoId,
        buttonUrl,
        picture: canPicture && withPicture,
        ownDesign: design?.id,
        source,
      },
    );
    if (!res.ok) {
      setStep(null);
      toast(res.error, { tone: "error" });
      return;
    }
    saveDraftBrief(campaignId, {
      brief,
      kind,
      withSubject,
      withPicture,
      design,
      picture: last?.picture ?? null,
      ...(source === "post" ? { source } : {}),
    });
    const { draft, reuse } = res;
    if (reuse) {
      handOver(draft, { url: reuse.url, alt: reuse.alt, reusedFrom: reuse.name });
      return;
    }
    if (!draft.picture) {
      handOver(draft, null);
      return;
    }
    setStep("picture");
    const pic = await callApi<PictureJob>("/api/admin/mailing/ai-picture", "POST", {
      brief,
      kind: draft.picture,
      name: draft.heading || draft.subject,
      replace: design,
      campaignId,
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
      if (!job) return;
      handOver(job.draft, { url: picture.url, alt: picture.alt, reusedFrom: null }, picture.design);
    },
    [job, handOver],
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
      description={
        source === "post"
          ? "This turns your post into an email for your mailing list: the hashtags, emoji and follow-us lines come out, and nothing new is made up. The draft goes into your blocks for you to read and change; Undo takes it back."
          : "Say what the email is about in a sentence or two. The draft goes into your blocks for you to read and change; Undo takes it back."
      }
      dirty={brief.trim() !== (last?.brief ?? "").trim()}
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
        <AdminField
          label="Kind of email"
          htmlFor={`${id}-kind`}
          hint="Let AI decide works it out from what you write. Pick one to steer a short brief."
        >
          <AdminSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
            {DRAFT_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField
          label={source === "post" ? "From your post" : "What it's about"}
          htmlFor={`${id}-brief`}
          hint={
            source === "post"
              ? `${brief.length} of ${max} characters. Change anything you want said differently in the email.`
              : `${brief.length} of ${max} characters. Put in any dates or prices you want used; it won't make them up.`
          }
        >
          <AdminTextarea
            id={`${id}-brief`}
            rows={source === "post" ? 8 : 4}
            maxLength={max}
            value={brief}
            placeholder={
              source === "post"
                ? "Paste your post here."
                : "I'm now doing home visits in Titirangi and Laingholm, Tuesdays and Thursdays."
            }
            onChange={(e) => setBrief(e.target.value)}
          />
        </AdminField>
        {source === "post" && (
          <AdminButton
            variant="secondary"
            className="self-start"
            disabled={busy}
            onClick={() => {
              setSource("brief");
              setBrief("");
            }}
          >
            Write my own brief instead
          </AdminButton>
        )}
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
              Add a picture if it fits (a thank-you, tip, scam warning, promo or news). One of your
              Post maker pictures goes in if it already says the same thing; otherwise a new one is
              made and saved there. Drafting again redraws that one rather than saving another,
              unless you&apos;ve changed it.
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
