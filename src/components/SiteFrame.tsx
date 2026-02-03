// src/components/SiteFrame.tsx
/**
 * Site frame with full-bleed backdrop and consistent gutters.
 * @param props.children page content
 * @returns Frame element.
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
          "will-change-transform origin-center transform-[scale(1.14)]",
        )}
      />
    </div>
  );
}

/**
 * Centers content and applies the frosted panel.
 * @param root0 Component props.
 * @param root0.children Children to render inside the panel.
 * @returns React element.
 */
export function FrostedSection({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className={cn("mx-auto w-full max-w-[min(100vw-1rem,80rem)]")}>
      <div
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-3 shadow-lg backdrop-blur-xl sm:p-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Main page shell with gutters and backdrop.
 * @param root0 Component props.
 * @param root0.children Children to render inside the shell.
 * @returns React element.
 */
export function PageShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <main
      className={cn(
        "relative flex min-h-dvh w-full flex-col overflow-hidden pb-6 pt-6 sm:pb-10 sm:pt-10",
        // Make all page text selectable
        "select-text",
      )}
    >
      <PageBackdrop />
      {children}
    </main>
  );
}
// Shared layout + surface tokens (matches the dark/frosted style used across the site)
export const PAGE_MAIN =
  "mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6 pt-4 sm:gap-8 sm:pb-8 sm:pt-6";

export const CARD = "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6";

export const SOFT_CARD =
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 shadow-sm sm:p-4";

export const TILE = "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3";
