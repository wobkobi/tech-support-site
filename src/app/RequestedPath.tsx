// src/app/RequestedPath.tsx
// The address the visitor asked for, shown on the 404 page so a typo is easy to spot.
// Client-side because not-found.tsx receives no params or pathname.

"use client";

import { usePathname } from "next/navigation";
import type React from "react";

/**
 * Current pathname in a code chip.
 * @returns Code element with the requested path.
 */
export function RequestedPath(): React.ReactElement {
  const pathname = usePathname();
  return (
    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[0.9em] break-all text-rich-black">
      {pathname}
    </code>
  );
}
