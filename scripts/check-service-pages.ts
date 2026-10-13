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

let failures = 0;

/**
 * Records one check, so every case runs even after one fails.
 * @param label - Human-readable case name.
 * @param ok - Whether the case held.
 */
function check(label: string, ok: boolean): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

/**
 * Runs every content and helper check, then exits non-zero on any failure.
 */
function main(): void {
  const areaSlugs = new Set(SERVICE_AREAS.map((a) => a.slug));

  // SERVICE_PAGE_SLUGS is filtered through SERVICE_AREAS, so it can't reveal a content
  // key with no category behind it; the raw keys can.
  for (const key of Object.keys(SERVICE_PAGES)) {
    check(`content key ${key} is a service category`, areaSlugs.has(key));
  }
  check(
    "every content key is generated as a page",
    SERVICE_PAGE_SLUGS.length === Object.keys(SERVICE_PAGES).length,
  );

  for (const slug of SERVICE_PAGE_SLUGS) {
    const page = SERVICE_PAGES[slug];
    check(`${slug} has 6-8 problems`, page.problems.length >= 6 && page.problems.length <= 8);
    check(
      `${slug} has 3-4 visit steps`,
      page.visitSteps.length >= 3 && page.visitSteps.length <= 4,
    );
    check(`${slug} has 2-3 FAQs`, page.faqs.length >= 2 && page.faqs.length <= 3);
    check(`${slug} has 2-3 related pages`, page.related.length >= 2 && page.related.length <= 3);
    // Google truncates descriptions past roughly 160 characters.
    check(`${slug} meta description <= 160 chars`, page.metaDescription.length <= 160);
    for (const rel of page.related) {
      check(`${slug} > related ${rel} has its own page`, hasServicePage(rel) && rel !== slug);
    }
    for (const id of page.reviewIds) {
      check(`${slug} > review ${id} is a 24-hex ObjectId`, /^[0-9a-f]{24}$/.test(id));
    }
    // Escapes, so this file itself stays free of the characters it bans.
    check(`${slug} copy has no em or en dashes`, !/[\u2013\u2014]/.test(JSON.stringify(page)));
  }

  check(
    "serviceHref sends a slug with content to its page",
    serviceHref("printers-scanners") === "/services/printers-scanners",
  );
  check(
    "serviceHref keeps the anchor for a slug without content",
    serviceHref("smart-home") === "/services#smart-home",
  );
  check("hasServicePage rejects an unknown slug", !hasServicePage("not-a-service"));
  // A plain `in` check would accept prototype keys and render an empty page.
  check("hasServicePage rejects an inherited key", !hasServicePage("toString"));

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
