"use client";
// src/features/admin/components/settings/WatermarkPreview.tsx
// Live sample of Add my logo on a wide and a tall photo, placed with the same watermarkBox maths
// the upload uses, so the preview matches what lands on a real photo.

import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { LOGOS } from "@/features/social-design/lib/brand";
import { watermarkBox } from "@/features/social/lib/watermark";
import type { WatermarkSettings } from "@/shared/lib/settings/types";
import type React from "react";

const SAMPLE_SRC = "/source/harrison-2026.jpg";

/** Upload sizes after shrinking (longest side 1200px), so the 48px floor shows true to size. */
const SAMPLES = [
  { label: "Wide photo", width: 1200, height: 800 },
  { label: "Tall photo", width: 960, height: 1200 },
] as const;

/**
 * Watermark preview.
 * @param props - Component props.
 * @param props.watermark - The watermark settings being edited.
 * @returns Preview element.
 */
export function WatermarkPreview({
  watermark,
}: {
  watermark: WatermarkSettings;
}): React.ReactElement {
  return (
    <Card className="bg-admin-bg">
      <h3 className={ADMIN_EYEBROW_CLS}>Your logo on photos</h3>
      <p className="mt-1 text-sm text-admin-muted">
        {watermark.on
          ? "How new photos come out. Each photo's Add my logo switch can still take it off."
          : "Off: new photos go up as they are. Tick Add my logo on a photo to put it on that one."}
      </p>
      <div className="mt-3 grid grid-cols-[3fr_2fr] items-start gap-3">
        {SAMPLES.map((s) => (
          <figure key={s.label} className="flex flex-col gap-1">
            <SamplePhoto watermark={watermark} width={s.width} height={s.height} />
            <figcaption className="text-sm text-admin-muted">{s.label}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  );
}

/**
 * One sample photo with the logo laid over it as percentages of the photo.
 * @param props - Component props.
 * @param props.watermark - The watermark settings.
 * @param props.width - Sample width in pixels.
 * @param props.height - Sample height in pixels.
 * @returns Photo element.
 */
function SamplePhoto({
  watermark,
  width,
  height,
}: {
  watermark: WatermarkSettings;
  width: number;
  height: number;
}): React.ReactElement {
  const box = watermarkBox(width, height, watermark);
  /**
   * A horizontal length as a share of the photo.
   * @param px - Pixels across.
   * @returns CSS percentage.
   */
  const across = (px: number): string => `${(px / width) * 100}%`;
  /**
   * A vertical length as a share of the photo.
   * @param px - Pixels down.
   * @returns CSS percentage.
   */
  const down = (px: number): string => `${(px / height) * 100}%`;

  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-admin-border"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SAMPLE_SRC} alt="" className="size-full object-cover" />
      {watermark.on && (
        <div aria-hidden className="absolute inset-0" style={{ opacity: watermark.opacity / 100 }}>
          <div
            className="absolute bg-white"
            style={{
              left: across(box.plate.x),
              top: down(box.plate.y),
              width: across(box.plate.w),
              height: down(box.plate.h),
              borderRadius: `${(box.plate.radius / box.plate.w) * 100}% / ${(box.plate.radius / box.plate.h) * 100}%`,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGOS[watermark.logo].src}
            alt=""
            className="absolute"
            style={{
              left: across(box.logo.x),
              top: down(box.logo.y),
              width: across(box.logo.w),
              height: down(box.logo.h),
            }}
          />
        </div>
      )}
    </div>
  );
}
