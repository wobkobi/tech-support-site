// src/components/SiteFrame.tsx
/**
 * @file SiteFrame.tsx
 * @description Reusable layout components with frosted glass effect
 */

import type React from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

export const CARD = cn(
  "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6",
);

export const SOFT_CARD = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 text-sm sm:p-4 sm:text-base",
);

/**
 * Props for PageShell component
 */
export interface PageShellProps {
  /** Child elements to render */
  children: React.ReactNode;
}

/**
 * Main page shell with backdrop image
 * @param props - Component props
 * @param props.children - Page content
 * @returns Page shell element
 */
export function PageShell({ children }: PageShellProps): React.ReactElement {
  return (
    <main className={cn("relative min-h-[calc(100vh-4rem)] overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden")}>
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className={cn("scale-110 transform-gpu object-cover blur-xl")}
        />
      </div>
      {children}
    </main>
  );
}

/**
 * Props for FrostedSection component
 */
export interface FrostedSectionProps {
  /** Child elements to render */
  children: React.ReactNode;
  /** Maximum width constraint (default: 90rem = 1440px) */
  maxWidth?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Frosted glass content section
 * @param props - Component props
 * @param props.children - Section content
 * @param props.maxWidth - Optional max width override
 * @param props.className - Optional additional classes
 * @returns Frosted section element
 */
export function FrostedSection({
  children,
  maxWidth = "90rem",
  className,
}: FrostedSectionProps): React.ReactElement {
  return (
    <div
      className={cn("mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10", className)}
      style={{ maxWidth }}
    >
      <div
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-4 shadow-lg backdrop-blur-xl sm:p-6 md:p-8",
        )}
      >
        {children}
      </div>
    </div>
  );
}
