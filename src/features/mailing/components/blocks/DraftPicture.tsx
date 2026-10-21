"use client";
// src/features/mailing/components/blocks/DraftPicture.tsx
// Finishes the picture an email draft asked for: measures the drafted words, saves the design,
// draws its Landscape size off screen and stores it. Loaded only when a draft wants a picture,
// so the canvas code stays out of the mail editor until then.

import { callApi } from "@/features/mailing/lib/api-client";
import { usePictureExporter } from "@/features/social-design/components/canvas/export";
import { exoFamily, loadExo } from "@/features/social-design/components/canvas/fonts";
import { reflowText } from "@/features/social-design/components/canvas/text-layout";
import { fillDraft, type DesignDraft } from "@/features/social-design/lib/ai-draft";
import type { DesignRow, RenderRow } from "@/features/social-design/lib/design-row";
import { docHash, type BoundValues, type DesignDoc } from "@/features/social-design/lib/doc";
import { makeRoom } from "@/features/social-design/lib/editor-ops";
import type { FormatKey } from "@/features/social-design/lib/formats";
import { autoAltText } from "@/features/social-design/lib/pictures";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** The size an email shows: wide, so it doesn't push the words off a phone screen. */
const EMAIL_FORMAT: FormatKey = "landscape";

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
  const [family, setFamily] = useState<string | null>(null);
  const { exportPicture, stage } = usePictureExporter(job.bound, family);
  // Strict mode runs effects twice; the job must only draw and store once.
  const started = useRef(false);

  useEffect(() => {
    let live = true;
    const fam = exoFamily();
    void loadExo(fam)
      .catch(() => undefined)
      .then(() => {
        if (live) setFamily(fam);
      });
    return () => {
      live = false;
    };
  }, []);

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
      const blob = await exportPicture({
        doc,
        format: EMAIL_FORMAT,
        scale: 1,
        type: "image/jpeg",
      });
      const form = new FormData();
      form.append("format", EMAIL_FORMAT);
      // Matches the saved design, so the picker and Post maker see the picture as current.
      form.append("docHash", docHash(doc, bound));
      form.append("file", blob, `${EMAIL_FORMAT}.jpg`);
      const stored = await callApi<{ render: RenderRow }>(
        `/api/admin/social/designs/${design.id}/renders`,
        "POST",
        form,
      );
      if (!stored.ok) throw new Error(stored.error);
      return { url: stored.render.url, alt: autoAltText(doc) };
    })().then(onDone, (error: unknown) =>
      onFail(error instanceof Error ? error.message : "The picture couldn't be drawn."),
    );
  }, [family, job, exportPicture, onDone, onFail]);

  return stage;
}
