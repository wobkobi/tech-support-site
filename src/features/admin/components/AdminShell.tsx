"use client";
// src/features/admin/components/AdminShell.tsx
// Client frame around every admin page: owns the phone drawer and the desktop sidebar's
// collapsed state, and lays out AdminSidebar beside the AdminTopBar + #main column, with
// the phone AdminTabBar and its QuickActionsSheet.

import { AdminSidebar } from "@/features/admin/components/AdminSidebar";
import { AdminTabBar } from "@/features/admin/components/AdminTabBar";
import { AdminTopBar } from "@/features/admin/components/AdminTopBar";
import { QuickActionsSheet } from "@/features/admin/components/QuickActionsSheet";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/features/admin/lib/sidebar-cookie";
import { cn } from "@/shared/lib/cn";
import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** One year in seconds. */
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Props for {@link AdminShell}. */
interface AdminShellProps {
  /** Collapsed state read from the cookie, so the first paint matches the saved choice. */
  initialCollapsed: boolean;
  children: React.ReactNode;
}

/**
 * Admin chrome: sidebar (drawer below lg), sticky top bar and the padded main
 * column. The drawer closes on navigation, on Escape, and when the window widens
 * to lg (where the sidebar is always shown). Opening it focuses its close button;
 * dismissing it returns focus to whichever button opened it (the phone bar's Menu, or
 * the top bar's menu button on pages with their own action bar).
 * @param props - Component props.
 * @param props.initialCollapsed - Saved collapsed state from the {@link SIDEBAR_COOKIE} cookie.
 * @param props.children - The active admin page.
 * @returns The shell element.
 */
export function AdminShell({ initialCollapsed, children }: AdminShellProps): React.ReactElement {
  const pathname = usePathname();
  // Pairing the drawer state with the pathname auto-closes it on navigation
  // without a setState-in-effect (which the React lint rule rejects).
  const [drawer, setDrawer] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  });
  const drawerOpen = drawer.open && drawer.pathname === pathname;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const [quick, setQuick] = useState<{ open: boolean; stamp: string }>({
    open: false,
    stamp: "",
  });

  /** Opens the drawer, anchored to the current pathname, noting which button opened it. */
  function openDrawer(): void {
    drawerOpenerRef.current = document.activeElement as HTMLElement | null;
    setDrawer({ open: true, pathname });
  }

  /** Opens the quick actions sheet with a fresh stamp, so a repeat pick reopens a form. */
  function openQuick(): void {
    setQuick({ open: true, stamp: String(Date.now()) });
  }

  /**
   * Closes the drawer.
   * @param returnFocus - Send focus back to the menu button (Escape, close button, backdrop).
   */
  function closeDrawer(returnFocus: boolean): void {
    setDrawer({ open: false, pathname });
    if (returnFocus) (drawerOpenerRef.current ?? menuButtonRef.current)?.focus();
  }

  /** Flips the desktop sidebar and saves the choice for the next server render. */
  function toggleCollapsed(): void {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? SIDEBAR_COLLAPSED : "expanded"}; path=/admin; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
  }

  // preventScroll: the drawer is still sliding in from off-screen.
  useEffect(() => {
    if (drawerOpen) closeButtonRef.current?.focus({ preventScroll: true });
  }, [drawerOpen]);

  // Widening to lg leaves no drawer to close, and its Tab trap would otherwise
  // hold focus in the sidebar.
  useEffect(() => {
    const desktop = window.matchMedia("(width >= 64rem)");
    /**
     * Closes the drawer once the viewport reaches lg.
     * @param e - The media query change.
     */
    function onChange(e: MediaQueryListEvent): void {
      if (e.matches) setDrawer((d) => ({ ...d, open: false }));
    }
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    // overflow-x-clip (not hidden) keeps the top bar and other sticky descendants working.
    <div className="flex min-h-screen overflow-x-clip">
      <AdminSidebar
        drawerOpen={drawerOpen}
        onDrawerClose={closeDrawer}
        collapsed={collapsed}
        closeButtonRef={closeButtonRef}
      />
      {/* Sidebar is fixed-position; reserve its width on lg+ only (phones use the
          drawer). min-w-0 stops wide content blowing out the flex column. Print
          drops the chrome. */}
      <div
        className={cn(
          "min-w-0 flex-1 bg-admin-bg transition-[margin-left] duration-200 ease-out print:ml-0 print:bg-white",
          collapsed ? "lg:ml-16" : "lg:ml-56",
        )}
      >
        <AdminTopBar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          drawerOpen={drawerOpen}
          onOpenDrawer={openDrawer}
          menuButtonRef={menuButtonRef}
        />
        {/* The root layout's skip link targets #main. Below lg, pb-28 keeps the end
            of every page clear of the bottom bar. Pages sit in a centred column so
            wide screens don't stretch tables and panels edge to edge. */}
        <main id="main" className="px-4 pt-5 pb-28 sm:px-6 lg:pt-8 lg:pb-10 print:p-0">
          <div className="mx-auto w-full max-w-328 print:max-w-none">{children}</div>
        </main>
      </div>
      <AdminTabBar
        onOpenQuick={openQuick}
        quickOpen={quick.open}
        onOpenMenu={openDrawer}
        menuOpen={drawerOpen}
      />
      <QuickActionsSheet
        open={quick.open}
        onClose={() => setQuick((q) => ({ ...q, open: false }))}
        stamp={quick.stamp}
      />
    </div>
  );
}
