// src/features/social-design/components/canvas/qr-art.ts
// QR code layers' artwork, in the same rounded style as the printed QR codes from
// scripts/build-icons (rounded dots, extra-rounded corner squares, dot centres) on a
// white square with a quiet-zone margin, so phones scan it off a busy backdrop. Drawn
// once per address and colour to a PNG blob URL, which the canvas loads like any image;
// blob URLs are same-origin, so the canvas stays exportable.

import { useEffect, useState } from "react";

// Drawn big enough to stay sharp at the largest size a QR layer exports.
const QR_PX = 1024;

const cache = new Map<string, Promise<string>>();
// Finished draws, so a canvas mounted after the draw (an export) has the code on its
// first render instead of a placeholder.
const drawnUrls = new Map<string, string>();

/**
 * Draws a QR code and returns a blob URL for it.
 * @param url - Address the code opens.
 * @param hex - Colour of the dots.
 * @returns Blob URL of the PNG.
 */
export function qrImageUrl(url: string, hex: string): Promise<string> {
  const key = `${url}|${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = (async () => {
    // Loaded on first use: only designs with a QR code need it.
    const { default: QRCodeStyling } = await import("qr-code-styling");
    const qr = new QRCodeStyling({
      width: QR_PX,
      height: QR_PX,
      type: "canvas",
      data: url,
      margin: Math.round(QR_PX * 0.06),
      // Q, as in print: nothing is laid over the code, and it keeps modules larger than H.
      qrOptions: { typeNumber: 0, mode: "Byte", errorCorrectionLevel: "Q" },
      dotsOptions: { type: "rounded", color: hex },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { type: "extra-rounded", color: hex },
      cornersDotOptions: { type: "dot", color: hex },
    });
    const data = await qr.getRawData("png");
    if (!(data instanceof Blob)) throw new Error("Couldn't draw the QR code.");
    const src = URL.createObjectURL(data);
    drawnUrls.set(key, src);
    return src;
  })();
  // A failed draw is dropped so a later render can try again.
  made.catch(() => cache.delete(key));
  cache.set(key, made);
  return made;
}

/**
 * The blob URL of a QR code, once drawn.
 * @param url - Address the code opens.
 * @param hex - Colour of the dots.
 * @returns Blob URL, or null while drawing or on failure.
 */
export function useQrImageUrl(url: string, hex: string): string | null {
  const [drawn, setDrawn] = useState<{ key: string; src: string } | null>(null);
  const key = `${url}|${hex}`;
  const ready = drawnUrls.get(key) ?? null;
  useEffect(() => {
    if (drawnUrls.has(`${url}|${hex}`)) return;
    let live = true;
    qrImageUrl(url, hex).then(
      (src) => {
        if (live) setDrawn({ key: `${url}|${hex}`, src });
      },
      () => {
        // Failed: stays null and the layer draws its placeholder.
      },
    );
    return () => {
      live = false;
    };
  }, [url, hex]);
  return ready ?? (drawn?.key === key ? drawn.src : null);
}
