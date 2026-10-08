// src/features/admin/components/ui/ListToolbar.tsx
// Toolbar above an admin list: search on the left, filters beside it, the result count
// and list-level actions on the right. Slots only - each list keeps its own filter state
// and URL sync. Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link ListToolbar}. */
interface ListToolbarProps {
  /** Search input. */
  search?: React.ReactNode;
  /** Filter controls (selects, chips, date ranges). */
  filters?: React.ReactNode;
  /** Result count, e.g. "24 of 310". */
  count?: React.ReactNode;
  /** List-level actions (export, import, new). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Renders the list toolbar; empty slots collapse.
 * @param props - Component props.
 * @param props.search - Search input.
 * @param props.filters - Filter controls.
 * @param props.count - Result count.
 * @param props.actions - List-level actions.
 * @param props.className - Extra classes.
 * @returns The toolbar element.
 */
export function ListToolbar({
  search,
  filters,
  count,
  actions,
  className,
}: ListToolbarProps): React.ReactElement {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-3", className)}>
      {search && <div className="min-w-0 flex-1 basis-64">{search}</div>}
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      {(count || actions) && (
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {count && <p className="text-sm text-admin-muted">{count}</p>}
          {actions}
        </div>
      )}
    </div>
  );
}
