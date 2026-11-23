"use client";
// src/features/admin/components/ResumeLastPage.tsx
// Installed-app resume: the phone closes a backgrounded home-screen app and reopens it at the
// manifest's start_url (/admin), so a fresh launch goes back to the page last open, query included.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** localStorage key holding the last admin page and when it was open. */
const LAST_PAGE_KEY = "admin-last-page";

/** A launch longer than this after leaving starts on the dashboard as normal. */
const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Set after the first mount's check, so only a fresh document load can resume. */
let launchChecked = false;

interface LastPage {
  path: string;
  at: number;
}

/**
 * Whether this document load is the installed app opening at its start_url: standalone, on
 * the bare dashboard, and a navigation rather than a pull-to-refresh reload.
 * @returns True for a fresh app launch.
 */
function isAppLaunch(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone || window.location.pathname !== "/admin" || window.location.search) return false;
  const nav = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  return nav?.type !== "reload";
}

/**
 * Records every admin page as it opens and, on a fresh app launch within
 * {@link RESUME_WINDOW_MS}, replaces the dashboard with the page last open.
 * @returns Null - this component renders no markup.
 */
export function ResumeLastPage(): null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const path = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
    try {
      if (!launchChecked) {
        launchChecked = true;
        if (isAppLaunch()) {
          const last = JSON.parse(localStorage.getItem(LAST_PAGE_KEY) ?? "null") as LastPage | null;
          if (last && last.path !== "/admin" && Date.now() - last.at < RESUME_WINDOW_MS) {
            // The resumed page records itself when it mounts.
            router.replace(last.path);
            return;
          }
        }
      }
      localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ path, at: Date.now() }));
    } catch {
      // Storage unavailable; the app opens on the dashboard as normal.
    }
  }, [pathname, searchParams, router]);

  // The resume window counts from leaving the app, not from opening the page.
  useEffect(() => {
    /** Stamps the current page with the time the app went to the background. */
    function onHide(): void {
      if (document.visibilityState !== "hidden") return;
      try {
        const path = `${window.location.pathname}${window.location.search}`;
        localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ path, at: Date.now() }));
      } catch {
        // Storage unavailable; nothing to record.
      }
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  return null;
}
