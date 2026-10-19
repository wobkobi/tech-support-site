// src/shared/lib/blob-image.ts
// Editors accept only public Blob store images: hotlinks can change or track opens, Meta needs a
// stable public URL, and canvas export needs CORS. Client-safe, unlike image-upload.ts.

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
