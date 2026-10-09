"use client";
// src/features/admin/components/AdminSidebar.tsx
// Admin navigation sidebar, controlled by AdminShell. Fixed on the left at lg+, where it
// can collapse to an icon rail; below lg it slides in as a drawer over a backdrop. Auth
// rides the admin session cookie, so no token threads through the hrefs.

import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { useDialogKeys } from "@/features/admin/hooks/use-dialog-keys";
import { signOut } from "@/features/admin/lib/sign-out";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useRef } from "react";
import {
  FaAddressBook,
  FaArrowRightFromBracket,
  FaArrowTrendUp,
  FaArrowUpRightFromSquare,
  FaBell,
  FaBoxesStacked,
  FaBriefcase,
  FaCalculator,
  FaCalendarDays,
  FaCalendarWeek,
  FaEnvelope,
  FaFileInvoiceDollar,
  FaGaugeHigh,
  FaGear,
  FaHandHoldingDollar,
  FaMagnifyingGlassDollar,
  FaReceipt,
  FaRoute,
  FaShareNodes,
  FaStar,
  FaTags,
  FaXmark,
} from "react-icons/fa6";

type AdminPage =
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
  | "business-assets"
  | "business-invoices"
  | "business-calculator"
  | "business-quick"
  | "promos"
  | "mailing"
  | "social"
  | "notifications"
  | "settings";

interface NavItem {
  page: AdminPage;
  label: string;
  icon: React.ReactNode;
  path: string;
}

