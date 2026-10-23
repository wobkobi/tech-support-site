// src/features/admin/components/ui/admin-table.ts
// Shared class strings for admin data tables.

/** The `<table>` itself. */
export const TABLE_CLS = "w-full text-[0.9375rem] tabular-nums";

/** The `<thead>`: a faint band with a rule underneath. */
export const THEAD_CLS = "border-b border-admin-border bg-admin-bg/60";

/**
 * Horizontal scroll for a table's wrapper, in place of `overflow-x-auto`. A scrolling box
 * traps a sticky header inside it, so from xl (where every admin table fits the full-width
 * page) the wrapper clips instead, which doesn't, and {@link STICKY_THEAD_CLS} can pin.
 * Below xl the y lock stops the box scrolling up and down as well; it goes back to visible
 * at xl, since clip beside hidden would make the wrapper a scrolling box again.
 */
export const TABLE_SCROLL_CLS =
  "overflow-x-auto overflow-y-hidden xl:overflow-x-clip xl:overflow-y-visible";

/**
 * Add to {@link THEAD_CLS} to pin the column names on xl+, under the top bar and any
 * StickyList toolbar (`--list-toolbar-h`). The band moves onto the cells and turns opaque
 * (the same tint, mixed onto the card white) so rows don't show through, and so the end
 * cells can round to the card's corners. The rule under it moves onto the cells too,
 * since a collapsed table border stays behind when the header sticks; a pinned cell
 * ({@link PINNED_CELL_CLS}) keeps its left rule as a second shadow. The header tucks 1px under
 * whatever is above it (StickyList's bar sits 1px under the top bar, hence -2px), so pixel
 * snapping can't open a line between them for rows to show through.
 */
export const STICKY_THEAD_CLS =
  "xl:sticky xl:top-[calc(3.5rem+var(--list-toolbar-h,0px)-2px)] xl:z-5 xl:bg-transparent xl:[&>tr>th]:bg-[color-mix(in_srgb,var(--color-admin-bg)_60%,var(--color-admin-surface))] xl:[&>tr>th]:shadow-[inset_0_-1px_0_var(--color-admin-border)] xl:[&>tr>th.sticky]:shadow-[inset_1px_0_0_var(--color-admin-border),inset_0_-1px_0_var(--color-admin-border)] xl:[&>tr>th:first-child]:rounded-tl-[calc(var(--radius-lg)-1px)] xl:[&>tr>th:last-child]:rounded-tr-[calc(var(--radius-lg)-1px)]";

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
