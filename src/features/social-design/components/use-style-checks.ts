"use client";
// src/features/social-design/components/use-style-checks.ts
// Runs style checks while editing. Contrast waits for a pause, then draws each size without
// words at quarter size and reads pixels behind each word box; a newer edit cancels it.

import { usePictureExporter } from "@/features/social-design/components/canvas/export";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import {
  contrastIssues,
  mergeContrast,
  styleChecks,
  withoutWords,
  type Pixels,
  type StyleIssue,
} from "@/features/social-design/lib/style-checks";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

// A quarter of full size keeps each drawing quick; the blur and photos behind the words
// don't change at that scale in any way that matters for reading them.
const CONTRAST_SCALE = 0.25;
// Pause after the last edit before drawing.
const CONTRAST_WAIT_MS = 1500;

/**
 * Reads a picture file's pixels.
 * @param blob - Picture.
 * @returns Its pixels.
 */
async function pixelsOf(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas to read the picture with.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** What the checks have found. */
export interface StyleCheckState {
  /** Every issue: the design checks first, then contrast. */
  issues: StyleIssue[];
  /** Whether contrast is being worked out for the latest edit. */
  checkingContrast: boolean;
  /** Hidden stage the contrast drawings are made on; render it somewhere in the page. */
  stage: React.ReactElement | null;
}

/**
 * Style checks for the design being edited.
 * @param doc - Design.
 * @param bound - Live values for contact and promo layers.
 * @param family - Exo's font-family list, or null while it loads.
 * @returns Issues, whether contrast is still running, and the hidden stage.
 */
export function useStyleChecks(
  doc: DesignDoc,
  bound: BoundValues,
  family: string | null,
): StyleCheckState {
  const { exportPicture, stage } = usePictureExporter(bound, family);
  const designIssues = useMemo(() => styleChecks(doc, bound), [doc, bound]);
  const [contrast, setContrast] = useState<{ doc: DesignDoc; issues: StyleIssue[] } | null>(null);

  useEffect(() => {
    if (!family) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        const bare = withoutWords(doc);
        const found: StyleIssue[] = [];
        for (const format of doc.formats) {
          const blob = await exportPicture({
            doc: bare,
            format,
            scale: CONTRAST_SCALE,
            type: "image/jpeg",
          });
          if (!live) return;
          found.push(...contrastIssues(doc, format, await pixelsOf(blob), CONTRAST_SCALE, bound));
        }
        if (live) setContrast({ doc, issues: mergeContrast(doc, found, bound) });
      })().catch(() => {
        // A photo that won't load fails the drawing; the other checks still stand, and
        // the next edit tries again.
        if (live) setContrast({ doc, issues: [] });
      });
    }, CONTRAST_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, bound, family, exportPicture]);

  // Contrast found for an older version of the design stays shown until the new run
  // finishes, but only for layers that still exist.
  const contrastNow = (contrast?.issues ?? []).filter((i) =>
    doc.layers.some((l) => l.id === i.layerId),
  );
  return {
    issues: [...designIssues, ...contrastNow],
    checkingContrast: contrast?.doc !== doc,
    stage,
  };
}
