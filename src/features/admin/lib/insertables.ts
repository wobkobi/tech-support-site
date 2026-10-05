// src/features/admin/lib/insertables.ts
// Add menu sections both the social composer and the email editor offer: promo
// wording, contact details and symbols. Contact details come from the settings and
// site address, so they follow any change made there.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import type { PromoWording } from "@/features/mailing/lib/render";
import type { IdentitySettings } from "@/shared/lib/settings/types";

/** Business details the menus insert. */
export interface InsertDetails {
  siteUrl: string;
  website: string;
  phone: string;
  email: string;
}

/**
 * Picks the details the menus insert out of the identity settings.
 * @param identity - Business identity settings.
 * @param siteUrl - The site's address, with no trailing slash.
 * @returns Menu details.
 */
export function insertDetailsOf(
  identity: Pick<IdentitySettings, "website" | "phone" | "email">,
  siteUrl: string,
): InsertDetails {
  return { siteUrl, website: identity.website, phone: identity.phone, email: identity.email };
}

/**
 * Promo placeholders, each showing what it would fill with today, or saying none is
 * running (the post or email can still go out later, once one is).
 * @param promo - The running promo's wording, or null.
 * @returns The Promo section.
 */
export function promoGroup(promo: PromoWording | null): InsertGroup {
  const none = "No promo running right now";
  return {
    label: "Promo",
    items: [
      { label: "Promo summary", hint: promo?.summary ?? none, text: "{promo}" },
      { label: "What the deal is", hint: promo?.offer ?? none, text: "{promoOffer}" },
      { label: "When it ends", hint: promo?.ends ?? none, text: "{promoEnds}" },
    ],
  };
}

/**
 * Phone number and email address, as plain text.
 * @param details - Contact details.
 * @returns The Contact details section.
 */
export function contactGroup(details: InsertDetails): InsertGroup {
  return {
    label: "Contact details",
    items: [
      { label: "Phone number", hint: details.phone, text: details.phone },
      { label: "Email address", hint: details.email, text: details.email },
    ],
  };
}

// Single characters, shown as a row of buttons. The hint is the button's tooltip.
const SYMBOLS: [string, string][] = [
  ["✅", "Tick"],
  ["⚠️", "Warning"],
  ["📞", "Phone"],
  ["💻", "Laptop"],
  ["📱", "Mobile phone"],
  ["🖨️", "Printer"],
  ["📶", "Wi-Fi"],
  ["🔒", "Lock"],
  ["📅", "Calendar"],
  ["⏰", "Clock"],
  ["👉", "Pointing hand"],
  ["⭐", "Star"],
  ["🎉", "Celebration"],
  ["🎄", "Christmas tree"],
];

/** The Symbols section. */
export const SYMBOL_GROUP: InsertGroup = {
  label: "Symbols",
  compact: true,
  items: SYMBOLS.map(([symbol, name]) => ({ label: symbol, hint: name, text: symbol })),
};
