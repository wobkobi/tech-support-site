// src/features/social/lib/insertables.ts
// What the composer's "Add" menu offers. Add an entry here and it shows up in the
// menu; no other change is needed. Contact details and page links are passed in from
// the settings and site address, so they follow any change made there.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import type { PromoWording } from "@/features/mailing/lib/render";

/** Business details the menu inserts. */
export interface InsertDetails {
  siteUrl: string;
  website: string;
  phone: string;
  email: string;
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

/**
 * The menu's sections. Promo placeholders show what they'd fill with today, or say
 * none is running (the post can still be scheduled for when one is).
 * @param details - Site address and contact details.
 * @param promo - The running promo's wording, or null.
 * @returns Groups in menu order.
 */
export function insertableGroups(
  details: InsertDetails,
  promo: PromoWording | null,
): InsertGroup[] {
  const none = "No promo running right now";
  /**
   * A full link to one of the site's pages.
   * @param path - Page path.
   * @returns The URL.
   */
  const page = (path: string): string => `${details.siteUrl}${path}`;
  return [
    {
      label: "Promo",
      items: [
        { label: "Promo summary", hint: promo?.summary ?? none, text: "{promo}" },
        { label: "What the deal is", hint: promo?.offer ?? none, text: "{promoOffer}" },
        { label: "When it ends", hint: promo?.ends ?? none, text: "{promoEnds}" },
      ],
    },
    {
      label: "Links",
      items: [
        { label: "Booking page", hint: page("/booking"), text: page("/booking") },
        { label: "Prices", hint: page("/pricing"), text: page("/pricing") },
        { label: "Reviews", hint: page("/reviews"), text: page("/reviews") },
        { label: "Contact page", hint: page("/contact"), text: page("/contact") },
        { label: "Website", hint: details.website, text: details.website },
      ],
    },
    {
      label: "Contact details",
      items: [
        { label: "Phone number", hint: details.phone, text: details.phone },
        { label: "Email address", hint: details.email, text: details.email },
      ],
    },
    {
      label: "Layout",
      items: [
        { label: "Bullet point", hint: "• on a new line", text: "• ", line: true },
        { label: "Blank line", hint: "Space between paragraphs", text: "\n", line: true },
      ],
    },
    {
      label: "Symbols",
      compact: true,
      items: SYMBOLS.map(([symbol, name]) => ({ label: symbol, hint: name, text: symbol })),
    },
  ];
}
