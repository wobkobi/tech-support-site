import type React from "react";
import { AdminSidebar, type AdminPage } from "@/features/admin/components/AdminSidebar";
import { cn } from "@/shared/lib/cn";

interface AdminPageLayoutProps {
  token: string;
  current: AdminPage;
  children: React.ReactNode;
  contentClassName?: string;
}

/**
 * Shared layout wrapper for admin pages - renders the sidebar and content area.
 * @param props - Layout props
 * @param props.token - Admin auth token passed to the sidebar
 * @param props.current - Active sidebar page identifier
 * @param props.children - Page content
 * @param props.contentClassName - Optional class override for the content wrapper
 * @returns Admin page layout element
 */
export function AdminPageLayout({
  token,
  current,
  children,
  contentClassName,
}: AdminPageLayoutProps): React.ReactElement {
  return (
    <div className={cn("flex min-h-screen")}>
      <AdminSidebar token={token} current={current} />
      {/* Sidebar is fixed-position; reserve its width on lg+ only. Below lg the
          sidebar slides in as an overlay drawer so content gets the full width. */}
      <div className={cn("flex-1 bg-slate-50 lg:ml-56 print:ml-0 print:bg-white")}>
        {/* Top padding bumped on mobile so the page heading clears the
            hamburger button (h-11 + 12px top inset = ~56px). Print drops
            padding so the invoice fills the page edge-to-edge. */}
        <div
          className={cn(contentClassName ?? "px-4 pb-8 pt-16 sm:px-6 sm:pt-8 lg:pt-8", "print:p-0")}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
