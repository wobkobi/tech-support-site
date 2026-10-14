// src/features/social-design/components/canvas/use-image.ts
// Image loading for the canvas, shared by every layer that draws the same file. Every
// image loads with crossOrigin="anonymous": Blob answers with an open CORS header, so
// drawing it leaves the canvas exportable.

import { useEffect, useState } from "react";

const loaded = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

/**
 * Loads an image once per address.
 * @param src - Image address.
 * @returns The loaded element.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const done = loaded.get(src);
  if (done) return Promise.resolve(done);
  const inFlight = pending.get(src);
  if (inFlight) return inFlight;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    /** Caches the image and settles every waiting caller. */
    img.onload = () => {
      loaded.set(src, img);
      pending.delete(src);
      resolve(img);
    };
    /** Drops the failed load so a later call can retry. */
    img.onerror = () => {
      pending.delete(src);
      reject(new Error(`Couldn't load ${src}`));
    };
    img.src = src;
  });
  pending.set(src, promise);
  return promise;
}

/**
 * The loaded image for an address, re-rendering once it arrives.
 * @param src - Image address, or null for none.
 * @returns The element, or null while loading, on failure or with no address.
 */
export function useImage(src: string | null): HTMLImageElement | null {
  // Remember which address the arrival was for, so a swapped address never shows the
  // previous picture while the new one loads.
  const [arrived, setArrived] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src || loaded.has(src)) return;
    let live = true;
    loadImage(src).then(
      (img) => {
        if (live) setArrived({ src, img });
      },
      () => {
        // Failed: stays null, and the layer draws its empty placeholder.
      },
    );
    return () => {
      live = false;
    };
  }, [src]);
  if (!src) return null;
  return loaded.get(src) ?? (arrived?.src === src ? arrived.img : null);
}
