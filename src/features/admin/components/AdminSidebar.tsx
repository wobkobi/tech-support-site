"use client";
// src/features/admin/components/AdminSidebar.tsx
/**
 * @description Admin navigation sidebar. Fixed on the left at lg+; below lg it
 * collapses behind a hamburger and slides in as a drawer over a backdrop,
 * auto-closing on navigation. Auth rides the admin session cookie, so no token
 * threads through the hrefs.
 */
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import {
  FaAddressBook,
  FaArrowRightFromBracket,
  FaArrowTrendUp,
  FaArrowUpRightFromSquare,
  FaBars,
  FaBriefcase,
  FaCalculator,
  FaCalendarDays,
  FaCalendarWeek,
  FaFileInvoiceDollar,
  FaGaugeHigh,
  FaGear,
  FaMagnifyingGlassDollar,
  FaReceipt,
  FaRoute,
  FaStar,
  FaTags,
  FaXmark,
} from "react-icons/fa6";

export type AdminPage =
  | "dashboard"
  | "reviews"
  | "contacts"
  | "schedule"
  | "bookings"
  | "travel"
  | "price-estimates"
  | "business"
  | "business-income"
  | "business-expenses"
  | "business-invoices"
  | "business-calculator"
  | "promos"
  | "settings";

interface NavItem {
  page: AdminPage;
  label: string;
  icon: React.ReactNode;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    page: "dashboard",
    label: "Dashboard",
    icon: <FaGaugeHigh className="shrink-0" />,
    path: "/admin",
  },
  {
    page: "reviews",
    label: "Reviews",
    icon: <FaStar className="shrink-0" />,
    path: "/admin/reviews",
  },
  {
    page: "contacts",
    label: "Contacts",
    icon: <FaAddressBook className="shrink-0" />,
    path: "/admin/contacts",
  },
  {
    page: "schedule",
    label: "Schedule",
    icon: <FaCalendarWeek className="shrink-0" />,
    path: "/admin/schedule",
  },
  {
    page: "bookings",
    label: "Bookings",
    icon: <FaCalendarDays className="shrink-0" />,
    path: "/admin/bookings",
  },
  {
    page: "travel",
    label: "Travel",
    icon: <FaRoute className="shrink-0" />,
    path: "/admin/travel",
  },
  {
    page: "price-estimates",
    label: "Estimates",
    icon: <FaMagnifyingGlassDollar className="shrink-0" />,
    path: "/admin/price-estimates",
  },
];

const BUSINESS_NAV_ITEMS: NavItem[] = [
  {
    page: "business",
    label: "Overview",
    icon: <FaBriefcase className="shrink-0" />,
    path: "/admin/business",
  },
  {
    page: "business-income",
    label: "Income",
    icon: <FaArrowTrendUp className="shrink-0" />,
    path: "/admin/business/income",
  },
  {
    page: "business-expenses",
    label: "Expenses",
    icon: <FaReceipt className="shrink-0" />,
    path: "/admin/business/expenses",
  },
  {
    page: "business-invoices",
    label: "Invoices",
    icon: <FaFileInvoiceDollar className="shrink-0" />,
    path: "/admin/business/invoices",
  },
  {
    page: "business-calculator",
    label: "Calculator",
    icon: <FaCalculator className="shrink-0" />,
    path: "/admin/business/calculator",
  },
];

const PROMOS_NAV_ITEM: NavItem = {
  page: "promos",
  label: "Promos",
  icon: <FaTags className="shrink-0" />,
  path: "/admin/promos",
};

const SETTINGS_NAV_ITEM: NavItem = {
  page: "settings",
  label: "Settings",
  icon: <FaGear className="shrink-0" />,
  path: "/admin/settings",
};

/**
 * The nav path that best matches the current pathname: exact for the dashboard
 * ("/admin"), otherwise the longest path that is a prefix of the pathname (so
 * `/admin/business/invoices/[id]/edit` still highlights Invoices, not Overview).
 * @param pathname - The current pathname from usePathname.
 * @param paths - All nav-item paths.
 * @returns The best-matching path, or null when none match.
 */
function activeNavPath(pathname: string, paths: string[]): string | null {
  let best: string | null = null;
  for (const p of paths) {
    const matches =
      p === "/admin" ? pathname === "/admin" : pathname === p || pathname.startsWith(`${p}/`);
    if (matches && (best === null || p.length > best.length)) best = p;
  }
  return best;
}

/**
 * Admin navigation sidebar. On `lg+` (≥1024px) it stays fixed on the left at
 * all times. Below `lg` it collapses behind a hamburger button and slides in
 * as a drawer over a backdrop, so phone-width admin pages get the full
 * viewport for content. The drawer auto-closes when the user navigates to a
 * different route. The active item is derived from the current pathname. Auth
 * is carried by the admin session cookie - no token threading through hrefs.
 * @returns Sidebar element with mobile drawer behaviour.
 */
export function AdminSidebar(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeNavPath(
    pathname,
    [...NAV_ITEMS, ...BUSINESS_NAV_ITEMS, PROMOS_NAV_ITEM, SETTINGS_NAV_ITEM].map((i) => i.path),
  );
  // Pairing the drawer state with the pathname auto-closes it on navigation
  // without a setState-in-effect (which the React lint rule rejects).
  const [state, setState] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  });
  const open = state.open && state.pathname === pathname;
  /**
   * Open or close the drawer, anchoring the state to the current pathname so
   * subsequent navigations auto-close it without a setState-in-effect.
   * @param next - Target open state.
   * @returns void
   */
  const setOpen = (next: boolean): void => setState({ open: next, pathname });

  /**
   * Signs the operator out by clearing the session cookie on the server, then
   * navigates to /admin/login. Errors are swallowed - the cookie either
   * clears or the redirect itself ends the session client-side.
   */
  async function handleSignOut(): Promise<void> {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* ignore - redirect still happens */
    }
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile hamburger - only rendered below lg. Sits over page content. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="fixed top-3 left-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-russian-violet text-white shadow-lg lg:hidden print:hidden"
      >
        <FaBars className="text-base" />
      </button>

      {/* Mobile backdrop - visible only when drawer is open. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden print:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-russian-violet lg:translate-x-0 print:hidden",
          // `.app-admin-drawer` (globals.css) owns the translate transition.
          "app-admin-drawer",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className="flex items-start justify-between border-b border-white/10 px-5 py-5">
          <div>
            <p className="text-xs font-semibold tracking-widest text-white/40 uppercase">Admin</p>
            <p className="mt-0.5 text-sm font-bold text-white">To The Point</p>
          </div>
          {/* Close button - only rendered below lg. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <FaXmark />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={path}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active === path
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}

          <p className="mt-4 mb-1 px-3 text-xs font-semibold tracking-widest text-white/30 uppercase">
            Business
          </p>
          {BUSINESS_NAV_ITEMS.map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={path}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active === path
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}

          <div className="my-2 border-t border-white/10" />

          {[PROMOS_NAV_ITEM, SETTINGS_NAV_ITEM].map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={path}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active === path
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer - link back to the public site + sign-out trigger. */}
        <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-3">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
          >
            <FaArrowUpRightFromSquare className="shrink-0" />
            Back to site
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
          >
            <FaArrowRightFromBracket className="shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
