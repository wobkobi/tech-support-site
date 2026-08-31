// src/shared/components/PromoPrice.tsx
/**
 * @description Marks a price that a promo has changed, so a discounted figure
 * is visibly not the standard one wherever it appears in prose.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link PromoPrice}. */
interface PromoPriceProps {
  /** The formatted price, e.g. "$30/hr". */
  children: React.ReactNode;
  /** Whether a promo actually changed this figure. */
  discounted: boolean;
  /** Extra classes for the wrapping span. */
  className?: string;
}

/**
 * Renders a price, accented when a promo has moved it.
 *
 * Colour alone would not carry the meaning - it fails for anyone who cannot
 * distinguish it, and this site's readers skew older - so the accent is paired
 * with bold weight and the offer is always stated in words nearby.
 * @param props - Component props.
 * @param props.children - The formatted price.
 * @param props.discounted - Whether a promo changed this figure.
 * @param props.className - Extra classes for the wrapping span.
 * @returns The price, accented when discounted.
 */
export function PromoPrice({
  children,
  discounted,
  className,
}: PromoPriceProps): React.ReactElement {
  return (
    <span className={cn(discounted && "font-bold text-coquelicot-500", className)}>{children}</span>
  );
}
