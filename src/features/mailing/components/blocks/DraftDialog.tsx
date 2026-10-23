"use client";
// src/features/mailing/components/blocks/DraftDialog.tsx
// "Draft with AI": a one-line brief and the kind of email in, a draft out. Pictures go where the
// draft says they fit: one at the top, and in a long email one more above the part that most
// needs it. Each is a saved Post maker picture that already says it, or a design made and drawn
// before the dialog hands over (a redraft draws over the email's own designs). The block editor
// fills it all in as one undo step; nothing is sent here. From Email this too, the brief is the
// social post's words instead.

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
  saveDraftPictures,
} from "@/features/mailing/components/blocks/draft-brief";
import type { DraftedPicture, PictureJob } from "@/features/mailing/components/blocks/DraftPicture";
import {
  BRIEF_MAX,
  DRAFT_KINDS,
  pictureNameOf,
  POST_SOURCE_MAX,
  type AiDraft,
  type DraftSource,
  type PlannedPicture,
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

/** A picture handed over with a draft. */
export interface HandedPicture {
  url: string;
  alt: string;
  /** The paragraph it sits above, from 0: 0 is the top of the email. */
  at: number;
  /** The Post maker design's name when a saved picture was picked, null for a new one. */
  reusedFrom: string | null;
}

/** A new picture's design and words, and where it goes. */
type QueuedJob = PictureJob & { at: number };

/** A draft whose new pictures are being drawn, one at a time. */
interface Drawing {
  draft: AiDraft;
  /** Pictures ready so far, saved ones included. */
  done: HandedPicture[];
  /** Pictures left to draw; the first is being drawn. */
  queue: QueuedJob[];
  /** Why the ones that couldn't be made failed. */
  failed: string[];
  /** New pictures being drawn in all, for the progress line. */
  total: number;
}

/**
 * What the toast says once a draft is in.
 * @param pictures - The pictures that went in with it.
 * @returns The message.
 */
export function draftedMessage(pictures: readonly HandedPicture[]): string {
  const reused = pictures.flatMap((p) => (p.reusedFrom ? [`"${p.reusedFrom}"`] : []));
  const made = pictures.length - reused.length;
  const parts = [
    ...(made === 1 ? ["a new picture"] : made > 1 ? [`${made} new pictures`] : []),
    ...(reused.length > 0
      ? [
          `your ${reused.join(" and ")} ${reused.length === 1 ? "picture" : "pictures"} from Post maker`,
        ]
      : []),
  ];
  const added = parts.length > 0 ? `Draft added with ${parts.join(" and ")}.` : "Draft added.";
  const designs =
    made === 1
      ? " The new picture's design is in Post maker if you want to change it."
      : made > 1
        ? " The new pictures' designs are in Post maker if you want to change them."
        : "";
  return `${added} Read it through and make it yours; Undo takes it back.${designs}`;
}

/**
 * The draft dialog. It opens with the email's last brief, so a draft can be changed and redone.
 * @param props - Component props.
 * @param props.campaignId - The email, so its last brief comes back.
 * @param props.promoId - The email's linked promo, so the draft knows which promo it's about.
 * @param props.buttonUrl - Where the email's first button goes ("" for none), so the
 *   drafted button words match the link they keep.
 * @param props.canPicture - Whether pictures can be stored, so a draft may come with some.
 * @param props.pictures - Addresses of the pictures already in the email, so a saved one
 *   isn't handed back as one of the draft's "new" pictures.
 * @param props.fromPost - Opened by Email this too, so the brief is the post even when this
 *   browser couldn't store it.
 * @param props.postBrief - The linked post's words, the brief when this browser kept none.
 * @param props.onClose - Dismisses it.
 * @param props.onDraft - Called with the draft, whether to replace the subject and preview text,
 *   the pictures made or picked for it (top first), and the last draft's pictures to take out.
 * @returns The dialog.
 */
export function DraftDialog({
  campaignId,
  promoId,
  buttonUrl,
  canPicture,
  pictures,
  fromPost = false,
  postBrief = "",
  onClose,
  onDraft,
}: {
  campaignId: string;
  promoId: string | null;
  buttonUrl: string;
  canPicture: boolean;
  pictures: readonly string[];
  fromPost?: boolean;
  postBrief?: string;
  onClose: () => void;
  onDraft: (
    draft: AiDraft,
    withSubject: boolean,
    pictures: HandedPicture[],
    previous: string[],
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
  // While pictures are made, the step holds how many.
  const [step, setStep] = useState<"email" | { pictures: number } | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const busy = step !== null;

  /**
   * Hands the draft over, says which pictures couldn't be made, and remembers the ones it put
   * in so the next draft takes them out first.
   * @param draft - The email draft.
   * @param handed - The pictures made or picked for it.
   * @param failed - Why any pictures couldn't be made.
   */
  const handOver = useCallback(
    (draft: AiDraft, handed: HandedPicture[], failed: readonly string[]) => {
      if (failed.length > 0) {
        toast(
          failed.length === 1
            ? `A picture couldn't be made: ${failed[0]}`
            : `${failed.length} pictures couldn't be made: ${failed.join(" ")}`,
          { tone: "error" },
        );
      }
      const previous = readDraftBrief(campaignId)?.pictures ?? [];
      saveDraftPictures(
        campaignId,
        handed.map((p) => p.url),
      );
      onDraft(
        draft,
        withSubject,
        [...handed].sort((a, b) => a.at - b.at),
        previous,
      );
    },
    [campaignId, onDraft, toast, withSubject],
  );

  /**
   * Moves on from the picture being drawn: to the next one, or hands the draft over after the
   * last.
   * @param picture - The finished picture, or null when it failed.
   * @param why - Why it failed, when it did.
   */
  const nextPicture = useCallback(
    (picture: DraftedPicture | null, why = "") => {
      if (!drawing) return;
      const [job, ...queue] = drawing.queue;
      if (!job) return;
      const next: Drawing = {
        ...drawing,
        done: picture
          ? [...drawing.done, { url: picture.url, alt: picture.alt, at: job.at, reusedFrom: null }]
          : drawing.done,
        failed: picture
          ? drawing.failed
          : [...drawing.failed, `${why} Its design "${job.design.name}" is in Post maker.`],
        queue,
      };
      if (queue.length > 0) setDrawing(next);
      else handOver(next.draft, next.done, next.failed);
    },
    [drawing, handOver],
  );
  const onPictureDone = useCallback(
    (picture: DraftedPicture) => nextPicture(picture),
    [nextPicture],
  );
  const onPictureFail = useCallback((message: string) => nextPicture(null, message), [nextPicture]);

  /** Asks for the draft, then the words for its new pictures, and starts drawing them. */
  async function write(): Promise<void> {
    setStep("email");
    const last = readDraftBrief(campaignId);
    const res = await callApi<{ draft: AiDraft; pictures: PlannedPicture[] }>(
      "/api/admin/mailing/ai-draft",
      "POST",
      {
        brief,
        kind,
        promoId,
        buttonUrl,
        picture: canPicture && withPicture,
        campaignId,
        inEmail: pictures,
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
      pictures: last?.pictures ?? [],
      ...(source === "post" ? { source } : {}),
    });
    const { draft } = res;
    const reused: HandedPicture[] = res.pictures.flatMap((p) =>
      p.reuse ? [{ url: p.reuse.url, alt: p.reuse.alt, at: p.at, reusedFrom: p.reuse.name }] : [],
    );
    const fresh = res.pictures.flatMap((p) => (p.look ? [{ at: p.at, look: p.look }] : []));
    if (fresh.length === 0) {
      handOver(draft, reused, []);
      return;
    }

    // Each new picture gets its words at once; drawing them takes turns on one hidden stage.
    setStep({ pictures: fresh.length });
    const made = await Promise.all(
      fresh.map((p, slot) =>
        callApi<PictureJob>("/api/admin/mailing/ai-picture", "POST", {
          brief,
          kind: p.look,
          name: pictureNameOf(draft, p.at),
          campaignId,
          part: p.at > 0 ? (draft.paragraphs[p.at] ?? "") : "",
          slot,
        }),
      ),
    );
    const queue: QueuedJob[] = [];
    const failed: string[] = [];
    made.forEach((pic, i) => {
      if (pic.ok) queue.push({ ...pic, at: fresh[i]!.at });
      else failed.push(pic.error);
    });
    if (queue.length === 0) {
      handOver(draft, reused, failed);
      return;
    }
    // DraftPicture draws and stores each one, then calls back.
    setDrawing({ draft, done: reused, queue, failed, total: queue.length });
  }

  const job = drawing?.queue[0] ?? null;
  let stepLabel = "";
  if (step === "email") stepLabel = "Writing the email...";
  else if (step && drawing && drawing.total > 1) {
    stepLabel = `Making pictures to go with it: ${drawing.total - drawing.queue.length + 1} of ${drawing.total}...`;
  } else if (step) {
    stepLabel =
      step.pictures === 1
        ? "Making a picture to go with it..."
        : `Making ${step.pictures} pictures to go with it...`;
  }

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
              Add a picture if it fits (a thank-you, tip, scam warning, promo or news), and in a
              long email with three or more parts, one more above the part that most needs it, like
              a scam warning. One of your Post maker pictures goes in where it already says the same
              thing; otherwise a new one is made and saved there. Drafting this email again redraws
              them rather than saving more, unless one has gone in a post or another email.
            </span>
          </label>
        )}
        <p aria-live="polite" className="min-h-5 text-sm text-admin-muted">
          {stepLabel}
        </p>
      </div>
      {job && (
        <DraftPicture key={job.design.id} job={job} onDone={onPictureDone} onFail={onPictureFail} />
      )}
    </Modal>
  );
}
