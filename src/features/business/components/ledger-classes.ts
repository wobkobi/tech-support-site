// src/features/business/components/ledger-classes.ts
// Class strings shared by the money lists (income, expenses, subscriptions): the compact
// row button (also used by the tag rows in TaxonomyManageModal), the admin card link style
// and the pinned actions column.

import { TD_CLS, TH_CLS } from "@/features/admin/components/ui/admin-table";
import { cn } from "@/shared/lib/cn";

/** Row-action AdminButton override: h-8 like `xs`, but at the 14px minimum text size. */
export const ROW_BUTTON_CLS = "h-8 px-2.5 text-sm";

/** Underlined violet text link, the admin card link style. */
export const LEDGER_LINK_CLS =
  "text-sm font-semibold text-russian-violet underline underline-offset-2 hover:decoration-2";

/** Body cell with tighter side padding below xl, so wide tables need less sideways scroll at lg. */
export const LEDGER_TD_CLS = cn(TD_CLS, "max-xl:px-3");

/** Header cell with the same tighter padding. */
export const LEDGER_TH_CLS = cn(TH_CLS, "max-xl:px-3");

/**
 * Actions column pinned to the right edge, so the row actions stay on screen when the
 * table scrolls sideways. Collapsed table borders don't travel with a sticky cell, so the
 * left rule is an inset shadow; give the cell an opaque background so scrolled cells pass
 * under it.
 */
export const PINNED_CLS = "sticky right-0 shadow-[inset_1px_0_0_var(--color-admin-border)]";
