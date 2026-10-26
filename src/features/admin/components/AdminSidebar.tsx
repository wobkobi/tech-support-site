"use client";
// src/features/admin/components/AdminSidebar.tsx
// Admin navigation sidebar: fixed (collapsible to icons) at lg+, a drawer below lg. The most-used
// links stay pinned; the rest sit in sections with one open at a time, so the list fits.

import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { useDialogKeys } from "@/features/admin/hooks/use-dialog-keys";
import { signOut } from "@/features/admin/lib/sign-out";
import { useInboxUnread } from "@/features/social/hooks/use-inbox-unread";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";
import {
  FaAddressBook,
  FaArrowRightFromBracket,
  FaArrowTrendUp,
  FaArrowUpRightFromSquare,
  FaBell,
  FaBoxesStacked,
  FaBriefcase,
  FaBullhorn,
  FaCalculator,
  FaCalendarDays,
  FaCalendarWeek,
  FaCar,
  FaChevronDown,
  FaClock,
  FaEnvelope,
  FaFileInvoiceDollar,
  FaFileSignature,
  FaGaugeHigh,
  FaGear,
  FaHandHoldingDollar,
  FaMagnifyingGlassDollar,
  FaPalette,
  FaReceipt,
  FaRoute,
  FaSackDollar,
  FaScaleBalanced,
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
  | "business-tax"
  | "business-assets"
  | "business-trips"
  | "business-invoices"
  | "business-quotes"
  | "business-calculator"
  | "business-quick"
  | "promos"
  | "mailing"
  | "social"
  | "post-maker"
  | "notifications"
  | "settings";

interface NavItem {
  page: AdminPage;
  label: string;
  icon: React.ReactNode;
  path: string;
  /** A count to show beside the label (a dot when collapsed); hidden at 0. */
  badge?: number;
}

// Always shown above the sections, ordered by how often each page is opened.
const PINNED_NAV_ITEMS: NavItem[] = [
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
    page: "business-calculator",
    label: "Calculator",
    icon: <FaCalculator className="shrink-0" />,
    path: "/admin/business/calculator",
  },
  {
    page: "business-invoices",
    label: "Invoices",
    icon: <FaFileInvoiceDollar className="shrink-0" />,
    path: "/admin/business/invoices",
  },
  {
    page: "social",
    label: "Social",
    icon: <FaShareNodes className="shrink-0" />,
    path: "/admin/social",
  },
];

