"use client";
// src/features/admin/components/AdminTabBar.tsx
// Phone bottom bar (below lg): Home, Schedule, the + that opens QuickActionsSheet,
// Invoices, and Menu for the full sidebar drawer. Sits where a thumb rests. A page with
// its own phone action bar hides it and gets the floating + back (globals.css).

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import type { IconType } from "react-icons";
import { FaBars, FaCalendarDays, FaFileInvoiceDollar, FaHouse, FaPlus } from "react-icons/fa6";

/** One link tab. */
interface Tab {
  label: string;
  href: string;
  icon: IconType;
  /** Current on this exact path only; otherwise on any path under `href` too. */
  exact?: boolean;
}

const HOME: Tab = { label: "Home", href: "/admin", icon: FaHouse, exact: true };
const SCHEDULE: Tab = { label: "Schedule", href: "/admin/schedule", icon: FaCalendarDays };
const INVOICES: Tab = {
  label: "Invoices",
  href: "/admin/business/invoices",
  icon: FaFileInvoiceDollar,
};

/**
 * Whether a tab is the current section.
 * @param tab - The tab.
 * @param pathname - Current path.
 * @returns True when the tab should show as current.
 */
function isCurrent(tab: Tab, pathname: string): boolean {
  if (tab.exact) return pathname === tab.href;
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/** Shared look for every slot: icon over a 14px label, a 56px target. */
const SLOT_CLS =
  "flex min-h-14 flex-col items-center justify-center gap-1 text-sm font-semibold transition-colors";

/** Props for {@link AdminTabBar}. */
interface AdminTabBarProps {
  /** Opens the quick actions sheet. */
  onOpenQuick: () => void;
  /** Whether the quick actions sheet is open. */
  quickOpen: boolean;
  /** Opens the sidebar drawer. */
  onOpenMenu: () => void;
  /** Whether the sidebar drawer is open. */
  menuOpen: boolean;
}

/**
 * Renders one link tab.
 * @param props - Component props.
 * @param props.tab - The tab.
 * @param props.pathname - Current path, for the active state.
 * @returns The tab link.
 */
function TabLink({ tab, pathname }: { tab: Tab; pathname: string }): React.ReactElement {
  const active = isCurrent(tab, pathname);
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(SLOT_CLS, active ? "text-russian-violet" : "text-admin-muted")}
    >
      <tab.icon aria-hidden className="text-xl" />
      {tab.label}
    </Link>
  );
}

/**
 * The phone bottom bar.
 * @param props - Component props.
 * @param props.onOpenQuick - Opens the quick actions sheet.
 * @param props.quickOpen - Whether the sheet is open.
 * @param props.onOpenMenu - Opens the sidebar drawer.
 * @param props.menuOpen - Whether the drawer is open.
 * @returns The bar element.
 */
export function AdminTabBar({
  onOpenQuick,
  quickOpen,
  onOpenMenu,
  menuOpen,
}: AdminTabBarProps): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="admin-tab-bar fixed inset-x-0 bottom-0 z-25 grid grid-cols-5 border-t border-admin-border bg-admin-surface px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden print:hidden"
    >
      <TabLink tab={HOME} pathname={pathname} />
      <TabLink tab={SCHEDULE} pathname={pathname} />
      <button
        type="button"
        onClick={onOpenQuick}
        aria-haspopup="dialog"
        aria-expanded={quickOpen}
        aria-label="Quick actions"
        className={cn(SLOT_CLS, "text-admin-muted")}
      >
        {/* Raised disc, so the one coloured control in the bar is the add button. */}
        <span className="-mt-5 inline-flex size-13 items-center justify-center rounded-full bg-coquelicot-600 text-white shadow-[0_4px_12px_rgb(194_50_10/0.35)]">
          <FaPlus aria-hidden className="text-xl" />
        </span>
      </button>
      <TabLink tab={INVOICES} pathname={pathname} />
      <button
        type="button"
        onClick={onOpenMenu}
        aria-expanded={menuOpen}
        aria-controls="admin-sidebar"
        className={cn(SLOT_CLS, menuOpen ? "text-russian-violet" : "text-admin-muted")}
      >
        <FaBars aria-hidden className="text-xl" />
        Menu
      </button>
    </nav>
  );
}
