"use client";
// src/features/admin/hooks/use-query-sync.ts
// Mirrors a list page's filters into the address bar, so a reload, a shared link, a
// dashboard deep link or Back from a record lands on the same view. The page reads the
// query back from its searchParams and hands it to the list as starting state.

import { useEffect } from "react";

/** A page's resolved searchParams. */
export type PageQuery = Record<string, string | string[] | undefined>;

/**
 * Reads one query value as a plain string ("" when absent). A repeated key
 * keeps its first value.
 * @param query - The page's resolved searchParams.
 * @param key - Query key.
 * @returns The value, or "".
 */
export function queryValue(query: PageQuery, key: string): string {
  const v = query[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Writes `params` into the current URL whenever they change. An empty value
 * drops its key, so an unfiltered list keeps a bare URL; keys not listed are
 * left alone. Uses replaceState, not a router navigation: typing in a search box
 * shouldn't stack up Back steps, and a navigation would re-run the server page
 * and refetch the whole list.
 * @param params - Query keys and their current values ("" to omit).
 */
export function useQuerySync(params: Record<string, string>): void {
  const serialised = JSON.stringify(Object.entries(params));
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of JSON.parse(serialised) as [string, string][]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [serialised]);
}
