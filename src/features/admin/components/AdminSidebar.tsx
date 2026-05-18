"use client";
// src/features/admin/components/AdminSidebar.tsx
import { useState } from "react";
import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import {
  FaGaugeHigh,
  FaStar,
  FaAddressBook,
  FaCalendarDays,
  FaRoute,
  FaBriefcase,
  FaArrowTrendUp,
  FaReceipt,
  FaFileInvoiceDollar,
  FaCalculator,
  FaTags,
  FaGear,
  FaBars,
  FaXmark,
  FaArrowUpRightFromSquare,
  FaMagnifyingGlassDollar,
} from "react-icons/fa6";

export type AdminPage =
  | "dashboard"
  | "reviews"
  | "contacts"
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
    icon: <FaGaugeHigh className={cn("shrink-0")} />,
    path: "/admin",
  },
  {
    page: "reviews",
    label: "Reviews",
    icon: <FaStar className={cn("shrink-0")} />,
    path: "/admin/reviews",
  },
  {
    page: "contacts",
    label: "Contacts",
    icon: <FaAddressBook className={cn("shrink-0")} />,
    path: "/admin/contacts",
  },
  {
    page: "bookings",
    label: "Calendar",
    icon: <FaCalendarDays className={cn("shrink-0")} />,
    path: "/admin/bookings",
  },
  {
    page: "travel",
    label: "Travel",
    icon: <FaRoute className={cn("shrink-0")} />,
    path: "/admin/travel",
  },
  {
    page: "price-estimates",
    label: "Estimates",
    icon: <FaMagnifyingGlassDollar className={cn("shrink-0")} />,
    path: "/admin/price-estimates",
  },
];

const BUSINESS_NAV_ITEMS: NavItem[] = [
  {
    page: "business",
    label: "Overview",
    icon: <FaBriefcase className={cn("shrink-0")} />,
    path: "/admin/business",
  },
  {
    page: "business-income",
    label: "Income",
    icon: <FaArrowTrendUp className={cn("shrink-0")} />,
    path: "/admin/business/income",
  },
  {
    page: "business-expenses",
    label: "Expenses",
    icon: <FaReceipt className={cn("shrink-0")} />,
    path: "/admin/business/expenses",
  },
  {
    page: "business-invoices",
    label: "Invoices",
    icon: <FaFileInvoiceDollar className={cn("shrink-0")} />,
    path: "/admin/business/invoices",
  },
  {
    page: "business-calculator",
    label: "Calculator",
    icon: <FaCalculator className={cn("shrink-0")} />,
    path: "/admin/business/calculator",
  },
];

const PROMOS_NAV_ITEM: NavItem = {
  page: "promos",
  label: "Promos",
  icon: <FaTags className={cn("shrink-0")} />,
  path: "/admin/promos",
};

const SETTINGS_NAV_ITEM: NavItem = {
  page: "settings",
  label: "Settings",
  icon: <FaGear className={cn("shrink-0")} />,
  path: "/admin/settings",
};

interface AdminSidebarProps {
  token: string;
  current: AdminPage;
}

/**
 * Admin navigation sidebar. On `lg+` (≥1024px) it stays fixed on the left at
 * all times. Below `lg` it collapses behind a hamburger button and slides in
 * as a drawer over a backdrop, so phone-width admin pages get the full
 * viewport for content. The drawer auto-closes when the user navigates to a
 * different route.
 * @param props - Component props.
 * @param props.token - Admin token forwarded to nav link query strings.
 * @param props.current - Identifies which page is currently active (highlighted in the nav).
 * @returns Sidebar element with mobile drawer behaviour.
 */
export function AdminSidebar({ token, current }: AdminSidebarProps): React.ReactElement {
  const pathname = usePathname();
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

  return (
    <>
      {/* Mobile hamburger — only rendered below lg. Sits over page content. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className={cn(
          "bg-russian-violet fixed left-3 top-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-lg text-white shadow-lg lg:hidden print:hidden",
        )}
      >
        <FaBars className={cn("text-base")} />
      </button>

      {/* Mobile backdrop — visible only when drawer is open. */}
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
          "bg-russian-violet fixed inset-y-0 left-0 z-40 flex w-56 flex-col lg:translate-x-0 print:hidden",
          // `.app-admin-drawer` (globals.css) owns the translate transition.
          "app-admin-drawer",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className={cn("flex items-start justify-between border-b border-white/10 px-5 py-5")}>
          <div>
            <p className={cn("text-xs font-semibold uppercase tracking-widest text-white/40")}>
              Admin
            </p>
            <p className={cn("mt-0.5 text-sm font-bold text-white")}>To The Point</p>
          </div>
          {/* Close button — only rendered below lg. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white lg:hidden",
            )}
          >
            <FaXmark />
          </button>
        </div>

        {/* Nav */}
        <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4")}>
          {NAV_ITEMS.map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={`${path}?token=${encodeURIComponent(token)}`}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                current === page
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}

          <p
            className={cn(
              "mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-widest text-white/30",
            )}
          >
            Business
          </p>
          {BUSINESS_NAV_ITEMS.map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={`${path}?token=${encodeURIComponent(token)}`}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                current === page
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}

          <div className={cn("my-2 border-t border-white/10")} />

          {[PROMOS_NAV_ITEM, SETTINGS_NAV_ITEM].map(({ page, label, icon, path }) => (
            <Link
              key={page}
              href={`${path}?token=${encodeURIComponent(token)}`}
              onClick={() => setOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                current === page
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/90",
              )}
            >
              {icon}
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer - link back to the public site. */}
        <div className={cn("border-t border-white/10 px-3 py-3")}>
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white/90",
            )}
          >
            <FaArrowUpRightFromSquare className={cn("shrink-0")} />
            Back to site
          </Link>
        </div>
      </aside>
    </>
  );
}
