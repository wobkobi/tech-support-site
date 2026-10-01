// src/features/mailing/lib/resize-image.ts
// Browser-side image shrink before upload. Phone photos are 3-8 MB; an email shows
// them at 560px wide at most, so 1200px (crisp on high-DPI screens) as JPEG brings
// them to a few hundred KB, keeping the upload under the function body limit and the
// email fast to open on mobile data.

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.85;

/**
 * Scales an image so its longest edge is at most 1200px and re-encodes it as JPEG.
 * Smaller images are re-encoded without scaling, which also strips camera metadata
 * like GPS location.
 * @param file - Image the operator picked.
 * @returns A JPEG file ready to upload.
 */
export async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't convert the image.");
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
