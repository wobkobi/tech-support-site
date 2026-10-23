// src/shared/components/PageLoadingShell.tsx
// Loading state for public routes: the site backdrop with a centred spinning wheel, so a
// page load keeps the background instead of flashing a blank frame.

import { LoadingSpinner } from "@/shared/components/LoadingSpinner";
import { CARD_PAGE_GROUND, PageShell } from "@/shared/components/PageLayout";
import type React from "react";

/** Props for {@link PageLoadingShell}. */
interface PageLoadingShellProps {
  /** Page name folded into the screen-reader text, e.g. "about page". */
  label: string;
  /** The page is a CardPage, so load on its grey instead of white. */
  cardPage?: boolean;
}

/**
 * Public route-loading state: {@link PageShell} backdrop plus a {@link LoadingSpinner}
 * centred in the viewport below the nav.
 * @param props - Component props.
 * @param props.label - Page name for the screen-reader text.
 * @param props.cardPage - Load on the card page's grey.
 * @returns Loading element.
 */
export function PageLoadingShell({ label, cardPage }: PageLoadingShellProps): React.ReactElement {
  return (
    <PageShell className={cardPage ? CARD_PAGE_GROUND : undefined}>
      <LoadingSpinner label={label} className="min-h-[calc(100dvh-4rem)]" />
    </PageShell>
  );
}
