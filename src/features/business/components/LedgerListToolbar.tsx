"use client";
// src/features/business/components/LedgerListToolbar.tsx
// Filter toolbar above the income and expenses ledgers: search, financial year, method,
// a from/to date range, plus the category select and missing-receipt toggle that only the
// expenses ledger passes. Controlled: each view owns its filter state.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { fyKeyOf, type FinancialYear } from "@/features/business/lib/financial-year";
import type React from "react";
import { useId } from "react";

/** Props for {@link LedgerListToolbar}. */
interface LedgerListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Search box placeholder, naming the fields it matches. */
  searchPlaceholder: string;
  fyKey: string;
  onFyChange: (value: string) => void;
  financialYears: FinancialYear[];
  methodFilter: string;
  onMethodChange: (value: string) => void;
  methodOptions: string[];
  fromDate: string;
  onFromChange: (value: string) => void;
  toDate: string;
  onToChange: (value: string) => void;
  /** Category filter; the select renders only when options are passed. */
  categoryFilter?: string;
  onCategoryChange?: (value: string) => void;
  categoryOptions?: string[];
  /** Missing-receipt toggle; renders only when a handler is passed. */
  missingReceiptOnly?: boolean;
  onMissingReceiptChange?: (value: boolean) => void;
  /** Shows the Clear button. */
  anyFilterActive: boolean;
  onClear: () => void;
}

/**
 * Renders the ledger filter toolbar.
 * @param props - Component props.
 * @param props.search - Search text.
 * @param props.onSearchChange - Receives the new search text.
 * @param props.searchPlaceholder - Search box placeholder.
 * @param props.fyKey - Selected FY key, or "all".
 * @param props.onFyChange - Receives the new FY key.
 * @param props.financialYears - FYs offered in the select.
 * @param props.methodFilter - Selected payment method, or "all".
 * @param props.onMethodChange - Receives the new method.
 * @param props.methodOptions - Methods present in the ledger.
 * @param props.fromDate - From date (YYYY-MM-DD or "").
 * @param props.onFromChange - Receives the new from date.
 * @param props.toDate - To date (YYYY-MM-DD or "").
 * @param props.onToChange - Receives the new to date.
 * @param props.categoryFilter - Selected category, or "all".
 * @param props.onCategoryChange - Receives the new category.
 * @param props.categoryOptions - Categories present in the ledger; omit to hide the select.
 * @param props.missingReceiptOnly - Whether only rows without a receipt show.
 * @param props.onMissingReceiptChange - Receives the toggle; omit to hide it.
 * @param props.anyFilterActive - Whether any filter is set (shows Clear).
 * @param props.onClear - Clears every filter.
 * @returns The toolbar element.
 */
export function LedgerListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  fyKey,
  onFyChange,
  financialYears,
  methodFilter,
  onMethodChange,
  methodOptions,
  fromDate,
  onFromChange,
  toDate,
  onToChange,
  categoryFilter,
  onCategoryChange,
  categoryOptions,
  missingReceiptOnly,
  onMissingReceiptChange,
  anyFilterActive,
  onClear,
}: LedgerListToolbarProps): React.ReactElement {
  const id = useId();
  // Phones: the selects and dates share rows two at a time; from sm each keeps its width.
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
            placeholder={searchPlaceholder}
            className="h-10"
          />
        </AdminField>
      }
      filters={
        <>
          <AdminField label="Financial year" htmlFor={`${id}-fy`} className={fieldCls}>
            <AdminSelect
              id={`${id}-fy`}
              value={fyKey}
              onChange={(e) => onFyChange(e.target.value)}
              className="h-10"
            >
              <option value="all">All years</option>
              {financialYears.map((f) => (
                <option key={f.label} value={fyKeyOf(f.label)}>
                  {f.label}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
          {categoryOptions && onCategoryChange && (
            <AdminField label="Category" htmlFor={`${id}-category`} className={fieldCls}>
              <AdminSelect
                id={`${id}-category`}
                value={categoryFilter}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="h-10"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>
          )}
          <AdminField label="Method" htmlFor={`${id}-method`} className={fieldCls}>
            <AdminSelect
              id={`${id}-method`}
              value={methodFilter}
              onChange={(e) => onMethodChange(e.target.value)}
              className="h-10"
            >
              <option value="all">All methods</option>
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
          <AdminField label="From" htmlFor={`${id}-from`} className={fieldCls}>
            <AdminInput
              id={`${id}-from`}
              type="date"
              value={fromDate}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-10 sm:w-44"
            />
          </AdminField>
          <AdminField label="To" htmlFor={`${id}-to`} className={fieldCls}>
            <AdminInput
              id={`${id}-to`}
              type="date"
              value={toDate}
              onChange={(e) => onToChange(e.target.value)}
              className="h-10 sm:w-44"
            />
          </AdminField>
          {/* Bottom-aligned so these sit level with the inputs, not their labels. */}
          {onMissingReceiptChange && (
            <div className="flex h-10 items-center self-end">
              <AdminCheckbox
                checked={missingReceiptOnly ?? false}
                onChange={onMissingReceiptChange}
                label="Missing receipt"
              />
            </div>
          )}
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
