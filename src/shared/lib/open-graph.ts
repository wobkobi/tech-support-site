// src/shared/lib/open-graph.ts
// Site-wide Open Graph fields. Next replaces a parent's `openGraph` wholesale, so pages spread these in.

/** Share-preview image, generated into public/ by scripts/build-icons. */
const OG_IMAGE = {
  url: "/og-1200x630.jpg",
  width: 1200,
  height: 630,
  alt: "To the Point Tech - Computer & IT Support in Auckland",
  type: "image/jpeg",
};

const SITE_NAME = "To the Point Tech";

/**
 * Site-wide fields for the root layout's `openGraph`. Pages use {@link pageOpenGraph},
 * which spreads these in.
 */
export const SITE_OPEN_GRAPH = {
  type: "website" as const,
  locale: "en_NZ",
  siteName: SITE_NAME,
  images: [OG_IMAGE],
};

/**
 * A page's `openGraph` from its search title and description. og:title skips the root title
 * template, so the " | To the Point Tech" suffix is added here.
 * @param page - Page details.
 * @param page.title - The page's metadata title, before the template suffix.
 * @param page.description - The page's meta description.
 * @param page.url - Page path, e.g. "/pricing".
 * @param page.absoluteTitle - The title is already complete, so no suffix is added.
 * @returns Open Graph metadata for the page.
 */
export function pageOpenGraph({
  title,
  description,
  url,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  url: string;
  absoluteTitle?: boolean;
}): typeof SITE_OPEN_GRAPH & { title: string; description: string; url: string } {
  return {
    ...SITE_OPEN_GRAPH,
    title: absoluteTitle ? title : `${title} | ${SITE_NAME}`,
    description,
    url,
  };
}
