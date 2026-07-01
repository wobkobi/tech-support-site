"use client";
// src/shared/components/PixelEvent.tsx
/**
 * @description Fires a single Meta Pixel standard event once on mount, for
 * server-rendered pages that want a per-page signal (e.g. ViewContent on the
 * pricing/services pages, InitiateCheckout on the booking page). No-ops until
 * the pixel is configured. Renders no markup.
 */

import { useEffect } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

/** Props for {@link PixelEvent}. */
interface PixelEventProps {
  /** Meta Pixel standard event name to track on mount (e.g. "ViewContent"). */
  event: string;
}

/**
 * Fire a Meta Pixel standard event once when the component mounts.
 * @param props - Component props.
 * @param props.event - Standard event name to track.
 * @returns Null - this component has no markup.
 */
export function PixelEvent({ event }: PixelEventProps): null {
  useEffect(() => {
    if (PIXEL_ID && typeof window.fbq === "function") {
      window.fbq("track", event);
    }
  }, [event]);

  return null;
}
