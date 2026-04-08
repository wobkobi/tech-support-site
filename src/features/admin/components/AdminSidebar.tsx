// src/features/admin/components/AdminSidebar.tsx
import type React from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";
import { FaGaugeHigh, FaStar, FaAddressBook, FaCalendarDays, FaRoute } from "react-icons/fa6";

export type AdminPage = "dashboard" | "reviews" | "contacts" | "bookings" | "travel";

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
      <nav className={cn("flex flex-1 flex-col gap-1 px-3 py-4")}>
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
      </nav>
    </aside>
  );
}
