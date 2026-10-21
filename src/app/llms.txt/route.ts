// src/app/llms.txt/route.ts
// Plain-text business summary for AI assistants (the llms.txt convention), built from the
// same live settings as the LocalBusiness JSON-LD so the two can't disagree.

import { loadBusinessFacts } from "@/shared/lib/ai/business-facts";
import { SERVICE_PAGES, SERVICE_PAGE_SLUGS } from "@/shared/lib/service-pages";
import { getSiteUrl } from "@/shared/lib/site-url";

const siteUrl = getSiteUrl();

/**
 * Serve /llms.txt as Markdown: the facts {@link loadBusinessFacts} gives the AI writers too,
 * then the main pages.
 * @returns The text response.
 */
export async function GET(): Promise<Response> {
  const { summary, body } = await loadBusinessFacts();

  const lines = [
    "# To the Point Tech",
    "",
    `> ${summary}`,
    "",
    body,
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
    `- [Areas and travel](${siteUrl}/areas): suburbs covered and what travel costs`,
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
