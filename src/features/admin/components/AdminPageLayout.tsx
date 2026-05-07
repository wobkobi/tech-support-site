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
      <div className={cn("ml-56 flex-1 bg-slate-50")}>
        <div className={cn(contentClassName ?? "px-6 py-8")}>{children}</div>
      </div>
    </div>
  );
}
