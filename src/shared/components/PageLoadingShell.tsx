// src/shared/components/PageLoadingShell.tsx
// Shared wrapper for public route-loading skeletons. Owns the frosted shell and
// the live-region announcement so each `loading.tsx` carries only its bones.

import { FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface PageLoadingShellProps {
  /** Page name folded into the accessible label, e.g. "about page". */
  label: string;
  /** Narrows the frosted container; omit to keep the FrostedSection default. */
  maxWidth?: string;
  /** Tightens the vertical rhythm to gap-4 / sm:gap-5 for short pages. */
  compact?: boolean;
  /** Skeleton bones for the page being loaded. */
  children: React.ReactNode;
}

/**
 * Frosted shell for a route-loading skeleton, with the status live region and
 * screen-reader announcement applied consistently.
 * Mirrors the role AdminListSkeleton plays on the admin side.
 * @param props - Component props.
 * @param props.label - Page name folded into the accessible label.
 * @param props.maxWidth - Narrows the frosted container.
 * @param props.compact - Tightens the vertical rhythm for short pages.
 * @param props.children - Skeleton bones for the page being loaded.
 * @returns Skeleton shell element.
 */
export function PageLoadingShell({
  label,
  maxWidth,
  compact = false,
  children,
}: PageLoadingShellProps): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth={maxWidth}>
        <div
          className={cn("flex flex-col", compact ? "gap-4 sm:gap-5" : "gap-6 sm:gap-8")}
          role="status"
          aria-live="polite"
          aria-label={`Loading ${label}`}
        >
          {children}
          <span className="sr-only">{`Loading ${label}...`}</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
