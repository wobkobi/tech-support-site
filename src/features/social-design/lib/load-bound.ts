// src/features/social-design/lib/load-bound.ts
// Server-side loader for bound layers' live values, read the same way the social composer reads them.

import { promoWording } from "@/features/mailing/lib/context";
import type { BoundValues } from "@/features/social-design/lib/doc";
import { getSettings } from "@/shared/lib/settings/get-settings";

/**
 * Loads every bound value.
 * @returns Live values; null where a setting is blank or no promo is running.
 */
export async function loadBoundValues(): Promise<BoundValues> {
  const [{ identity }, { promo }] = await Promise.all([getSettings(), promoWording(null)]);
  return {
    phone: identity.phone || null,
    email: identity.email || null,
    website: identity.website || null,
    promoOffer: promo?.offer ?? null,
    promoEnds: promo?.ends ?? null,
    promoSummary: promo?.summary ?? null,
  };
}
