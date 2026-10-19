// src/features/social-design/lib/app-crops.ts
// What each app shows or refuses of a size, built from the composer's PICTURE_FIT rules so the
// editor overlay and the composer's crop warnings agree.

import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import {
  cropOf,
  PLATFORM_LABEL,
  shownRatio,
  SOCIAL_PLATFORMS,
} from "@/features/social/lib/validate";

/** The part of a picture one or more apps show, in picture pixels. */
export interface AppCrop {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Each app's centred visible cut of a size; apps cutting the same box share one label.
 * @param key - Size.
 * @returns Boxes for the apps that cut this size, and the apps that refuse it.
 */
export function appCrops(key: FormatKey): { crops: AppCrop[]; refusedBy: string[] } {
  const { width, height } = FORMATS[key];
  const crops: AppCrop[] = [];
  const refusedBy: string[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    if (!cropOf(platform, width, height)) continue;
    // Instagram's API refuses a picture outside its range instead of cutting it.
    if (platform === "instagram") {
      refusedBy.push(PLATFORM_LABEL[platform]);
      continue;
    }
    const ratio = shownRatio(platform, width, height);
    const w = Math.min(width, height * ratio);
    const h = Math.min(height, width / ratio);
    const box = { x: (width - w) / 2, y: (height - h) / 2, w, h };
    const same = crops.find((c) => Math.abs(c.w - w) < 1 && Math.abs(c.h - h) < 1);
    if (same) same.label += ` and ${PLATFORM_LABEL[platform]}`;
    else crops.push({ label: PLATFORM_LABEL[platform], ...box });
  }
  return { crops, refusedBy };
}
