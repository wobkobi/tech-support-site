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
    if (!PIXEL_ID) return;
    /**
     * Tracks the event if the Pixel has loaded.
     * @returns Whether it was sent.
     */
    const fire = (): boolean => {
      if (typeof window.fbq !== "function") return false;
      window.fbq("track", event);
      return true;
    };
    if (fire()) return;
    // The Pixel loads after the page does (lazyOnload), so on a direct landing this mounts
    // first; wait up to 30s for it rather than drop the event.
    let tries = 0;
    const timer = window.setInterval(() => {
      if (fire() || ++tries >= 60) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [event]);

  return null;
}
