"use client";
// src/features/social-design/components/canvas/use-format-render.tsx
// Draws one size of a saved design off screen and stores it as that size's picture, for pictures
// made outside the Post maker: an email draft's wide picture, or a post's Make a story.

import { callApi } from "@/features/mailing/lib/api-client";
import { usePictureExporter } from "@/features/social-design/components/canvas/export";
import { exoFamily, loadExo } from "@/features/social-design/components/canvas/fonts";
import type { RenderRow } from "@/features/social-design/lib/design-row";
import { docHash, type BoundValues, type DesignDoc } from "@/features/social-design/lib/doc";
import type { FormatKey } from "@/features/social-design/lib/formats";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads the font, then renders and stores sizes one at a time.
 * @param bound - Live values for contact and promo layers.
 * @returns The font family once loaded (null until then), `render`, and the hidden stage to put
 * somewhere in the page.
 */
export function useFormatRender(bound: BoundValues): {
  family: string | null;
  render: (designId: string, doc: DesignDoc, format: FormatKey) => Promise<RenderRow>;
  stage: React.ReactElement | null;
} {
  const [family, setFamily] = useState<string | null>(null);
  const { exportPicture, stage } = usePictureExporter(bound, family);

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

  const render = useCallback(
    async (designId: string, doc: DesignDoc, format: FormatKey): Promise<RenderRow> => {
      const blob = await exportPicture({ doc, format, scale: 1, type: "image/jpeg" });
      const form = new FormData();
      form.append("format", format);
      // Matches the saved design, so the picker and Post maker see the picture as current.
      form.append("docHash", docHash(doc, bound));
      form.append("file", blob, `${format}.jpg`);
      const stored = await callApi<{ render: RenderRow }>(
        `/api/admin/social/designs/${designId}/renders`,
        "POST",
        form,
      );
      if (!stored.ok) throw new Error(stored.error);
      return stored.render;
    },
    [exportPicture, bound],
  );

  return { family, render, stage };
}
