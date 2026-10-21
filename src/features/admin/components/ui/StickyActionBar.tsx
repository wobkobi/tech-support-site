// src/features/admin/components/ui/StickyActionBar.tsx
// Save/send bar that pins to the bottom of the screen on lg+ while its form scrolls.
// Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link StickyActionBar}. */
interface StickyActionBarProps {
  children: React.ReactNode;
  /**
   * "card" (default) runs edge to edge inside a Card with a rule on top; "page" is a
   * free-standing bordered bar on lg+ for a form that isn't inside one card, and just its
   * row of buttons below lg.
   */
  variant?: "card" | "page";
  /**
   * Pin on phones too, as one of the admin phone bars (see `data-phone-bar` in
   * globals.css): the bottom tab bar hides and the quick-actions button rides above it.
   */
  stickOnPhone?: boolean;
  className?: string;
}

/**
 * Bottom action bar. Below lg it sits in the flow at the end of its form, so phones keep
 * their screen space, unless `stickOnPhone` is set. The card variant reads the Card's
 * `--card-pad-x` to reach its edges, so it must sit directly in the card's padding box.
 * @param props - Component props.
 * @param props.children - The bar's buttons and status text.
 * @param props.variant - "card" (edge to edge in a Card) or "page" (its own bordered bar on lg+).
 * @param props.stickOnPhone - Pin below lg too, as a phone action bar.
 * @param props.className - Extra classes.
 * @returns The bar element.
 */
export function StickyActionBar({
  children,
  variant = "card",
  stickOnPhone = false,
  className,
}: StickyActionBarProps): React.ReactElement {
  return (
    <div
      data-phone-bar={stickOnPhone ? "sticky" : undefined}
      className={cn(
        "bottom-0 z-10 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2",
        stickOnPhone ? "sticky" : "lg:sticky",
        variant === "card"
          ? "-mx-(--card-pad-x,0px) border-t border-admin-border bg-admin-surface/95 px-(--card-pad-x,0px) py-2.5 backdrop-blur"
          : "lg:bottom-4 lg:rounded-lg lg:border lg:border-admin-border lg:bg-admin-surface/95 lg:px-4 lg:py-2.5 lg:shadow-sm lg:backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}
