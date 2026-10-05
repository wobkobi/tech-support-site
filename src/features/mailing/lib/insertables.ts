// src/features/mailing/lib/insertables.ts
// What the email editor's "Add" menu offers. Add an entry here and it shows up in the
// menu. Formatting that wraps selected text (bold, headings) stays in the editor's
// button strip instead, since a menu pick can only insert.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import {
  contactGroup,
  promoGroup,
  SYMBOL_GROUP,
  type InsertDetails,
} from "@/features/admin/lib/insertables";
import { PLACEHOLDERS, type PromoWording } from "@/features/mailing/lib/render";

// Pages the menu links to: [menu label, link text, path]. The link text is lower case
// because it sits inside a sentence ("Have a look at our prices page").
const PAGES: [string, string, string][] = [
  ["Booking page", "booking page", "/booking"],
  ["Prices page", "prices page", "/pricing"],
  ["Reviews page", "reviews page", "/reviews"],
  ["Contact page", "contact page", "/contact"],
];

// Big buttons: [button text, path]. Each goes on a line of its own, which is what makes
// the renderer draw a button rather than a link.
const BUTTONS: [string, string][] = [
  ["Book a time", "/booking"],
  ["See our prices", "/pricing"],
  ["Read our reviews", "/reviews"],
  ["Get in touch", "/contact"],
];

/**
 * The menu's sections. Links and buttons use the `[text](url)` form the renderer
 * understands, so they show as words in the email rather than a bare address.
 * @param details - Site address and contact details.
 * @param promo - Wording of the email's promo (its linked one, or whichever is running), or null.
 * @returns Groups in menu order.
 */
export function emailInsertGroups(
  details: InsertDetails,
  promo: PromoWording | null,
): InsertGroup[] {
  /**
   * A full link to one of the site's pages.
   * @param path - Page path.
   * @returns The URL.
   */
  const page = (path: string): string => `${details.siteUrl}${path}`;
  const help = new Map<string, string>(PLACEHOLDERS.map((p) => [p.key, p.help]));
  return [
    {
      label: "Their name",
      items: [
        { label: "First name", hint: help.get("firstName"), text: "{firstName}" },
        { label: "Full name", hint: help.get("name"), text: "{name}" },
      ],
    },
    promoGroup(promo),
    {
      label: "Buttons",
      items: BUTTONS.map(([text, path]) => ({
        label: text,
        hint: `Big button to ${page(path)}`,
        text: `[${text}](${page(path)})`,
        line: true,
      })),
    },
    {
      label: "Links",
      items: [
        ...PAGES.map(([label, text, path]) => ({
          label,
          hint: page(path),
          text: `[${text}](${page(path)})`,
        })),
        {
          label: "Website",
          hint: details.website,
          text: `[${details.website}](${details.siteUrl})`,
        },
      ],
    },
    contactGroup(details),
    SYMBOL_GROUP,
  ];
}
