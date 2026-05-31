import type React from "react";
import { AdminSidebar, type AdminPage } from "@/features/admin/components/AdminSidebar";
import { cn } from "@/shared/lib/cn";

interface AdminPageLayoutProps {
  current: AdminPage;
  children: React.ReactNode;
  contentClassName?: string;
}

/**
 * Shared layout wrapper for admin pages - renders the sidebar and content
 * area. Auth lives in the admin session cookie now; no token prop threads
 * through here.
 * @param props - Layout props.
 * @param props.current - Active sidebar page identifier.
 * @param props.children - Page content.
 * @param props.contentClassName - Optional class override for the content wrapper.
 * @returns Admin page layout element.
 */
export function AdminPageLayout({
  current,
  children,
  contentClassName,
}: AdminPageLayoutProps): React.ReactElement {
  return (
    <div className={cn("flex min-h-screen overflow-x-clip")}>
      <AdminSidebar current={current} />
      {/* Sidebar is fixed-position; reserve its width on lg+ only. Below lg the
          sidebar slides in as an overlay drawer so content gets the full width.
          `min-w-0` on the flex child stops intrinsic content (long descriptions,
          wide tables) from blowing out the column - the canonical flex fix.
          `overflow-x-clip` on the parent is the safety net for any rogue child
          that still overflows; `clip` (not `hidden`) preserves `position: sticky`
          on descendants like the calculator's preview panel at lg+. */}
      <div className={cn("min-w-0 flex-1 bg-slate-50 lg:ml-56 print:ml-0 print:bg-white")}>
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
