// src/features/social-design/lib/bound.ts
// The words a bound layer draws: contact details from Settings and the running promo's
// wording. With nothing to show, the layer draws a bracketed reminder instead, so an
// empty layer is never silently exported.

import type { BoundValues, ContactLayer, PromoLayer } from "@/features/social-design/lib/doc";

const PROMO_KEY = { offer: "promoOffer", ends: "promoEnds", summary: "promoSummary" } as const;

/** Bound values with nothing set, for checks and before the page passes real ones. */
export const NO_BOUND: BoundValues = {
  phone: null,
  email: null,
  website: null,
  promoOffer: null,
  promoEnds: null,
  promoSummary: null,
};

/**
 * Text a bound layer draws.
 * @param layer - Contact or promo layer.
 * @param bound - Live values.
 * @returns One line per contact detail, or the promo wording.
 */
export function boundText(layer: ContactLayer | PromoLayer, bound: BoundValues): string {
  if (layer.type === "promo") {
    return bound[PROMO_KEY[layer.field]] ?? "[No promo running]";
  }
  return layer.fields.map((f) => bound[f] ?? `[Add your ${f} in Settings]`).join("\n");
}
