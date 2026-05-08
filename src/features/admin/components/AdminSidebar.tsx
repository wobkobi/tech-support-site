// src/features/admin/components/AdminSidebar.tsx
import type React from "react";
import Link from "next/link";
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
} from "react-icons/fa6";

export type AdminPage =
  | "dashboard"
  | "reviews"
  | "contacts"
  | "bookings"
  | "travel"
  | "business"
  | "business-income"
  | "business-expenses"
  | "business-invoices"
  | "business-calculator";

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

interface AdminSidebarProps {
  token: string;
  current: AdminPage;
}

/**
 * Shared dark sidebar navigation rendered on every admin sub-page.
 * @param props - Component props.
 * @param props.token - Admin token forwarded to nav link query strings.
 * @param props.current - Identifies which page is currently active (highlighted in the nav).
 * @returns Sidebar element.
 */
export function AdminSidebar({ token, current }: AdminSidebarProps): React.ReactElement {
  return (
    <aside className={cn("bg-russian-violet fixed inset-y-0 left-0 z-10 flex w-56 flex-col")}>
      {/* Brand */}
      <div className={cn("border-b border-white/10 px-5 py-5")}>
        <p className={cn("text-xs font-semibold uppercase tracking-widest text-white/40")}>Admin</p>
        <p className={cn("mt-0.5 text-sm font-bold text-white")}>To The Point</p>
      </div>

      {/* Nav */}
      <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4")}>
        {NAV_ITEMS.map(({ page, label, icon, path }) => (
          <Link
            key={page}
            href={`${path}?token=${encodeURIComponent(token)}`}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
    </aside>
  );
}
