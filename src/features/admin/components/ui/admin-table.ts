// src/features/admin/components/ui/admin-table.ts
// Shared class strings for admin data tables.

/** The `<table>` itself. */
export const TABLE_CLS = "w-full text-[0.9375rem] tabular-nums";

/** The `<thead>`: a faint band with a rule underneath. */
export const THEAD_CLS = "border-b border-admin-border bg-admin-bg/60";

/** A header cell. */
export const TH_CLS =
  "px-4 py-2.5 text-left text-sm font-semibold whitespace-nowrap text-admin-muted";

/** The `<tbody>`: hairline rules between rows. */
export const TBODY_CLS = "divide-y divide-admin-border";

/** A body row, tinted on hover. */
export const ROW_CLS = "hover:bg-admin-bg";

/** A body cell. */
export const TD_CLS = "px-4 py-3";

/**
 * Actions column pinned right. Collapsed borders don't follow a sticky cell, so the rule is
 * an inset shadow; give the cell an opaque background.
 */
export const PINNED_CELL_CLS = "sticky right-0 shadow-[inset_1px_0_0_var(--color-admin-border)]";
