// src/features/admin/components/ui/PageHeader.tsx
/**
 * @description Standard admin page header: optional breadcrumbs, a title, an
 * optional description, and a right-aligned actions slot. Replaces the
 * copy-pasted `<h1 class="mb-6 text-2xl font-extrabold text-russian-violet">`.
 * Server-safe.
 */

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** One breadcrumb: a label, optionally linked. */
interface Breadcrumb {
  /** Crumb label. */
  label: string;
  /** Destination; when omitted the crumb renders as plain text (current page). */
  href?: string;
}

/** Props for {@link PageHeader}. */
interface PageHeaderProps {
  /** Page title (string, or a richer node like number + status badge). */
  title: React.ReactNode;
  /** Optional supporting description under the title. */
  description?: React.ReactNode;
  /** Optional breadcrumb trail above the title. */
  breadcrumbs?: Breadcrumb[];
  /** Optional right-aligned actions (primary buttons etc.). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Renders the admin page header block.
 * @param props - Component props.
 * @param props.title - Page title.
 * @param props.description - Optional supporting description.
 * @param props.breadcrumbs - Optional breadcrumb trail.
 * @param props.actions - Optional right-aligned actions.
 * @param props.className - Extra classes.
 * @returns The header element.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps): React.ReactElement {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-admin-muted">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-admin-text hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-admin-text-secondary">{crumb.label}</span>
                )}
                {i < breadcrumbs.length - 1 && (
                  <span aria-hidden className="text-admin-faint">
                    /
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-russian-violet">{title}</h1>
          {description && <p className="mt-1 text-sm text-admin-text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
