"use client";
// src/features/mailing/components/blocks/usePictureUpload.ts
// Shrinks and uploads one picture for an email. Shared by the Picture block and the plain
// text tab's Picture button, so both go through the same resize and the same Blob route.

import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { shrinkImage } from "@/shared/lib/resize-image";
import { useState } from "react";

/**
 * Picture upload for the email editor.
 * @returns `upload`, which resolves to the stored picture's URL or null on failure
 *   (after a toast saying why), and `busy` while one is in flight.
 */
export function usePictureUpload(): {
  upload: (file: File, shade?: number) => Promise<string | null>;
  busy: boolean;
} {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  /**
   * Shrinks and uploads a picked file.
   * @param file - The picked image.
   * @param shade - Darkening for a photo that sits behind words, as for shrinkImage.
   * @returns The picture's URL, or null when it failed.
   */
  async function upload(file: File, shade = 0): Promise<string | null> {
    setBusy(true);
    try {
      const { file: small } = await shrinkImage(file, undefined, shade);
      const form = new FormData();
      form.append("file", small);
      const res = await callApi<{ url: string }>("/api/admin/mailing/upload", "POST", form);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return null;
      }
      return res.url;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the picture.", {
        tone: "error",
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { upload, busy };
}
