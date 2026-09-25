// src/shared/lib/print-routes.ts
// Routes that exist only as artwork for a Puppeteer capture, never as pages a
// visitor navigates to. Every piece of site chrome must exclude them: anything
// that paints over the layout - nav, footer, promo banner - lands in the capture
// and ships on the finished product, whether that is a printed poster or a
// social image posted to a feed.

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
