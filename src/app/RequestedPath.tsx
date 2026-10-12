// src/app/RequestedPath.tsx
// The address the visitor asked for, shown on the 404 page so a typo is easy to spot.
// Client-side because not-found.tsx receives no params or pathname.

"use client";

import type React from "react";
import { useSyncExternalStore } from "react";

/**
 * The address never changes while the 404 page is open, so there is nothing to subscribe to.
 * @returns A no-op unsubscribe.
 */
const noSubscribe = (): (() => void) => () => {};

/**
 * Current pathname in a code chip, or "this address" until it is known. The 404 page
 * is prerendered once at build time, when there is no real address (usePathname would
 * give a placeholder and the hydrated text would not match), so the path is read from
 * the browser only: the null server snapshot covers the build and the first client
 * render, then React re-renders with the real path.
 * @returns The requested path, or fallback text.
 */
export function RequestedPath(): React.ReactElement {
  const pathname = useSyncExternalStore(
    noSubscribe,
    () => window.location.pathname,
    () => null,
  );
  if (!pathname) return <>this address</>;
  return (
    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[0.9em] break-all text-rich-black">
      {pathname}
    </code>
  );
}
