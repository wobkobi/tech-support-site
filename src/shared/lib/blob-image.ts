// src/shared/lib/blob-image.ts
// Which image addresses count as the site's own: the mailing editor, the post composer
// and the post maker only accept pictures from the public Blob store. In an email a
// hotlinked image can vanish or change after sending and its host sees every open;
// Meta fetches a post's picture by URL, so it must be public and stable; and the post
// maker's canvas can only export pictures served with CORS, which Blob does.
// Client-safe (no Blob SDK, unlike image-upload.ts), so the editors run the same check.

/** Host suffix of the public Blob store every uploaded image lives in. */
export const BLOB_IMAGE_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Whether an image URL points at the site's own public Blob store over https.
 * @param url - Image URL.
 * @returns True when the host is the Blob store.
 */
export function isBlobImageUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(BLOB_IMAGE_HOST_SUFFIX);
  } catch {
    return false;
  }
}
