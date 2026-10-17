// src/shared/lib/resize-image.ts
// Browser-side image shrink before upload, shared by the mailing and social editors.
// Phone photos are 3-8 MB; an email shows them at 560px wide at most and Instagram
// takes 320-1440px, so 1200px (crisp on high-DPI screens) as JPEG brings them to a few
// hundred KB, keeping the upload under the function body limit. Post maker photos pass
// a bigger edge: a full-bleed photo on a 1080x1920 story needs more than 1200px.

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.85;

/** A shrunk image with the pixel size it came out at. */
export interface ShrunkImage {
  file: File;
  width: number;
  height: number;
}

/**
 * Scales an image so its longest edge is at most `maxEdge` and re-encodes it as JPEG.
 * Smaller images are re-encoded without scaling, which also strips camera metadata
 * like GPS location.
 * @param file - Image the operator picked.
 * @param maxEdge - Longest edge in pixels; 1200 unless a caller needs more.
 * @param shade - Opacity (0 to 1) of a brand navy wash laid over the picture, so white
 *   words on top stay readable; 0 leaves it as it is.
 * @returns A JPEG file ready to upload, with its width and height in pixels.
 */
export async function shrinkImage(file: File, maxEdge = MAX_EDGE, shade = 0): Promise<ShrunkImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  // JPEG has no transparency; a white ground keeps a transparent PNG from turning black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  if (shade > 0) {
    ctx.fillStyle = `rgba(12, 10, 62, ${Math.min(shade, 1)})`;
    ctx.fillRect(0, 0, width, height);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't convert the image.");
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return { file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }), width, height };
}
