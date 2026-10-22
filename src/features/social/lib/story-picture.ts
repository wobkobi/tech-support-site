// src/features/social/lib/story-picture.ts
// Pads a photo out to a 9:16 story in the browser: the whole photo centred on a blurred, darkened
// copy of itself filling the screen, so nothing is cut off and there are no plain bars.

import { loadImage } from "@/features/social/lib/watermark";
import type { ShrunkImage } from "@/shared/lib/resize-image";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const JPEG_QUALITY = 0.9;
/** Keeps the photo inside the story's bars: 14% at the top and 20% at the bottom. */
const SAFE_TOP = 0.14;
const SAFE_BOTTOM = 0.2;

/**
 * Where a picture of a size sits in a box: scaled to fit whole, or to cover it.
 * @param width - Picture width.
 * @param height - Picture height.
 * @param box - The box.
 * @param box.x - Box left.
 * @param box.y - Box top.
 * @param box.w - Box width.
 * @param box.h - Box height.
 * @param cover - True to fill the box and cut the overflow, false to fit inside it.
 * @returns The drawn rectangle, centred in the box.
 */
export function placeIn(
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
  cover: boolean,
): { x: number; y: number; w: number; h: number } {
  const scale = (cover ? Math.max : Math.min)(box.w / width, box.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Draws a stored photo as a 1080 x 1920 story picture.
 * @param url - The photo's address in the Blob store.
 * @returns The story JPEG and its size.
 */
export async function padToStory(url: string): Promise<ShrunkImage> {
  // A query string keeps the browser from reusing a copy it cached without CORS.
  const photo = await loadImage(`${url}${url.includes("?") ? "&" : "?"}story=1`, true);
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the story.");
  // Past the edges by the blur's reach, or the blur fades the copy out at the sides.
  const bleed = { x: -80, y: -80, w: STORY_WIDTH + 160, h: STORY_HEIGHT + 160 };

  const back = placeIn(photo.width, photo.height, bleed, true);
  // Browsers without canvas filters draw the copy sharp; the wash below still sets it back.
  ctx.filter = "blur(40px)";
  ctx.drawImage(photo, back.x, back.y, back.w, back.h);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(12, 10, 62, 0.45)";
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  const top = STORY_HEIGHT * SAFE_TOP;
  const safe = { x: 0, y: top, w: STORY_WIDTH, h: STORY_HEIGHT * (1 - SAFE_TOP - SAFE_BOTTOM) };
  const front = placeIn(photo.width, photo.height, safe, false);
  ctx.drawImage(photo, front.x, front.y, front.w, front.h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't draw the story.");
  return {
    file: new File([blob], "story.jpg", { type: "image/jpeg" }),
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
  };
}
