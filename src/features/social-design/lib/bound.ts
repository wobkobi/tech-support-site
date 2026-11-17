// src/features/social-design/lib/bound.ts
// Words a bound layer draws (contact details, promo wording), or a bracketed reminder when empty
// so a blank layer is never silently exported. A reminder blocks storing and downloading pictures.

import type {
  BoundValues,
  ContactLayer,
  DesignDoc,
  Layer,
  PromoLayer,
} from "@/features/social-design/lib/doc";
import type { FormatKey } from "@/features/social-design/lib/formats";

const PROMO_KEY = { offer: "promoOffer", ends: "promoEnds", summary: "promoSummary" } as const;

/** What a promo layer draws when no promo is running. */
export const NO_PROMO_TEXT = "[No promo running]";

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
    return bound[PROMO_KEY[layer.field]] ?? NO_PROMO_TEXT;
  }
  return layer.fields.map((f) => bound[f] ?? `[Add your ${f} in Settings]`).join("\n");
}

/**
 * Whether a design draws promo wording, so its pictures carry the running promo's offer and end
 * date and any post made from them must stop once that promo ends.
 * @param doc - Design.
 * @returns True when any layer is a promo layer.
 */
export function usesPromo(doc: Pick<DesignDoc, "layers">): boolean {
  return doc.layers.some((l) => l.type === "promo");
}

/**
 * Whether a layer is drawn on a size: placed there, not hidden, and not a contact layer on a
 * paid ad (the same rule the exporter follows).
 * @param doc - Design.
 * @param layer - Layer.
 * @param format - Size.
 * @returns True when it shows in that size's picture.
 */
function drawnOn(doc: DesignDoc, layer: Layer, format: FormatKey): boolean {
  const g = doc.layouts[format]?.[layer.id];
  return !!g && !g.hidden && !(doc.paidAd && layer.type === "contact");
}

/**
 * Why a design's pictures can't be stored or downloaded: a promo or contact layer would draw its
 * bracketed reminder instead of real words.
 * @param doc - Design.
 * @param bound - Live values.
 * @param formats - Sizes to check; every size the design has when left out.
 * @returns The reason, or null when every bound layer has real words.
 */
export function placeholderProblem(
  doc: DesignDoc,
  bound: BoundValues,
  formats: readonly FormatKey[] = doc.formats,
): string | null {
  const shown = doc.layers.filter((l) => formats.some((f) => drawnOn(doc, l, f)));
  if (shown.some((l) => l.type === "promo" && bound[PROMO_KEY[l.field]] === null)) {
    return `No promo is running, so the picture would say "${NO_PROMO_TEXT}". Start a promo, or take the promo words out of the design.`;
  }
  const missing = shown.flatMap((l) =>
    l.type === "contact" ? l.fields.filter((f) => bound[f] === null) : [],
  );
  if (missing.length > 0) {
    const first = missing[0]!;
    return `Your ${first} isn't set, so the picture would say "[Add your ${first} in Settings]". Add it in Settings, or take it out of the contact details.`;
  }
  return null;
}
