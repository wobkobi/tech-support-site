"use client";
// src/shared/components/PixelEvent.tsx
// Fires one Meta Pixel standard event on mount for server-rendered pages. No markup.

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
