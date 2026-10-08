// src/features/admin/lib/quick-actions.ts
// Admin shortcut list shared by the phone + button (MobileQuickActions) and the desktop
// top bar's Quick actions menu, so both always offer the same four destinations.

import type { IconType } from "react-icons";
import { FaArrowTrendUp, FaCalculator, FaHandHoldingDollar, FaReceipt } from "react-icons/fa6";

/** One shortcut in the quick actions menus. */
export interface QuickAction {
  label: string;
  /** Icon component, rendered by each menu at its own size. */
  icon: IconType;
  path: string;
  /** Opens a form: add ?new=<stamp> so each tap reopens it, even on the same page. */
  opensForm?: boolean;
}

/**
 * The shortcuts, in phone order: the + button lists them bottom-up, so the most used
 * sits nearest the thumb.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { label: "Quick price", icon: FaHandHoldingDollar, path: "/admin/business/quick" },
  {
    label: "Add income",
    icon: FaArrowTrendUp,
    path: "/admin/business/income",
    opensForm: true,
  },
  {
    label: "Add expense",
    icon: FaReceipt,
    path: "/admin/business/expenses",
    opensForm: true,
  },
  { label: "New invoice", icon: FaCalculator, path: "/admin/business/calculator" },
];

/**
 * Link target for a shortcut. Form-opening actions carry the stamp minted when the
 * menu opened, so a repeat tap on the same page still reopens the form.
 * @param action - The shortcut.
 * @param stamp - Value minted when the menu opened (Date.now() as a string).
 * @returns `{path}?new={stamp}` for form-opening actions, otherwise the bare path.
 */
export function quickActionHref(action: QuickAction, stamp: string): string {
  return action.opensForm ? `${action.path}?new=${stamp}` : action.path;
}
