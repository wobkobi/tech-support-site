// src/features/social/lib/insertables.ts
// What the composer's "Add" menu offers. Add an entry here and it shows up in the
// menu; no other change is needed. Page links are plain addresses, since Facebook and
// Instagram show text exactly as typed.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import {
  contactGroup,
  promoGroup,
  SYMBOL_GROUP,
  type InsertDetails,
} from "@/features/admin/lib/insertables";
import type { PromoWording } from "@/features/mailing/lib/render";

/**
 * The menu's sections.
 * @param details - Site address and contact details.
 * @param promo - The running promo's wording, or null.
 * @returns Groups in menu order.
 */
export function insertableGroups(
  details: InsertDetails,
  promo: PromoWording | null,
): InsertGroup[] {
  /**
   * A full link to one of the site's pages.
   * @param path - Page path.
   * @returns The URL.
   */
  const page = (path: string): string => `${details.siteUrl}${path}`;
  return [
    promoGroup(promo),
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
    contactGroup(details),
    {
      label: "Layout",
      items: [
        { label: "Bullet point", hint: "• on a new line", text: "• ", line: true },
        { label: "Blank line", hint: "Space between paragraphs", text: "\n", line: true },
      ],
    },
    SYMBOL_GROUP,
  ];
}
