// src/shared/components/PageLayout.tsx
// Page wrapper, the grey card page behind booking, review, error and email-link pages, and
// the card class strings those pages use.

import { cn } from "@/shared/lib/cn";
import type React from "react";

// Phone padding is deliberately tight: the page gutter, CARD and any item card inside it
// each add their own inset, and at 390px wide a looser stack leaves body text barely half
// the screen, so every line wraps and long pages run to 5-7 screens.
export const CARD = "border-seasalt-200/80 bg-white rounded-xl border p-4 shadow-sm sm:p-6";

/**
 * Item card nested in a CARD. On phones it swaps border and shadow for a top divider (skipped
 * on the first child) to free width; from sm up it is a card again.
 */
export const NESTED_CARD =
  "border-seasalt-200/60 border-t pt-4 first:border-t-0 first:pt-0 sm:rounded-lg sm:border sm:bg-white sm:p-4 sm:shadow-sm sm:first:border-t sm:first:pt-4";

export const SOFT_CARD =
  "border-seasalt-200/80 bg-white/60 rounded-xl border p-3 text-base sm:p-4 sm:text-lg";

/** Ground of a {@link CardPage}, shared with its loading state so the swap doesn't flash white. */
export const CARD_PAGE_GROUND = "bg-seasalt";

/** Props for PageShell. */
export interface PageShellProps {
  /** Child elements to render. */
  children: React.ReactNode;
  /** Extra classes on the main element, such as a different ground colour. */
  className?: string;
}

/**
 * Page wrapper: the main landmark on white, body text 17px on phones and 18px from sm.
 * @param props - Component props.
 * @param props.children - Page content.
 * @param props.className - Extra classes on the main element.
 * @returns Page shell element.
 */
export function PageShell({ children, className }: PageShellProps): React.ReactElement {
  return (
    <main
      id="main"
      className={cn(
        "min-h-[calc(100dvh-5rem)] bg-white text-[1.0625rem] text-rich-black sm:text-lg",
        className,
      )}
    >
      {children}
    </main>
  );
}

/** Props for CardPage. */
export interface CardPageProps {
  /** The page's white cards. */
  children: React.ReactNode;
  /** Column max width. Default scales with viewport: 1440px on 1080p, ~1920px on 1440p, capped at 2240px on 4K. */
  maxWidth?: string;
}

/**
 * White cards in a centred column on the grey the page-head band uses, so each card stands
 * out instead of sitting white on white.
 * @param props - Component props.
 * @param props.children - The page's cards.
 * @param props.maxWidth - Optional column max width.
 * @returns Page element.
 */
export function CardPage({
  children,
  maxWidth = "clamp(90rem, 75vw, 140rem)",
}: CardPageProps): React.ReactElement {
  return (
    <PageShell className={CARD_PAGE_GROUND}>
      <div
        className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-10 md:px-8 md:py-12"
        style={{ maxWidth }}
      >
        {children}
      </div>
    </PageShell>
  );
}
