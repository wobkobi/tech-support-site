"use client";
// src/features/social-design/components/use-narrow-screen.ts
// Whether the screen is phone-narrow, kept up to date as it turns or resizes. The post
// maker swaps to its simple editor below this width.

import { useSyncExternalStore } from "react";

// Below Tailwind's md breakpoint: phones, held either way up.
const NARROW = "(width < 48rem)";

/**
 * Subscribes to the narrow-screen media query.
 * @param onChange - Called when it starts or stops matching.
 * @returns Unsubscribe.
 */
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen is phone-narrow right now.
 * @returns True below the md breakpoint.
 */
function matches(): boolean {
  return window.matchMedia(NARROW).matches;
}

/**
 * Whether the screen is phone-narrow. The editor only renders in the browser, so the
 * server value is never used for real; it says "wide" to match the default layout.
 * @returns True below the md breakpoint.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, matches, () => false);
}
