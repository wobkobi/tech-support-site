// src/shared/lib/print-routes.ts
// Artwork-only routes for Puppeteer capture. Site chrome must skip them, or it lands in the
// printed or posted image.

/** Exact paths whose rendered output is captured as artwork, not a web page. */
export const PRINT_ROUTES: ReadonlyArray<string> = ["/poster", "/card", "/sign", "/intro"];

/**
 * Whether a path renders capture artwork and so must not receive site chrome.
 * @param pathname - Current pathname, as returned by `usePathname()`.
 * @returns True when the path is an artwork route.
 */
export function isPrintRoute(pathname: string): boolean {
  return PRINT_ROUTES.includes(pathname);
}
