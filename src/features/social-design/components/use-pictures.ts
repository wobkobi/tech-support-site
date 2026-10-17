// src/features/social-design/components/use-pictures.ts
// A design's stored pictures in the editor: whether they match the design, redrawing
// and storing the out-of-date sizes one at a time (a failed size is retried alone), and
// handing them to a social post.

import { callApi } from "@/features/mailing/lib/api-client";
import {
  usePictureExporter,
  type PictureRequest,
} from "@/features/social-design/components/canvas/export";
import type { RenderRow } from "@/features/social-design/lib/design-row";
import { docHash, type BoundValues, type DesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import { pictureState, type PictureState } from "@/features/social-design/lib/pictures";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

/** Where an update is. */
export interface PictureProgress {
  /** Size being drawn and stored. */
  format: FormatKey;
  /** 1-based position of that size in this run. */
  step: number;
  total: number;
}

/** A size whose picture didn't get stored, and why. */
export interface PictureFailure {
  format: FormatKey;
  error: string;
}

/** What the editor needs from {@link usePictures}. */
export interface Pictures {
  /** Stored pictures of the sizes the design still has. */
  renders: RenderRow[];
  state: PictureState;
  progress: PictureProgress | null;
  failed: PictureFailure[];
  /**
   * Saves the design, then draws and stores the out-of-date sizes, or only those given.
   * Resolves true when every size it tried was stored.
   */
  update: (only?: FormatKey[]) => Promise<boolean>;
  exportPicture: (request: PictureRequest) => Promise<Blob>;
  /** Hidden export stage, to render anywhere in the page. */
  stage: React.ReactElement | null;
}

/**
 * Stored pictures for the open design.
 * @param options - Hook options.
 * @param options.designId - Design id.
 * @param options.doc - Design as shown (a deferred copy is fine: it only drives the state).
 * @param options.current - Reads the latest design, for what gets drawn.
 * @param options.bound - Live values for contact and promo layers.
 * @param options.family - Exo's font-family list, or null until loaded.
 * @param options.initialRenders - Pictures as loaded.
 * @param options.saveNow - Saves waiting changes; false when the save failed.
 * @returns Picture state and actions.
 */
export function usePictures({
  designId,
  doc,
  current,
  bound,
  family,
  initialRenders,
  saveNow,
}: {
  designId: string;
  doc: DesignDoc;
  current: () => DesignDoc;
  bound: BoundValues;
  family: string | null;
  initialRenders: RenderRow[];
  saveNow: () => Promise<boolean>;
}): Pictures {
  const { exportPicture, stage } = usePictureExporter(bound, family);
  const [stored, setStored] = useState(initialRenders);
  const [progress, setProgress] = useState<PictureProgress | null>(null);
  const [failed, setFailed] = useState<PictureFailure[]>([]);
  const busy = useRef(false);

  const renders = useMemo(
    () => stored.filter((r) => doc.formats.includes(r.format)),
    [stored, doc.formats],
  );
  const state = useMemo(() => pictureState(doc, bound, renders), [doc, bound, renders]);

  const update = useCallback(
    async (only?: FormatKey[]): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      try {
        // Saved first: "Use in post" checks the pictures against the design as stored.
        if (!(await saveNow())) {
          setFailed([]);
          return false;
        }
        // Drawn from one snapshot, so every size carries the same fingerprint even if
        // the operator keeps editing while this runs.
        const snapshot = current();
        const hash = docHash(snapshot, bound);
        const todo = (
          only ??
          snapshot.formats.filter((f) => stored.find((r) => r.format === f)?.docHash !== hash)
        ).filter((f) => snapshot.formats.includes(f));
        const failures: PictureFailure[] = [];
        for (const [i, format] of todo.entries()) {
          setProgress({ format, step: i + 1, total: todo.length });
          try {
            const blob = await exportPicture({
              doc: snapshot,
              format,
              scale: 1,
              type: "image/jpeg",
            });
            const form = new FormData();
            form.append("format", format);
            form.append("docHash", hash);
            form.append("file", blob, `${format}.jpg`);
            const res = await callApi<{ render: RenderRow }>(
              `/api/admin/social/designs/${designId}/renders`,
              "POST",
              form,
            );
            if (!res.ok) throw new Error(res.error);
            setStored((rs) => [...rs.filter((r) => r.format !== format), res.render]);
          } catch (error) {
            failures.push({
              format,
              error: error instanceof Error ? error.message : `${FORMATS[format].label} failed.`,
            });
          }
        }
        setFailed(failures);
        return failures.length === 0;
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [saveNow, current, bound, stored, exportPicture, designId],
  );

  return { renders, state, progress, failed, update, exportPicture, stage };
}
