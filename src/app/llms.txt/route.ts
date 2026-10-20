// src/app/llms.txt/route.ts
// Plain-text business summary for AI assistants (the llms.txt convention), built from the
// same live settings as the LocalBusiness JSON-LD so the two can't disagree.

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { servedSuburbGroups } from "@/shared/lib/served-suburbs";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { SERVICE_PAGES, SERVICE_PAGE_SLUGS } from "@/shared/lib/service-pages";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { DAY_NAMES, type Weekday } from "@/shared/lib/timezone-utils";

const siteUrl = getSiteUrl();

/**
 * Format a 0-24 hour as a short 12-hour time ("9am", "5pm").
 * @param hour - NZ-local hour.
 * @returns The formatted time.
 */
function formatHour(hour: number): string {
  const h = hour % 24;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

/**
 * Serve /llms.txt as Markdown. Rates are the standard ones; promo figures stay on
 * /pricing, which goes through the promo gating.
 * @returns The text response.
 */
export async function GET(): Promise<Response> {
  const [{ availability, identity }, pricing] = await Promise.all([
    getSettings(),
    getPublicPricing(),
  ]);

  // Same Monday-first day list and published-hours override as the JSON-LD. Consecutive
  // days with the same window collapse into one run ("Monday-Friday 10am-6pm").
  const advertisedOrder: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
  const runs: { first: Weekday; last: Weekday; window: string; lastIndex: number }[] = [];
  advertisedOrder.forEach((d, i) => {
    if (!availability.schedule[d].enabled) return;
    const open = identity.publishedHours?.open ?? availability.schedule[d].open;
    const close = identity.publishedHours?.close ?? availability.schedule[d].close;
    const window = `${formatHour(open)}-${formatHour(close)}`;
    const prev = runs.at(-1);
    if (prev && prev.window === window && prev.lastIndex === i - 1) {
      prev.last = d;
      prev.lastIndex = i;
    } else {
      runs.push({ first: d, last: d, window, lastIndex: i });
    }
  });
  const [only] = runs;
  const hours =
    runs.length === 1 && only?.first === 1 && only.last === 0
      ? [`Every day ${only.window}`]
      : runs.map(
          (r) =>
            `${DAY_NAMES[r.first]}${r.first === r.last ? "" : `-${DAY_NAMES[r.last]}`} ${r.window}`,
        );

  const regions = servedSuburbGroups(identity).map((g) =>
    g.region ? `${g.region}: ${g.suburbs.join(", ")}` : g.suburbs.join(", "),
  );

  const lines = [
    "# To the Point Tech",
    "",
    `> Friendly computer and IT support across ${identity.homeRegion}, New Zealand, run by ${identity.name}. On-site visits to homes and small businesses, plus remote help. Plain-English explanations, no jargon.`,
    "",
    "## Key facts",
    "",
    `- Service area: ${identity.homeRegion}, within about ${identity.serviceRadiusKm} km of ${identity.baseAddress.locality}`,
    `- Hours: ${hours.join("; ")}`,
    `- Standard rate: NZ$${pricing.baseRate} per hour; small-business rate NZ$${pricing.businessRate} per hour. Current offers: ${siteUrl}/pricing`,
    `- Phone: ${identity.phone}`,
    `- Email: ${identity.email}`,
    `- Book online: ${siteUrl}/booking`,
    "- Payment: cash or bank transfer",
    "",
    "## What gets fixed",
    "",
    ...SERVICE_AREAS.map((a) => `- ${a.label}: ${a.blurb}. For example: ${a.examples.join(", ")}`),
    "",
    "## Areas covered",
    "",
    ...regions.map((r) => `- ${r}`),
    "",
    "## Pages",
    "",
    `- [Services](${siteUrl}/services): everything covered, with typical jobs`,
    ...SERVICE_PAGE_SLUGS.map(
      (slug) =>
        `- [${SERVICE_PAGES[slug].metaTitle}](${siteUrl}/services/${slug}): ${SERVICE_PAGES[slug].metaDescription}`,
    ),
    `- [Small business IT](${siteUrl}/business): IT support for small offices`,
    `- [Pricing](${siteUrl}/pricing): hourly rates, travel and any current offers`,
    `- [Book](${siteUrl}/booking): pick a time online`,
    `- [FAQ](${siteUrl}/faq): common questions about visits, remote help and payment`,
    `- [About](${siteUrl}/about): who does the work`,
    `- [Reviews](${siteUrl}/reviews): what clients say`,
    `- [Contact](${siteUrl}/contact): phone and email`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
