// scripts/check-service-pages.ts
// Guards the service detail page content. Every page must belong to a real service
// category, link only to pages that exist, and pin review ids Prisma can query - a
// malformed ObjectId throws at render and 500s the whole page.
// Run with: npm test -- service-pages

import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import {
  SERVICE_PAGES,
  SERVICE_PAGE_SLUGS,
  hasServicePage,
  serviceHref,
} from "@/shared/lib/service-pages";
import { expect, finish } from "./lib/harness.js";

/**
 * Runs every content and helper check, then exits non-zero on any failure.
 */
function main(): void {
  const areaSlugs = new Set(SERVICE_AREAS.map((a) => a.slug));

  // SERVICE_PAGE_SLUGS is filtered through SERVICE_AREAS, so it can't reveal a content
  // key with no category behind it; the raw keys can.
  for (const key of Object.keys(SERVICE_PAGES)) {
    expect(`content key ${key} is a service category`, areaSlugs.has(key));
  }
  expect(
    "every content key is generated as a page",
    SERVICE_PAGE_SLUGS.length === Object.keys(SERVICE_PAGES).length,
  );

  for (const slug of SERVICE_PAGE_SLUGS) {
    const page = SERVICE_PAGES[slug];
    expect(`${slug} has 6-8 problems`, page.problems.length >= 6 && page.problems.length <= 8);
    expect(
      `${slug} has 3-4 visit steps`,
      page.visitSteps.length >= 3 && page.visitSteps.length <= 4,
    );
    expect(`${slug} has 2-3 FAQs`, page.faqs.length >= 2 && page.faqs.length <= 3);
    expect(`${slug} has 2-3 related pages`, page.related.length >= 2 && page.related.length <= 3);
    // Google truncates descriptions past roughly 160 characters.
    expect(`${slug} meta description <= 160 chars`, page.metaDescription.length <= 160);
    for (const rel of page.related) {
      expect(`${slug} > related ${rel} has its own page`, hasServicePage(rel) && rel !== slug);
    }
    for (const id of page.reviewIds) {
      expect(`${slug} > review ${id} is a 24-hex ObjectId`, /^[0-9a-f]{24}$/.test(id));
    }
    // Escapes, so this file itself stays free of the characters it bans.
    expect(`${slug} copy has no em or en dashes`, !/[\u2013\u2014]/.test(JSON.stringify(page)));
  }

  expect(
    "serviceHref sends a slug with content to its page",
    serviceHref("printers-scanners") === "/services/printers-scanners",
  );
  expect(
    "serviceHref keeps the anchor for a slug without content",
    serviceHref("smart-home") === "/services#smart-home",
  );
  expect("hasServicePage rejects an unknown slug", !hasServicePage("not-a-service"));
  // A plain `in` check would accept prototype keys and render an empty page.
  expect("hasServicePage rejects an inherited key", !hasServicePage("toString"));

  finish();
}

main();
