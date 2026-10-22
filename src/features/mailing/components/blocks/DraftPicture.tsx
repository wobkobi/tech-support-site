"use client";
// src/features/mailing/components/blocks/DraftPicture.tsx
// Finishes the picture an email draft asked for: measures the drafted words, saves the design,
// draws its Landscape size off screen and stores it. Loaded only when a draft wants a picture,
// so the canvas code stays out of the mail editor until then.

import type { DraftDesign } from "@/features/mailing/components/blocks/draft-brief";
import { callApi } from "@/features/mailing/lib/api-client";
import { reflowText } from "@/features/social-design/components/canvas/text-layout";
import { useFormatRender } from "@/features/social-design/components/canvas/use-format-render";
import { fillDraft, type DesignDraft } from "@/features/social-design/lib/ai-draft";
import type { DesignRow } from "@/features/social-design/lib/design-row";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import { makeRoom } from "@/features/social-design/lib/editor-ops";
import { EMAIL_PICTURE_FORMAT } from "@/features/social-design/lib/formats";
import { autoAltText } from "@/features/social-design/lib/pictures";
import type React from "react";
import { useEffect, useRef } from "react";

/** What the ai-picture route hands back. */
export interface PictureJob {
  design: DesignRow;
  /** The starter before its words went in, to measure against. */
  template: DesignDoc;
  words: DesignDraft;
  bound: BoundValues;
}

/** A finished picture for the email. */
export interface DraftedPicture {
  url: string;
  alt: string;
  /** The design it was drawn from, for the next draft to draw over. */
  design: DraftDesign;
}

/**
 * Runs one picture job and renders its hidden stage.
 * @param props - Component props.
 * @param props.job - The design to finish.
 * @param props.onDone - Called with the stored picture.
 * @param props.onFail - Called with why it couldn't be drawn or stored.
 * @returns The off-screen stage while drawing, else nothing.
 */
export function DraftPicture({
  job,
  onDone,
  onFail,
}: {
  job: PictureJob;
  onDone: (picture: DraftedPicture) => void;
  onFail: (message: string) => void;
}): React.ReactElement | null {
  const { family, render, stage } = useFormatRender(job.bound);
  // Strict mode runs effects twice; the job must only draw and store once.
  const started = useRef(false);

  useEffect(() => {
    if (!family || started.current) return;
    started.current = true;
    const { design, template, words, bound } = job;
    void (async () => {
      // Same steps as the editor's Draft with AI: measure, fill, then move what's under
      // longer words so nothing overlaps.
      const before = reflowText(template, bound, family);
      const doc = makeRoom(before, reflowText(fillDraft(before, words).doc, bound, family));
      const saved = await callApi<{ updatedAt: string }>(
        `/api/admin/social/designs/${design.id}`,
        "PATCH",
        { expectedUpdatedAt: design.updatedAt, doc },
      );
      if (!saved.ok) throw new Error(saved.error);
      const stored = await render(design.id, doc, EMAIL_PICTURE_FORMAT);
      // Storing the picture leaves updatedAt alone, so this is how the draft left the design.
      return {
        url: stored.url,
        alt: autoAltText(doc),
        design: { id: design.id, updatedAt: saved.updatedAt },
      };
    })().then(onDone, (error: unknown) =>
      onFail(error instanceof Error ? error.message : "The picture couldn't be drawn."),
    );
  }, [family, job, render, onDone, onFail]);

  return stage;
}
