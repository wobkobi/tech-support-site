"use client";
// src/features/business/components/InvoicesListToolbar.tsx
// Search, status and issued-date filters above the invoices list. Controlled: every value
// and handler comes from InvoicesListView, which owns the filter state and its URL sync.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import {
  FILTER_OPTIONS,
  type FilterKey,
} from "@/features/business/components/invoices-list-options";
import type React from "react";
import { useId } from "react";

/** Props for {@link InvoicesListToolbar}. */
interface InvoicesListToolbarProps {
  search: string;
  statusFilter: FilterKey;
  fromDate: string;
  toDate: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: FilterKey) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Shows the Clear button. */
  anyFilterActive: boolean;
  onClear: () => void;
}

/**
 * Renders the invoices filter toolbar.
 * @param props - Component props.
 * @param props.search - Search text.
 * @param props.statusFilter - Selected status bucket.
 * @param props.fromDate - Issued-from date (YYYY-MM-DD or "").
 * @param props.toDate - Issued-to date (YYYY-MM-DD or "").
 * @param props.onSearchChange - Receives the new search text.
 * @param props.onStatusChange - Receives the new status bucket.
 * @param props.onFromChange - Receives the new issued-from date.
 * @param props.onToChange - Receives the new issued-to date.
 * @param props.anyFilterActive - Whether any filter is set (shows Clear).
 * @param props.onClear - Clears every filter.
 * @returns The toolbar element.
 */
export function InvoicesListToolbar({
  search,
  statusFilter,
  fromDate,
  toDate,
  onSearchChange,
  onStatusChange,
  onFromChange,
  onToChange,
  anyFilterActive,
  onClear,
}: InvoicesListToolbarProps): React.ReactElement {
  const id = useId();
  // Phones: status and the two dates share rows two at a time; from sm each keeps its width.
  const fieldCls = "min-w-0 flex-1 basis-36 sm:flex-none sm:basis-auto";
  return (
    <ListToolbar
      search={
        <AdminField label="Search" htmlFor={`${id}-q`}>
          <AdminInput
            id={`${id}-q`}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Number, client or contact"
            className="h-10"
          />
        </AdminField>
      }
      filters={
        <>
          <AdminField label="Status" htmlFor={`${id}-status`} className={fieldCls}>
            <AdminSelect
              id={`${id}-status`}
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value as FilterKey)}
              className="h-10 sm:w-40"
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
          <AdminField label="Issued from" htmlFor={`${id}-from`} className={fieldCls}>
            <AdminInput
              id={`${id}-from`}
              type="date"
              value={fromDate}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-10 sm:w-44"
            />
          </AdminField>
          <AdminField label="Issued to" htmlFor={`${id}-to`} className={fieldCls}>
            <AdminInput
              id={`${id}-to`}
              type="date"
              value={toDate}
              onChange={(e) => onToChange(e.target.value)}
              className="h-10 sm:w-44"
            />
          </AdminField>
          {/* Bottom-aligned so it sits level with the inputs, not their labels. */}
          {anyFilterActive && (
            <AdminButton variant="ghost" onClick={onClear} className="self-end">
              Clear
            </AdminButton>
          )}
        </>
      }
    />
  );
}
