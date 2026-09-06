// src/shared/lib/print-routes.ts
// Routes that exist only as artwork for a Puppeteer capture, never as pages a
// visitor navigates to. Every piece of site chrome must exclude them: anything
// that paints over the layout - nav, footer, promo banner - lands in the
// exported PDF and is printed onto the finished product.

/** Exact paths whose rendered output is print artwork, not a web page. */
export const PRINT_ROUTES: ReadonlyArray<string> = ["/poster", "/card"];

/**
 * Whether a path renders print artwork and so must not receive site chrome.
 * @param pathname - Current pathname, as returned by `usePathname()`.
 * @returns True when the path is a print artwork route.
 */
export function isPrintRoute(pathname: string): boolean {
  return PRINT_ROUTES.includes(pathname);
}
