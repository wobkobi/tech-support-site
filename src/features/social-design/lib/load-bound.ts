// src/features/social-design/lib/load-bound.ts
// Server-side loader for bound layers' live values, read the same way the social composer reads them.

import { getActivePromo } from "@/features/business/lib/promos";
import { promoWording } from "@/features/mailing/lib/context";
import type { BoundValues } from "@/features/social-design/lib/doc";
import { getSettings } from "@/shared/lib/settings/get-settings";

/**
 * Loads every bound value, and which promo the promo values describe.
 * @returns Live values (null where a setting is blank or no promo is running) and the running
 *   promo's id, or null.
 */
export async function loadBoundState(): Promise<{ bound: BoundValues; promoId: string | null }> {
  // Both read the same cached active promo, so the id and the wording always match.
  const [{ identity }, { promo }, active] = await Promise.all([
    getSettings(),
    promoWording(null),
    getActivePromo(),
  ]);
  return {
    bound: {
      phone: identity.phone || null,
      email: identity.email || null,
      website: identity.website || null,
      promoOffer: promo?.offer ?? null,
      promoEnds: promo?.ends ?? null,
      promoSummary: promo?.summary ?? null,
    },
    promoId: promo ? (active?.id ?? null) : null,
  };
}

/**
 * Loads every bound value.
 * @returns Live values; null where a setting is blank or no promo is running.
 */
export async function loadBoundValues(): Promise<BoundValues> {
  return (await loadBoundState()).bound;
}
