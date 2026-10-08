// src/features/admin/components/ui/SortableTh.tsx
// Header cell for a sortable table column. The list keeps its own sort state; this only
// renders the button, the direction arrow and `aria-sort` so screen readers announce it.

"use client";

import { TH_CLS } from "@/features/admin/components/ui/admin-table";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Props for {@link SortableTh}. */
interface SortableThProps {
  /** Column label. */
  label: React.ReactNode;
  /** True when the table is currently sorted by this column. */
  active: boolean;
  /** Current sort direction (only shown when `active`). */
  dir: "asc" | "desc";
  /** Called when the header is clicked; the list decides what toggling means. */
  onSort: () => void;
  className?: string;
}

/**
 * Renders a sortable `<th>`.
 * @param props - Component props.
 * @param props.label - Column label.
 * @param props.active - Whether this column is the sort key.
 * @param props.dir - Current sort direction.
 * @param props.onSort - Click handler.
 * @param props.className - Extra classes on the cell.
 * @returns The header cell.
 */
export function SortableTh({
  label,
  active,
  dir,
  onSort,
  className,
}: SortableThProps): React.ReactElement {
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={cn(TH_CLS, className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 font-bold hover:text-admin-text",
          active && "text-admin-text",
        )}
      >
        {label}
        {active && (
          <span aria-hidden className="text-[0.7rem]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </th>
  );
}
