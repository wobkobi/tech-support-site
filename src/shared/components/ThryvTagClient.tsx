"use client";
// src/shared/components/ThryvTagClient.tsx
// Mutes Thryv's GA4 hits while the visitor is on /admin pages.

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Same reason as GoogleTag: a client-side hop into /admin doesn't unload Thryv's
 * GTM container, and its GA4 tag fires a page_view on every history change. Thryv's
 * tag publishes the GA4 ID it picked as `window.measurementId`, so
 * `ga-disable-<ID>` mutes those hits in /admin.
 * @returns Nothing; the component only runs the effect.
 */
export function ThryvAdminMute(): null {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  useEffect(() => {
    const id = (window as unknown as { measurementId?: string }).measurementId;
    if (!id) return;
    (window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = isAdmin;
  }, [isAdmin]);

  return null;
}
