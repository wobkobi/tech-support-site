// src/features/mailing/lib/insertables.ts
// What the email editor's "Add" menu offers. Formatting that wraps selected text stays in
// the editor's button strip, since a menu pick can only insert.

import type { InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import {
  contactGroup,
  promoGroup,
  SYMBOL_GROUP,
  type InsertDetails,
} from "@/features/admin/lib/insertables";
import { PLACEHOLDERS, type PromoWording } from "@/features/mailing/lib/render";
import { GOOGLE_BUSINESS_PROFILE_URL } from "@/shared/lib/business-profiles";

// [menu label, link text, path]. Link text is lower case to sit mid-sentence.
const PAGES: [string, string, string][] = [
  ["Booking page", "booking page", "/booking"],
  ["Prices page", "prices page", "/pricing"],
  ["Reviews page", "reviews page", "/reviews"],
  ["Contact page", "contact page", "/contact"],
];

// Big buttons: [button text, path]. Each needs its own line to render as a button.
const BUTTONS: [string, string][] = [
  ["Book a time", "/booking"],
  ["See our prices", "/pricing"],
  ["Read our reviews", "/reviews"],
  ["Get in touch", "/contact"],
];

/** A place the block editor's buttons and pictures can link to. */
export interface LinkTarget {
  label: string;
  url: string;
}

/**
 * The block editor's link choices: main site pages, the Google review-box link and the
 * Google profile.
 * @param siteUrl - Site origin.
 * @param googleReviewUrl - The review-box link from Settings > Reviews; left out when blank.
 * @returns Choices in menu order.
 */
export function emailLinkTargets(siteUrl: string, googleReviewUrl: string): LinkTarget[] {
  const review = googleReviewUrl.trim();
  return [
    { label: "Home page", url: siteUrl },
    ...PAGES.map(([label, , path]) => ({ label, url: `${siteUrl}${path}` })),
    ...(review ? [{ label: "Leave a Google review", url: review }] : []),
    { label: "Google profile (read reviews)", url: GOOGLE_BUSINESS_PROFILE_URL },
  ];
}

/**
 * The menu's sections. Links and buttons use the renderer's `[text](url)` form.
 * @param details - Site address and contact details.
 * @param promo - Wording of the email's linked or running promo, or null.
 * @param googleReviewUrl - The review-box link from Settings > Reviews; no button when blank.
 * @returns Groups in menu order.
 */
export function emailInsertGroups(
  details: InsertDetails,
  promo: PromoWording | null,
  googleReviewUrl: string,
): InsertGroup[] {
  /**
   * A full link to one of the site's pages.
   * @param path - Page path.
   * @returns The URL.
   */
  const page = (path: string): string => `${details.siteUrl}${path}`;
  const help = new Map<string, string>(PLACEHOLDERS.map((p) => [p.key, p.help]));
  const review = googleReviewUrl.trim();
  return [
    {
      label: "About them",
      items: [
        { label: "First name", hint: help.get("firstName"), text: "{firstName}" },
        { label: "Full name", hint: help.get("name"), text: "{name}" },
        { label: "Their review", hint: help.get("reviewText"), text: "{reviewText}" },
      ],
    },
    promoGroup(promo),
    {
      label: "Buttons",
      items: [
        ...BUTTONS.map(([text, path]) => ({
          label: text,
          hint: `Big button to ${page(path)}`,
          text: `[${text}](${page(path)})`,
          line: true,
        })),
        ...(review
          ? [
              {
                label: "Leave a Google review",
                hint: "Big button that opens the Google review box",
                text: `[Leave a Google review](${review})`,
                line: true,
              },
            ]
          : []),
      ],
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