// Ordered by how often each page is opened: the day's jobs first, then the
// people behind them, then the occasional tools.
const NAV_ITEMS: NavItem[] = [
  {
    page: "dashboard",
    label: "Dashboard",
    icon: <FaGaugeHigh className="shrink-0" />,
    path: "/admin",
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
    page: "contacts",
    label: "Contacts",
    icon: <FaAddressBook className="shrink-0" />,
    path: "/admin/contacts",
  },
  {
    page: "reviews",
    label: "Reviews",
    icon: <FaStar className="shrink-0" />,
    path: "/admin/reviews",
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

// Overview heads the group; the rest follow the billing flow: price the job,
// invoice it, then the ledger it lands in, then the gear the business owns.
const BUSINESS_NAV_ITEMS: NavItem[] = [
  {
    page: "business",
    label: "Overview",
    icon: <FaBriefcase className="shrink-0" />,
    path: "/admin/business",
  },
  {
    page: "business-calculator",
    label: "Calculator",
    icon: <FaCalculator className="shrink-0" />,
    path: "/admin/business/calculator",
  },
  {
    page: "business-quick",
    label: "Quick price",
    icon: <FaHandHoldingDollar className="shrink-0" />,
    path: "/admin/business/quick",
  },
  {
    page: "business-invoices",
    label: "Invoices",
    icon: <FaFileInvoiceDollar className="shrink-0" />,
    path: "/admin/business/invoices",
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
    page: "business-assets",
    label: "Assets",
    icon: <FaBoxesStacked className="shrink-0" />,
    path: "/admin/business/assets",
  },
];

const PROMOS_NAV_ITEM: NavItem = {
  page: "promos",
  label: "Promos",
  icon: <FaTags className="shrink-0" />,
  path: "/admin/promos",
};

const MAILING_NAV_ITEM: NavItem = {
  page: "mailing",
  label: "Mailing list",
  icon: <FaEnvelope className="shrink-0" />,
  path: "/admin/mailing",
};

const SOCIAL_NAV_ITEM: NavItem = {
  page: "social",
  label: "Social posts",
  icon: <FaShareNodes className="shrink-0" />,
  path: "/admin/social",
};

const NOTIFICATIONS_NAV_ITEM: NavItem = {
  page: "notifications",
  label: "Notifications",
  icon: <FaBell className="shrink-0" />,
  path: "/admin/notifications",
};

const SETTINGS_NAV_ITEM: NavItem = {
  page: "settings",
  label: "Settings",
  icon: <FaGear className="shrink-0" />,
  path: "/admin/settings",
};

/** The occasional tools listed under the divider, in order. */
const TOOL_NAV_ITEMS: NavItem[] = [
  PROMOS_NAV_ITEM,
  MAILING_NAV_ITEM,
  SOCIAL_NAV_ITEM,
  NOTIFICATIONS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

/** Every nav path, for {@link activeNavPath}. */
const ALL_NAV_PATHS = [...NAV_ITEMS, ...BUSINESS_NAV_ITEMS, ...TOOL_NAV_ITEMS].map((i) => i.path);

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
 * Classes for one sidebar row (nav link or footer action). The active row's
 * moonstone rule is a pseudo-element, so the label does not shift when it
 * appears. Collapsed rows centre the icon; the collapse only applies at lg+,
 * so the phone drawer always shows full labels.
 * @param active - Whether the row is the current page.
 * @param collapsed - Whether the desktop sidebar is collapsed to icons.
 * @returns Class string.
 */
function rowClasses(active: boolean, collapsed: boolean): string {
  return cn(
    "relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[0.9375rem] font-semibold transition-colors select-none",
    active
      ? "bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-moonstone-400"
      : "text-white/75 hover:bg-white/10 hover:text-white",
    collapsed && "lg:justify-center lg:px-0",
  );
}

/**
 * Row label. Collapsed at lg+ it stays in the accessibility tree (sr-only) so the
 * row keeps its accessible name while only the icon shows.
 * @param props - Component props.
 * @param props.collapsed - Whether the desktop sidebar is collapsed to icons.
 * @param props.children - Label text.
 * @returns The label element.
 */
function RowLabel({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <span className={cn("whitespace-nowrap", collapsed && "lg:sr-only")}>{children}</span>;
}

/** Props for {@link AdminSidebar}. */
interface AdminSidebarProps {
  /** Whether the phone drawer is open (below lg). */
  drawerOpen: boolean;
  /** Closes the drawer; `returnFocus` sends focus back to the top bar's menu button. */
  onDrawerClose: (returnFocus: boolean) => void;
  /** Whether the desktop sidebar is collapsed to an icon rail (lg+ only). */
  collapsed: boolean;
  /** The drawer's close button, focused by AdminShell when the drawer opens. */
  closeButtonRef: React.Ref<HTMLButtonElement>;
}

/**
 * Admin navigation sidebar. On `lg+` (>=1024px) it stays fixed on the left,
 * full width or collapsed to icons. Below `lg` it is a drawer that slides in
 * over a backdrop; Escape, the close button or the backdrop dismiss it, and
 * Tab stays inside it while open. Following a link closes it too. The active
 * item is derived from the current pathname.
 * @param props - Component props.
 * @param props.drawerOpen - Whether the phone drawer is open.
 * @param props.onDrawerClose - Closes the drawer, optionally returning focus to the menu button.
 * @param props.collapsed - Whether the desktop sidebar is collapsed to icons.
 * @param props.closeButtonRef - Ref for the drawer's close button.
 * @returns Sidebar element with mobile drawer behaviour.
 */
export function AdminSidebar({
  drawerOpen,
  onDrawerClose,
  collapsed,
  closeButtonRef,
}: AdminSidebarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const asideRef = useRef<HTMLElement>(null);
  const active = activeNavPath(pathname, ALL_NAV_PATHS);

  useDialogKeys(asideRef, drawerOpen, () => onDrawerClose(true));

  /**
   * Renders one nav link with the active styling and the collapsed tooltip.
   * @param item - The nav item.
   * @param item.page - Page key, used as the React key.
   * @param item.label - Visible label, also the collapsed tooltip.
   * @param item.icon - Leading icon.
   * @param item.path - Link target, compared against the active path.
   * @returns The link element.
   */
  function navLink({ page, label, icon, path }: NavItem): React.ReactElement {
    const isActive = active === path;
    return (
      <Link
        key={page}
        href={path}
        onClick={() => onDrawerClose(false)}
        aria-current={isActive ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={rowClasses(isActive, collapsed)}
      >
        {icon}
        <RowLabel collapsed={collapsed}>{label}</RowLabel>
      </Link>
    );
  }

  return (
    <>
      {/* Mobile backdrop - visible only when drawer is open. */}
      <div
        onClick={() => onDrawerClose(true)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden print:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        ref={asideRef}
        id="admin-sidebar"
        data-open={drawerOpen || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-hidden bg-russian-violet lg:translate-x-0 print:hidden",
          // `.app-admin-drawer` (globals.css) owns the translate and width transitions,
          // and below lg hides the closed drawer (no data-open) so Tab skips it.
          "app-admin-drawer",
          collapsed && "lg:w-16",
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand. Collapsed, only the eyebrow stays. */}
        <div
          className={cn(
            "flex items-center justify-between border-b border-white/10 px-5 py-4",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <div>
            <p className={cn(ADMIN_EYEBROW_CLS, "text-moonstone-300")}>Admin</p>
            <p
              className={cn(
                "mt-0.5 text-base font-extrabold whitespace-nowrap text-white",
                collapsed && "lg:hidden",
              )}
            >
              To the Point
            </p>
          </div>
          {/* Close button - only rendered below lg. */}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onDrawerClose(true)}
            aria-label="Close menu"
            className="-mr-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <FaXmark aria-hidden />
          </button>
        </div>

        {/* Nav */}
        <nav aria-label="Admin" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(navLink)}

          {/* Collapsed, the heading is read by screen readers only and a rule marks the group. */}
          <p
            className={cn(
              ADMIN_EYEBROW_CLS,
              "mt-4 mb-1 px-3 text-moonstone-300",
              collapsed && "lg:sr-only",
            )}
          >
            Business
          </p>
          {collapsed && (
            <div aria-hidden className="my-2 hidden border-t border-white/10 lg:block" />
          )}
          {BUSINESS_NAV_ITEMS.map(navLink)}

          <div className="my-2 border-t border-white/10" />

          {TOOL_NAV_ITEMS.map(navLink)}
        </nav>

        {/* Footer - link back to the public site + sign-out trigger. */}
        <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-3">
          <Link
            href="/"
            onClick={() => onDrawerClose(false)}
            title={collapsed ? "Back to site" : undefined}
            className={rowClasses(false, collapsed)}
          >
            <FaArrowUpRightFromSquare className="shrink-0" />
            <RowLabel collapsed={collapsed}>Back to site</RowLabel>
          </Link>
          <button
            type="button"
            onClick={() => void signOut(router)}
            title={collapsed ? "Sign out" : undefined}
            className={rowClasses(false, collapsed)}
          >
            <FaArrowRightFromBracket className="shrink-0" />
            <RowLabel collapsed={collapsed}>Sign out</RowLabel>
          </button>
        </div>
      </aside>
    </>
  );
}
