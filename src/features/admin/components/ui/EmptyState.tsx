// src/features/admin/components/ui/EmptyState.tsx
// Placeholder for a list or panel with nothing to show: a short title, an optional line
// of explanation and an optional action. Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link EmptyState}. */
interface EmptyStateProps {
  /** One-line title, e.g. "No invoices match your filters". */
  title: React.ReactNode;
  /** Optional explanation under the title. */
  body?: React.ReactNode;
  /** Optional action (a button or link). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Renders the empty state.
 * @param props - Component props.
 * @param props.title - One-line title.
 * @param props.body - Optional explanation.
 * @param props.action - Optional action.
 * @param props.className - Extra classes.
 * @returns The empty-state element.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: EmptyStateProps): React.ReactElement {
  return (
    <div className={cn("px-5 py-8 text-center", className)}>
      <p className="text-[0.9375rem] font-bold text-admin-text">{title}</p>
      {body && <p className="mt-1 text-sm text-admin-muted">{body}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
