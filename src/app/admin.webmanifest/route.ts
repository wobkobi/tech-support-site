// src/app/admin.webmanifest/route.ts
// Web app manifest for the installed admin, linked from admin/layout.tsx. Built in code so its
// shortcuts come from QUICK_ACTIONS, the same list as the + button and the Quick actions menu.

import { QUICK_ACTIONS, quickActionHref } from "@/features/admin/lib/quick-actions";
import type { MetadataRoute } from "next";

// Prerendered at build: nothing here reads the request or the database.
export const dynamic = "force-static";

const APP_ICON = { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" };

/**
 * Serve /admin.webmanifest. Shortcuts run in priority order because Chrome on Android shows
 * only the first 3 (desktop up to 10): the + button's most-used actions lead, Schedule goes
 * last. A fixed `?new=` stamp still opens the form, since a shortcut always loads the page fresh.
 * @returns The manifest as `application/manifest+json`.
 */
export function GET(): Response {
  const manifest: MetadataRoute.Manifest = {
    id: "/admin",
    name: "To the Point Admin",
    short_name: "TTP Admin",
    description: "Admin for To the Point Tech",
    start_url: "/admin",
    // Keeps public-site links out of the admin window (and off its Android link capture).
    scope: "/admin",
    display: "standalone",
    background_color: "#f6f7f8",
    theme_color: "#ffffff",
    icons: [
      { ...APP_ICON, purpose: "any" },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      ...QUICK_ACTIONS.map((action) => ({
        name: action.label,
        url: quickActionHref(action, "app"),
        icons: [APP_ICON],
      })),
      { name: "Schedule", url: "/admin/schedule", icons: [APP_ICON] },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
