// src/features/social/lib/watermark.ts
// "Add my logo": puts the brand logo on a white backing in one corner of a photo, in the browser,
// so it costs no server time. The settings preview places it with the same watermarkBox maths.

import { LOGOS } from "@/features/social-design/lib/brand";
import type { ShrunkImage } from "@/shared/lib/resize-image";
import type { WatermarkSettings } from "@/shared/lib/settings/types";

const JPEG_QUALITY = 0.9;
/** The logo's size floor, so it stays readable on a small photo. */
const MIN_LOGO_PX = 48;
/** The logo's size ceiling as a share of the shorter side, so the floor can't swamp a tiny one. */
const MAX_LOGO_SHARE = 0.4;
/** Gap from the photo's edges, as a share of its shorter side. */
const EDGE_GAP = 0.03;
/** White backing around the logo, as a share of the logo's shorter side. */
const PLATE_PAD = 0.18;

/** The parts of the settings that place the logo. */
export type WatermarkPlacement = Pick<WatermarkSettings, "logo" | "corner" | "size">;

/** A rectangle in pixels. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the logo and its backing go on a photo. */
export interface WatermarkBox {
  /** The white backing, with its corner radius. */
  plate: Rect & { radius: number };
  logo: Rect;
}

/**
 * Places the logo on a photo. Size is the side of a square of the same area, so the wide
 * wordmark covers no more of the photo than the square mark does at the same setting.
 * @param width - Photo width in pixels.
 * @param height - Photo height in pixels.
 * @param opts - Logo, corner and size.
 * @returns The backing and logo rectangles.
 */
export function watermarkBox(
  width: number,
  height: number,
  opts: WatermarkPlacement,
): WatermarkBox {
  const shorter = Math.min(width, height);
  const side = Math.min(
    shorter * MAX_LOGO_SHARE,
    Math.max(MIN_LOGO_PX, (shorter * opts.size) / 100),
  );
  const stretch = Math.sqrt(LOGOS[opts.logo].ratio);
  const w = side * stretch;
  const h = side / stretch;
  const pad = Math.min(w, h) * PLATE_PAD;
  const gap = shorter * EDGE_GAP;
  const plateW = w + pad * 2;
  const plateH = h + pad * 2;
  const x = opts.corner.endsWith("left") ? gap : width - gap - plateW;
  const y = opts.corner.startsWith("top") ? gap : height - gap - plateH;
  return {
    plate: { x, y, w: plateW, h: plateH, radius: pad },
    logo: { x: x + pad, y: y + pad, w, h },
  };
}

/**
 * Loads an image element. A Blob picture needs crossOrigin, or the canvas can't be read back.
 * @param src - Image URL.
 * @param cors - Whether to ask for it with CORS.
 * @returns The loaded image.
 */
function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener("error", () => reject(new Error("Couldn't load the picture.")), {
      once: true,
    });
    img.src = src;
  });
}

/**
 * Adds the logo to a photo and re-encodes it as JPEG.
 * @param source - The photo: a file being uploaded, or the URL of one already stored.
 * @param opts - Logo, corner, size and opacity from the watermark settings.
 * @returns The marked JPEG with its pixel size.
 */
export async function watermarkImage(
  source: Blob | string,
  opts: WatermarkPlacement & Pick<WatermarkSettings, "opacity">,
): Promise<ShrunkImage> {
  // A query string keeps the browser from reusing a copy it cached without CORS.
  const photo =
    typeof source === "string"
      ? await loadImage(`${source}${source.includes("?") ? "&" : "?"}logo=1`, true)
      : await createImageBitmap(source);
  const logo = await loadImage(LOGOS[opts.logo].src, false);
  const width = photo.width;
  const height = photo.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't add the logo.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(photo, 0, 0, width, height);
  if ("close" in photo) photo.close();

  const box = watermarkBox(width, height, opts);
  ctx.globalAlpha = opts.opacity / 100;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(box.plate.x, box.plate.y, box.plate.w, box.plate.h, box.plate.radius);
  ctx.fill();
  ctx.drawImage(logo, box.logo.x, box.logo.y, box.logo.w, box.logo.h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't add the logo.");
  return { file: new File([blob], "photo-logo.jpg", { type: "image/jpeg" }), width, height };
}
