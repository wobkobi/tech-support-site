"use client";
// src/features/reviews/components/PausableMarquee.tsx
// Visible pause control for the reviews carousel. Hover and focus already hold the
// scroll, but neither is available to someone reading on a phone, and moving content
// that runs past five seconds needs a way to stop it (WCAG 2.2.2).

import type React from "react";
import { useState } from "react";
import { FaPause, FaPlay } from "react-icons/fa6";

/**
 * Wraps a marquee track and pauses it on request. The pause itself is CSS:
 * `[data-paused] .animate-marquee` in globals.css.
 * @param props - Component props.
 * @param props.children - The marquee viewport and track.
 * @returns The wrapped marquee with its pause button.
 */
export function PausableMarquee({ children }: { children: React.ReactNode }): React.ReactElement {
  const [paused, setPaused] = useState(false);
  return (
    <div data-paused={paused || undefined}>
      {children}
      {/* Hidden under reduced motion, where the carousel does not move. */}
      <div className="mt-2 flex justify-end motion-reduce:hidden">
        <button
          type="button"
          // The label flips instead of using aria-pressed, which would announce
          // both a state and a changed name.
          onClick={() => setPaused((p) => !p)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-semibold text-russian-violet transition-colors hover:bg-russian-violet/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet"
        >
          {paused ? (
            <FaPlay className="size-3.5" aria-hidden="true" />
          ) : (
            <FaPause className="size-3.5" aria-hidden="true" />
          )}
          {paused ? "Play reviews" : "Pause reviews"}
        </button>
      </div>
    </div>
  );
}
