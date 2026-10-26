// src/shared/lib/ai/business-facts.ts
// The business's live facts as Markdown: hours, area, rates and pricing rules, what gets fixed
// and the suburbs covered. /llms.txt serves them and the AI writers read the same text, so
// neither can say something the site doesn't. Rates are the standard ones; promo figures stay
// on /pricing, which goes through the promo gating.

import { formatMoneyCompact } from "@/features/business/lib/business";
import {
  cancellationCopy,
  gstCopy,
  minimumsCopy,
  partsCopy,
  travelCopy,
  unsuccessfulWorkCopy,
  workmanshipCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { servedSuburbGroups } from "@/shared/lib/served-suburbs";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { DAY_NAMES, NZ_TZ, type Weekday } from "@/shared/lib/timezone-utils";

/** The facts, split so /llms.txt can put its title between the two. */
export interface BusinessFacts {
  /** One line on what the business is. */
  summary: string;
  /** The "##" sections. */
  body: string;
}

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
 * Pricing page copy as one plain line: paragraphs joined and the bold markers dropped.
 * @param copy - Copy from pricing-policy.ts.
 * @returns The line.
 */
function plain(copy: string): string {
  return copy.replace(/\*\*/g, "").replace(/\s*\n+\s*/g, " ");
}

/**
 * Loads the facts from live settings and rates.
 * @returns The summary line and the sections.
 */
export async function loadBusinessFacts(): Promise<BusinessFacts> {
  const siteUrl = getSiteUrl();
  const [{ availability, identity }, pricing, policy] = await Promise.all([
    getSettings(),
    getPublicPricing(),
    getPolicy(),
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
  const startDate = new Date(identity.startDateIso);
  const started = Number.isNaN(startDate.getTime())
    ? null
    : startDate.toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: NZ_TZ });

  // A "delta" sets its own hourly rate; an "uplift" is a surcharge on top of labour.
  const modifiers = pricing.modifiers.map((m) =>
    m.kind === "delta"
      ? `- ${m.publicLabel} rate: ${formatMoneyCompact(m.effectiveRate)}/hr. ${m.description}`
      : `- ${m.label} surcharge: ${m.deltaDescription}/hr on labour. ${m.description}`,
  );

  const body = [
    "## Key facts",
    "",
    `- Service area: ${identity.homeRegion}, within about ${identity.serviceRadiusKm} km of ${identity.baseAddress.locality}`,
    `- Hours: ${hours.join("; ")}`,
    `- Standard rate: NZ$${pricing.baseRate} per hour; small-business rate NZ$${pricing.businessRate} per hour. Current offers: ${siteUrl}/pricing`,
    ...(started ? [`- Running since: ${started}`] : []),
    `- Phone: ${identity.phone}`,
    `- Email: ${identity.email}`,
    `- Book online: ${siteUrl}/booking`,
    "- Payment: cash or bank transfer",
    "",
    "## Rates and pricing rules",
    "",
    `Quoted from the pricing page, where ${identity.name} writes as "I".`,
    "",
    `- On-site visit: ${formatMoneyCompact(pricing.baseRate)}/hr for every job (no complex-work surcharge), plus travel.`,
    ...modifiers,
    `- Minimum charge: ${plain(minimumsCopy(policy.MIN_BILLABLE_MINS, policy.BILLING_INCREMENT_MINS))}`,
    `- Travel: ${plain(travelCopy(policy.TRAVEL_RATE_PER_HOUR, policy.MIN_TRAVEL_CHARGE))}`,
    `- Parts: ${plain(partsCopy())}`,
    `- If I can't fix it: ${plain(unsuccessfulWorkCopy(policy.UNSUCCESSFUL_WORK_FACTOR, policy.NO_FIX_FREE_MINS))}`,
    ...(policy.WORKMANSHIP_WINDOW_DAYS > 0
      ? [`- Workmanship guarantee: ${plain(workmanshipCopy(policy.WORKMANSHIP_WINDOW_DAYS))}`]
      : []),
    `- Cancelling: ${plain(cancellationCopy(policy.CANCELLATION))}`,
    `- GST: ${plain(gstCopy(policy.GST_REGISTERED))}`,
    "",
    "## What gets fixed",
    "",
    ...SERVICE_AREAS.map((a) => `- ${a.label}: ${a.blurb}. For example: ${a.examples.join(", ")}`),
    "",
    "## Areas covered",
    "",
    ...regions.map((r) => `- ${r}`),
  ].join("\n");

  return {
    summary: `Friendly computer and IT support across ${identity.homeRegion}, New Zealand, run by ${identity.name}. On-site visits to homes and small businesses, plus remote help. Plain-English explanations, no jargon.`,
    body,
  };
}
