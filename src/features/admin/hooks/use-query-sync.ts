"use client";
// src/features/admin/hooks/use-query-sync.ts
// Mirrors a list page's filters into the URL so reloads, links and Back keep the view.

import { useEffect } from "react";

/** A page's resolved searchParams. */
export type PageQuery = Record<string, string | string[] | undefined>;

/**
 * Reads one query value as a string ("" when absent; first value of a repeated key).
 * @param query - The page's resolved searchParams.
 * @param key - Query key.
 * @returns The value, or "".
 */
export function queryValue(query: PageQuery, key: string): string {
  const v = query[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Writes `params` into the URL on change; an empty value drops its key. Uses
 * replaceState so typing adds no Back steps and the server page doesn't re-run.
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
