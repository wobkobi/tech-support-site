// src/features/mailing/lib/context.ts
// Server-side inputs for the mailing renderer: brand, signature, promo wording, and which
// env vars are missing. Built once per send or preview, not once per recipient.

import {
  describePromoOffer,
  findAdvertisablePromo,
  formatPromoEnd,
  getActivePromo,
  summariseForBanner,
} from "@/features/business/lib/promos";
import type { PromoWording } from "@/features/mailing/lib/render";
import { unsubscribeSecret } from "@/features/mailing/lib/unsubscribe-token";
import { brandName, buildEmailSignature } from "@/features/reviews/lib/email-core";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";

/** What every recipient's copy shares. */
export interface SharedRenderParts {
  brand: string;
  signatureHtml: string;
  promo: PromoWording | null;
  /** False when the email is tied to a promo that has ended or been switched off. */
  linkedPromoLive: boolean;
}

/**
 * Promo wording for a campaign. A linked promo is used only while it is live;
 * an unlinked campaign describes whichever automatic promo is running.
 * @param promoId - Linked promo id, or null.
 * @returns Wording plus whether a linked promo is still live.
 */
async function promoWording(
  promoId: string | null,
): Promise<{ promo: PromoWording | null; linkedPromoLive: boolean }> {
  const promo = promoId ? await findAdvertisablePromo(promoId) : await getActivePromo();
  if (!promo) return { promo: null, linkedPromoLive: promoId === null };
  return {
    promo: {
      summary: summariseForBanner(promo),
      offer: describePromoOffer(promo),
      ends: formatPromoEnd(promo.endAt),
    },
    linkedPromoLive: true,
  };
}

/**
 * Loads the parts every recipient's copy shares.
 * @param promoId - Linked promo id, or null.
 * @returns Brand, signature and promo wording.
 */
export async function loadSharedRenderParts(promoId: string | null): Promise<SharedRenderParts> {
  const [identity, signatureHtml, wording] = await Promise.all([
    getIdentity(),
    buildEmailSignature(getSiteUrl()),
    promoWording(promoId),
  ]);
  return { brand: brandName(identity), signatureHtml, ...wording };
}

/**
 * Env vars a real send needs that are missing. Sending is refused while any is.
 * @returns Missing var names, empty when sending can go ahead.
 */
export function missingSendEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (!process.env.EMAIL_FROM?.trim()) missing.push("EMAIL_FROM");
  if (!unsubscribeSecret()) missing.push("UNSUBSCRIBE_SECRET");
  return missing;
}

/**
 * Public unsubscribe page for a token. Test emails use the "preview" token,
 * which the page recognises and explains instead of acting on.
 * @param token - Signed token, or "preview".
 * @returns Absolute URL.
 */
export function unsubscribePageUrl(token: string): string {
  return `${getSiteUrl()}/unsubscribe/${encodeURIComponent(token)}`;
}

/**
 * One-click unsubscribe endpoint for the List-Unsubscribe header.
 * @param token - Signed token.
 * @returns Absolute URL.
 */
export function oneClickUnsubscribeUrl(token: string): string {
  return `${getSiteUrl()}/api/unsubscribe/${encodeURIComponent(token)}`;
}
