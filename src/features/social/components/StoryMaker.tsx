"use client";
// src/features/social/components/StoryMaker.tsx
// Make a story from this: draws the tall picture off screen, then makes the story draft. From a
// design it uses the design's Story size, adding one laid out from the nearest size when the
// design has none; from a photo it pads the photo out to 9:16. Loaded only when asked for, so the
// canvas code stays out of the composer until then.

import { callApi } from "@/features/mailing/lib/api-client";
import { reflowText } from "@/features/social-design/components/canvas/text-layout";
import { useFormatRender } from "@/features/social-design/components/canvas/use-format-render";
import type { DesignRow, RenderRow } from "@/features/social-design/lib/design-row";
import { docHash, type BoundValues } from "@/features/social-design/lib/doc";
import { addFormat } from "@/features/social-design/lib/editor-ops";
import { autoAltText } from "@/features/social-design/lib/pictures";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { padToStory } from "@/features/social/lib/story-picture";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** The tall picture a story is made with. */
interface StoryPicture {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Makes the story draft from its picture.
 * @param postId - The post it's made from.
 * @param picture - The tall picture.
 * @returns The new draft's id.
 */
async function makeDraft(postId: string, picture: StoryPicture): Promise<string> {
  const res = await callApi<{ post: SocialPostRow }>(
    `/api/admin/social/${postId}/to-story`,
    "POST",
    {
      imageUrl: picture.url,
      imageWidth: picture.width,
      imageHeight: picture.height,
      imageAlt: picture.alt,
    },
  );
  if (!res.ok) throw new Error(res.error);
  return res.post.id;
}

/**
 * Draws the design's Story size, reusing the stored one when it still matches the design.
 * @param props - Component props.
 * @param props.design - The design as saved.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.onPicture - Called with the stored story picture.
 * @param props.onFail - Called with why it couldn't be drawn or stored.
 * @returns The off-screen stage while drawing, else nothing.
 */
function DesignStory({
  design,
  bound,
  onPicture,
  onFail,
}: {
  design: DesignRow;
  bound: BoundValues;
  onPicture: (picture: StoryPicture) => void;
  onFail: (message: string) => void;
}): React.ReactElement | null {
  const { family, render, stage } = useFormatRender(bound);
  // Strict mode runs effects twice; the story must only be drawn and stored once.
  const started = useRef(false);

  useEffect(() => {
    if (!family || started.current) return;
    started.current = true;
    void (async (): Promise<RenderRow> => {
      const current = design.renders.find(
        (r) => r.format === "story" && r.docHash === docHash(design.doc, bound),
      );
      if (current) return current;
      let doc = design.doc;
      if (!doc.formats.includes("story")) {
        doc = reflowText(addFormat(doc, "story"), bound, family);
        const saved = await callApi(`/api/admin/social/designs/${design.id}`, "PATCH", {
          expectedUpdatedAt: design.updatedAt,
          doc,
        });
        if (!saved.ok) throw new Error(saved.error);
      }
      return render(design.id, doc, "story");
    })().then(
      (r) =>
        onPicture({ url: r.url, width: r.width, height: r.height, alt: autoAltText(design.doc) }),
      (error: unknown) =>
        onFail(error instanceof Error ? error.message : "The story picture couldn't be drawn."),
    );
  }, [family, design, bound, render, onPicture, onFail]);

  return stage;
}

/**
 * Runs Make a story from this once it mounts.
 * @param props - Component props.
 * @param props.postId - The post the story is made from.
 * @param props.designId - Its Post maker design, or null to pad its photo instead.
 * @param props.imageUrl - Its picture, used when there's no design.
 * @param props.imageAlt - Its picture's description.
 * @param props.onDone - Called with the new story draft's id.
 * @param props.onFail - Called with why the story couldn't be made.
 * @returns The design's off-screen stage while drawing, else nothing.
 */
export function StoryMaker({
  postId,
  designId,
  imageUrl,
  imageAlt,
  onDone,
  onFail,
}: {
  postId: string;
  designId: string | null;
  imageUrl: string | null;
  imageAlt: string;
  onDone: (id: string) => void;
  onFail: (message: string) => void;
}): React.ReactElement | null {
  const [loaded, setLoaded] = useState<{ design: DesignRow; bound: BoundValues } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (designId) {
      void callApi<{ design: DesignRow; bound: BoundValues }>(
        `/api/admin/social/designs/${designId}`,
      ).then((res) => (res.ok ? setLoaded(res) : onFail(res.error)));
      return;
    }
    if (!imageUrl) {
      onFail("Add a picture first: the story is made from it.");
      return;
    }
    void (async () => {
      const tall = await padToStory(imageUrl);
      const form = new FormData();
      form.append("file", tall.file);
      const stored = await callApi<{ url: string }>("/api/admin/social/upload", "POST", form);
      if (!stored.ok) throw new Error(stored.error);
      return makeDraft(postId, {
        url: stored.url,
        width: tall.width,
        height: tall.height,
        alt: imageAlt,
      });
    })().then(onDone, (error: unknown) =>
      onFail(error instanceof Error ? error.message : "The story couldn't be made."),
    );
  }, [designId, imageUrl, imageAlt, postId, onDone, onFail]);

  if (!loaded) return null;
  return (
    <DesignStory
      design={loaded.design}
      bound={loaded.bound}
      onPicture={(picture) =>
        void makeDraft(postId, picture).then(onDone, (error: unknown) =>
          onFail(error instanceof Error ? error.message : "The story couldn't be made."),
        )
      }
      onFail={onFail}
    />
  );
}