const DAY_NAV_ITEMS: NavItem[] = [
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

// Overview first, then the billing flow: price, quote, ledger, tax, assets, km.
const BUSINESS_NAV_ITEMS: NavItem[] = [
  {
    page: "business",
    label: "Overview",
    icon: <FaBriefcase className="shrink-0" />,
    path: "/admin/business",
  },
  {
    page: "business-quick",
    label: "Quick price",
    icon: <FaHandHoldingDollar className="shrink-0" />,
    path: "/admin/business/quick",
  },
  {
    page: "business-quotes",
    label: "Quotes",
    icon: <FaFileSignature className="shrink-0" />,
    path: "/admin/business/invoices?status=quote",
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
    page: "business-tax",
    label: "Tax",
    icon: <FaScaleBalanced className="shrink-0" />,
    path: "/admin/business/tax",
  },
  {
    page: "business-assets",
    label: "Assets",
    icon: <FaBoxesStacked className="shrink-0" />,
    path: "/admin/business/assets",
  },
  {
    page: "business-trips",
    label: "Trips",
    icon: <FaCar className="shrink-0" />,
    path: "/admin/business/trips",
  },
];

const MARKETING_NAV_ITEMS: NavItem[] = [
  {
    page: "promos",
    label: "Promos",
    icon: <FaTags className="shrink-0" />,
    path: "/admin/promos",
  },
  {
    page: "mailing",
    label: "Mailing list",
    icon: <FaEnvelope className="shrink-0" />,
    path: "/admin/mailing",
  },
  {
    page: "post-maker",
    label: "Post maker",
    icon: <FaPalette className="shrink-0" />,
    path: "/admin/social/design",
  },
];

/** Set-up pages, always shown in the footer above Back to site. */
const FOOTER_NAV_ITEMS: NavItem[] = [
  {
    page: "notifications",
    label: "Notifications",
    icon: <FaBell className="shrink-0" />,
    path: "/admin/notifications",
  },
  {
    page: "settings",
    label: "Settings",
    icon: <FaGear className="shrink-0" />,
    path: "/admin/settings",
  },
];

type SectionKey = "day" | "business" | "marketing";

interface NavSection {
  key: SectionKey;
  label: string;
  /** Stands in for the label on the collapsed icon rail. */
  icon: React.ReactNode;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  { key: "day", label: "Day to day", icon: <FaClock className="shrink-0" />, items: DAY_NAV_ITEMS },
  {
    key: "business",
    label: "Business",
    icon: <FaSackDollar className="shrink-0" />,
    items: BUSINESS_NAV_ITEMS,
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: <FaBullhorn className="shrink-0" />,
    items: MARKETING_NAV_ITEMS,
  },
];

/** Every nav path, for {@link activeNavPath}. */
const ALL_NAV_PATHS = [
  ...PINNED_NAV_ITEMS,
  ...NAV_SECTIONS.flatMap((s) => s.items),
  ...FOOTER_NAV_ITEMS,
].map((i) => i.path);

/**
 * The section holding a nav path.
 * @param path - The active nav path, or null.
 * @returns Its section, or null for a pinned or footer page or no match.
 */
function sectionOf(path: string | null): SectionKey | null {
  return NAV_SECTIONS.find((s) => s.items.some((i) => i.path === path))?.key ?? null;
}

/**
 * The nav path that best matches the URL: exact for "/admin", else the longest prefix.
 * A path with a query (Quotes at `?status=quote`) needs all its params and beats the bare path.
 * @param pathname - The current pathname from usePathname.
 * @param search - The current query from useSearchParams.
 * @param paths - All nav-item paths.
 * @returns The best-matching path, or null when none match.
 */
function activeNavPath(pathname: string, search: URLSearchParams, paths: string[]): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const p of paths) {
    const [base = p, query] = p.split("?");
    let matches: boolean;
    if (query) {
      const wanted = new URLSearchParams(query);
      matches =
        pathname === base &&
        [...wanted].every(([key, value]) => search.get(key)?.toLowerCase() === value);
    } else {
      matches =
        p === "/admin" ? pathname === "/admin" : pathname === p || pathname.startsWith(`${p}/`);
    }
    // A query match outranks the same path without one.
    const score = base.length + (query ? 1 : 0);
    if (matches && score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Classes for one sidebar row. The active rule is a pseudo-element so the label
 * doesn't shift; the collapse applies at lg+ only. Rows keep 44px touch targets in
 * the drawer and drop to 30px on desktop, so a laptop screen fits the list.
 * @param active - Whether the row is the current page.
 * @param collapsed - Whether the desktop sidebar is collapsed to icons.
 * @returns Class string.
 */
function rowClasses(active: boolean, collapsed: boolean): string {
  return cn(
    "relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[0.9375rem] font-semibold transition-colors select-none lg:min-h-8 lg:py-1",
    active
      ? "bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-moonstone-400"
      : "text-white/75 hover:bg-white/10 hover:text-white",
    collapsed && "lg:justify-center lg:px-0",
  );
}

/**
 * Row label; sr-only when collapsed so the row keeps its accessible name.
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
 * Admin navigation sidebar. Fixed at lg+; below lg a drawer that traps Tab and
 * closes on Escape, the backdrop, the close button or following a link.
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
  const searchParams = useSearchParams();
  const active = activeNavPath(pathname, searchParams, ALL_NAV_PATHS);
  const unread = useInboxUnread();
  const pageSection = sectionOf(active);
  const [openSection, setOpenSection] = useState<SectionKey | null>(pageSection);
  const [openedFor, setOpenedFor] = useState(active);
  // A new page opens its own section; a pinned or footer page leaves the open one as it was.
  if (openedFor !== active) {
    setOpenedFor(active);
    if (pageSection) setOpenSection(pageSection);
  }

  useDialogKeys(asideRef, drawerOpen, () => onDrawerClose(true));

  /**
   * Adds the Inbox's unread count to the Social link.
   * @param item - The nav item.
   * @returns The item, with its badge when it's Social.
   */
  function withBadge(item: NavItem): NavItem {
    return item.page === "social" ? { ...item, badge: unread } : item;
  }

  /**
   * Renders one nav link with the active styling and the collapsed tooltip.
   * @param item - The nav item.
   * @param item.page - Page key, used as the React key.
   * @param item.label - Visible label, also the collapsed tooltip.
   * @param item.icon - Leading icon.
   * @param item.path - Link target, compared against the active path.
   * @param item.badge - Count shown beside the label, if any.
   * @returns The link element.
   */
  function navLink({ page, label, icon, path, badge }: NavItem): React.ReactElement {
    const isActive = active === path;
    const count = badge && badge > 0 ? badge : 0;
    return (
      <Link
        key={page}
        href={path}
        onClick={() => onDrawerClose(false)}
        aria-current={isActive ? "page" : undefined}
        title={collapsed ? (count ? `${label} (${count} unread)` : label) : undefined}
        className={rowClasses(isActive, collapsed)}
      >
        {icon}
        <RowLabel collapsed={collapsed}>{label}</RowLabel>
        {count > 0 && (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "ml-auto rounded-full bg-coquelicot-600 px-2 py-0.5 text-sm leading-none font-bold text-white",
                collapsed && "lg:hidden",
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
            {collapsed && (
              <span
                aria-hidden="true"
                className="absolute top-2 right-3 hidden size-2.5 rounded-full bg-coquelicot-500 lg:block"
              />
            )}
            <span className="sr-only">, {count} unread</span>
          </>
        )}
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
          // globals.css: owns the transitions and hides the closed drawer from Tab below lg.
          "app-admin-drawer",
          collapsed && "lg:w-16",
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand. Collapsed, only the eyebrow stays. */}
        <div
          className={cn(
            "flex items-center justify-between border-b border-white/10 px-5 py-4 lg:py-3",
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
              To the Point Tech
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
        <nav
          aria-label="Admin"
          className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-4 lg:py-3"
        >
          {PINNED_NAV_ITEMS.map(withBadge).map(navLink)}
          <div aria-hidden className="border-t border-white/10" />
          {NAV_SECTIONS.map((section) => {
            const isOpen = openSection === section.key;
            const listId = `admin-nav-${section.key}`;
            return (
              <div key={section.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setOpenSection(isOpen ? null : section.key)}
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  title={collapsed ? section.label : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-moonstone-300 transition-colors select-none hover:bg-white/10 hover:text-white lg:min-h-8",
                    collapsed && "lg:justify-center lg:px-0",
                  )}
                >
                  <span className={cn("hidden", collapsed && "lg:inline-flex")}>
                    {section.icon}
                  </span>
                  <span
                    className={cn(ADMIN_EYEBROW_CLS, "text-inherit", collapsed && "lg:sr-only")}
                  >
                    {section.label}
                  </span>
                  <FaChevronDown
                    aria-hidden
                    className={cn(
                      "ml-auto shrink-0 text-sm transition-[rotate]",
                      !isOpen && "-rotate-90",
                      collapsed && "lg:hidden",
                    )}
                  />
                </button>
                {isOpen && (
                  <div id={listId} className="flex flex-col gap-1">
                    {section.items.map(navLink)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer - set-up pages, the link back to the public site and sign-out. */}
        <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-3 lg:py-2">
          {FOOTER_NAV_ITEMS.map(navLink)}
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
