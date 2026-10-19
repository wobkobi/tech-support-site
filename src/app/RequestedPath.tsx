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
 * Current pathname in a code chip, or "this address" until known. Read from the browser
 * only, since the 404 page is prerendered with no real address.
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
