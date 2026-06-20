// src/shared/components/PageLayout.tsx
/**
 * @file PageLayout.tsx
 * @description Reusable layout components with frosted glass effect.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";

export const CARD = "border-seasalt-400/80 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

export const SOFT_CARD =
  "border-seasalt-400/80 bg-seasalt-900/60 rounded-xl border p-3 text-base sm:p-4 sm:text-lg";

/** Props for PageShell. */
export interface PageShellProps {
  /** Child elements to render. */
  children: React.ReactNode;
}

/**
 * Main page shell with fixed backdrop image.
 * @param props - Component props.
 * @param props.children - Page content.
 * @returns Page shell element.
 */
export function PageShell({ children }: PageShellProps): React.ReactElement {
  return (
    <main id="main" className="relative min-h-[calc(100dvh-4rem)] overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* Vanilla <picture> not <Image>: the AVIF + WebP variants are pre-built
            by build:icons; Next's re-transcode reintroduced gradient blocking.
            WebP source carries iOS 15 / older Safari users who lack AVIF. */}
        <picture>
          <source type="image/avif" srcSet="/source/backdrop-blur.avif" />
          <img
            src="/source/backdrop-blur.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 transform-gpu object-cover"
          />
        </picture>
      </div>
      {children}
    </main>
  );
}

/** Props for FrostedSection. */
export interface FrostedSectionProps {
  /** Child elements to render. */
  children: React.ReactNode;
  /** Max width override. Default scales with viewport: 1440px on 1080p, ~1920px on 1440p, capped at 2240px on 4K. */
  maxWidth?: string;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Frosted glass content section.
 * @param props - Component props.
 * @param props.children - Section content.
 * @param props.maxWidth - Optional max width override.
 * @param props.className - Optional additional classes.
 * @returns Frosted section element.
 */
export function FrostedSection({
  children,
  maxWidth = "clamp(90rem, 75vw, 140rem)",
  className,
}: FrostedSectionProps): React.ReactElement {
  return (
    <div
      className={cn("mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10", className)}
      style={{ maxWidth }}
    >
      <div className="rounded-2xl border border-seasalt-400/40 bg-seasalt-800/60 p-4 shadow-lg backdrop-blur-md sm:p-6 md:p-8">
        {children}
      </div>
    </div>
  );
}
