// src/features/admin/lib/quick-actions.ts
// Admin shortcut list shared by the phone + button (MobileQuickActions), the desktop top
// bar's Quick actions menu and the installed app's shortcuts (src/app/admin.webmanifest),
// so all three always offer the same destinations.

import type { IconType } from "react-icons";
import {
  FaArrowTrendUp,
  FaCalculator,
  FaFileSignature,
  FaHandHoldingDollar,
  FaReceipt,
} from "react-icons/fa6";

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
 * The shortcuts, most used first: the + button lists them bottom-up, so the first sits
 * nearest the thumb, and the installed app's long-press menu shows only the first 3 on Android.
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
  // The calculator in quote mode: "Save quote" leads and the payment boxes are hidden.
  { label: "New quote", icon: FaFileSignature, path: "/admin/business/calculator?quote=1" },
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
