// src/features/admin/components/dashboard/DashboardPanel.tsx
// Titled list-panel card for the admin dashboard: a header row over a list or an empty state.

import { Card } from "@/features/admin/components/ui/Card";
import Link from "next/link";
import type React from "react";
import { FaCaretRight } from "react-icons/fa6";

/**
 * A titled list-panel card for the dashboard grid: header (title + optional
 * count badge + optional "view all" link) over a list or an empty state.
 * @param props - Panel props.
 * @param props.title - Panel heading.
 * @param props.badge - Optional node beside the title (e.g. a count pill).
 * @param props.action - Optional right-aligned link.
 * @param props.action.label - Link text.
 * @param props.action.href - Link destination.
 * @param props.empty - Text shown when there are no rows.
 * @param props.children - The list element, or null to show the empty state.
 * @param props.className - Extra classes for the card.
 * @returns Panel element.
 */
export function DashboardPanel({
  title,
  badge,
  action,
  empty,
  children,
  className,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: { label: string; href: string };
  empty: string;
  children: React.ReactNode | null;
  className?: string;
}): React.ReactElement {
  return (
    <Card padding="none" className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-admin-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-admin-text">
          {title}
          {badge}
        </h2>
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-sm font-bold text-russian-violet hover:underline"
          >
            {action.label}
            <FaCaretRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
      {children ?? <p className="px-5 py-6 text-sm text-admin-faint">{empty}</p>}
    </Card>
  );
}
