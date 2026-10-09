// src/features/admin/components/ui/admin-table.ts
// Class strings for admin data tables, so every list (bookings, contacts, invoices,
// income, expenses) renders the same header band, row dividers and cell padding.

/** The `<table>` itself. */
export const TABLE_CLS = "w-full text-[0.9375rem]";

/** The `<thead>`: a grey band with a rule underneath. */
export const THEAD_CLS = "border-b border-admin-border bg-admin-bg";

/** A header cell. */
export const TH_CLS = "px-4 py-3 text-left text-sm font-bold text-admin-muted";

/** The `<tbody>`: hairline rules between rows. */
export const TBODY_CLS = "divide-y divide-admin-border";

/** A body row, tinted on hover. */
export const ROW_CLS = "hover:bg-admin-bg";

/** A body cell. */
export const TD_CLS = "px-4 py-3";

/**
 * Actions column pinned to the right edge, so the row actions stay on screen when a wide
 * table scrolls sideways. Collapsed table borders don't travel with a sticky cell, so the
 * left rule is an inset shadow; give the cell an opaque background so scrolled cells pass
 * under it.
 */
export const PINNED_CELL_CLS = "sticky right-0 shadow-[inset_1px_0_0_var(--color-admin-border)]";
