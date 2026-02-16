// src/components/SiteFrame.tsx
/**
 * @file SiteFrame.tsx
 * @description Site frame with full-bleed backdrop and consistent gutters.
 * Spacing matches the poster page: p-5 sm:p-10 on frosted container.
 */

import { cn } from "@/lib/cn";
import Image from "next/image";

/**
 * Full-bleed blurred image backdrop.
 * @returns React element.
 */
export function PageBackdrop(): React.ReactElement {
  return (
    <div className={cn("bg-seasalt-600 pointer-events-none fixed -inset-px -z-10 overflow-hidden")}>
      <Image
        src="/backdrop.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className={cn(
          "absolute inset-0 h-full w-full object-cover blur-xl",
          "origin-center scale-110 transform-gpu will-change-transform",
        )}
      />
    </div>
  );
}

/**
 * Centers content and applies the frosted panel.
 * Padding matches poster page: p-5 sm:p-10.
 * @param root0 - Component props.
 * @param root0.children - Children to render inside the panel.
 * @param root0.maxWidth - Optional max width override (default: 68rem to match poster).
 * @returns React element.
 */
export function FrostedSection({
  children,
  maxWidth = "68rem",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}): React.ReactElement {
  return (
    <div className={cn("mx-auto w-full")} style={{ maxWidth: `min(100vw - 2rem, ${maxWidth})` }}>
      <div
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-5 shadow-lg backdrop-blur-xl sm:p-10",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Main page shell with gutters and backdrop.
 * Vertical margin matches poster: my-5 sm:my-10.
 * @param root0 - Component props.
 * @param root0.children - Children to render inside the shell.
 * @returns React element.
 */
export function PageShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <main
      className={cn(
        "relative flex min-h-dvh w-full flex-col overflow-hidden py-5 sm:py-10",
        "select-text",
      )}
    >
      <PageBackdrop />
      {children}
    </main>
  );
}

/**
 * Content wrapper for inner content. No extra padding - FrostedSection handles it.
 */
export const PAGE_CONTENT = "mx-auto flex w-full max-w-5xl flex-col gap-4 sm:gap-5";

/**
 * Card with consistent padding matching poster.
 */
export const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6";

/**
 * Softer card variant.
 */
export const SOFT_CARD =
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-4 shadow-sm sm:p-5";

/**
 * Tile style for grid items.
 */
export const TILE = "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-4";
