"use client";
// src/features/social-design/components/canvas/export.tsx
// Draws one size of a design to a picture file at its exact pixel size. Every image,
// QR code and font the size needs is loaded first, so the hidden full-size stage has
// all of it on its first render; one stage is mounted at a time and dropped straight
// after, which keeps memory down on phones. Independent of the editor's zoom.

import { DesignPreview } from "@/features/social-design/components/canvas/DesignPreview";
import { loadExo } from "@/features/social-design/components/canvas/fonts";
import { iconDataUri } from "@/features/social-design/components/canvas/icon-art";
import { qrImageUrl } from "@/features/social-design/components/canvas/qr-art";
import { loadImage } from "@/features/social-design/components/canvas/use-image";
import { BACKDROP_BLURRED_SRC, hexOf, LOGOS } from "@/features/social-design/lib/brand";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import { leftOffPaidAd } from "@/features/social-design/lib/pictures";
import type Konva from "konva";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** File type of an exported picture. */
export type PictureType = "image/jpeg" | "image/png";

/** What one export draws. */
export interface PictureRequest {
  doc: DesignDoc;
  format: FormatKey;
  /** 1 for the size itself, 2 for paid ads. */
  scale: number;
  type: PictureType;
}

/** An export waiting for its stage. */
interface Job extends PictureRequest {
  key: number;
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
}

/**
 * Loads every file a size draws: photos, backdrops, logos, icons, QR codes and Exo.
 * Rejects when one can't be loaded, so a picture never goes out with a gap in it.
 * @param doc - Design.
 * @param format - Size.
 * @param family - Exo's font-family list.
 */
async function preload(doc: DesignDoc, format: FormatKey, family: string): Promise<void> {
  const layout = doc.layouts[format] ?? {};
  const sources: (string | Promise<string> | null)[] = [];
  for (const layer of doc.layers) {
    const g = layout[layer.id];
    if (!g || g.hidden || leftOffPaidAd(layer, doc.paidAd)) continue;
    switch (layer.type) {
      case "image":
        sources.push(layer.src || iconDataUri("FaCamera", hexOf("moonstone-600")));
        break;
      case "backdrop":
        if (layer.source === "brand") sources.push(BACKDROP_BLURRED_SRC);
        else if (layer.source === "photo" && layer.src) sources.push(layer.src);
        break;
      case "logo":
        sources.push(LOGOS[layer.variant].src);
        break;
      case "icon":
        sources.push(iconDataUri(layer.icon, hexOf(layer.colour)));
        break;
      case "qr":
        sources.push(qrImageUrl(layer.url, hexOf(layer.colour)));
        break;
      default:
        break;
    }
  }
  // A null source is an icon this version doesn't know; the layer draws nothing.
  await Promise.all([
    loadExo(family),
    ...sources.map(async (s) => {
      const src = await s;
      if (src) await loadImage(src);
    }),
  ]);
}

/**
 * Waits for the browser's next frame.
 * @returns Resolves on the next animation frame.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * A full-size stage off screen that turns itself into a file once mounted.
 * @param props - Component props.
 * @param props.job - What to draw, and where the file goes.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Exo's font-family list.
 * @returns Hidden stage.
 */
function ExportStage({
  job,
  bound,
  family,
}: {
  job: Job;
  bound: BoundValues;
  family: string;
}): React.ReactElement {
  const stageRef = useRef<Konva.Stage>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      // Two frames: the photo filters cache themselves in their own effects.
      await nextFrame();
      await nextFrame();
      const stage = stageRef.current;
      if (!live) return;
      if (!stage) throw new Error("The picture couldn't be drawn.");
      // Re-run the photo filters at the export scale, or a 2x picture gets 1x photos.
      for (const node of stage.find("Image")) {
        if ((node as Konva.Image).filters()?.length) node.cache({ pixelRatio: job.scale });
      }
      const blob = (await stage.toBlob({
        mimeType: job.type,
        quality: 0.9,
        pixelRatio: job.scale,
      })) as Blob | null;
      if (!blob) throw new Error("The picture couldn't be drawn.");
      return blob;
    })().then(
      (blob) => {
        if (blob) job.resolve(blob);
      },
      (error: unknown) =>
        job.reject(error instanceof Error ? error : new Error("The picture couldn't be drawn.")),
    );
    return () => {
      live = false;
    };
  }, [job]);
  return (
    <div aria-hidden className="pointer-events-none fixed top-0 left-[-99999px]">
      <DesignPreview
        doc={job.doc}
        format={job.format}
        bound={bound}
        family={family}
        height={FORMATS[job.format].height}
        transparent={job.type === "image/png"}
        stageRef={stageRef}
      />
    </div>
  );
}

/**
 * Exports pictures one at a time through a hidden stage.
 * @param bound - Live values for contact and promo layers.
 * @param family - Exo's font-family list, or null until it has loaded.
 * @returns `exportPicture`, and the hidden stage to render somewhere in the page.
 */
export function usePictureExporter(
  bound: BoundValues,
  family: string | null,
): {
  exportPicture: (request: PictureRequest) => Promise<Blob>;
  stage: React.ReactElement | null;
} {
  const [job, setJob] = useState<Job | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const counter = useRef(0);

  const exportPicture = useCallback(
    (request: PictureRequest): Promise<Blob> => {
      /**
       * Loads the size's files, then mounts its stage and waits for the file.
       * @returns The picture.
       */
      const run = async (): Promise<Blob> => {
        if (!family) throw new Error("The fonts are still loading. Try again in a moment.");
        await preload(request.doc, request.format, family);
        counter.current += 1;
        const key = counter.current;
        try {
          return await new Promise<Blob>((resolve, reject) =>
            setJob({ ...request, key, resolve, reject }),
          );
        } finally {
          setJob(null);
        }
      };
      // One stage at a time: each export waits for the one before it, failed or not.
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [family],
  );

  const stage =
    job && family ? <ExportStage key={job.key} job={job} bound={bound} family={family} /> : null;
  return { exportPicture, stage };
}

/**
 * Saves a file to the operator's downloads.
 * @param blob - File contents.
 * @param name - File name.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start reading the file after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
