// src/features/business/components/ledger-classes.ts
// Cell padding shared by the money tables (income, expenses, subscriptions), a notch
// tighter than the kit's below xl so the wide ledgers need less sideways scroll at lg.

import { TD_CLS, TH_CLS } from "@/features/admin/components/ui/admin-table";
import { cn } from "@/shared/lib/cn";

/** Body cell with tighter side padding below xl, so wide tables need less sideways scroll at lg. */
export const LEDGER_TD_CLS = cn(TD_CLS, "max-xl:px-3");

/** Header cell with the same tighter padding. */
export const LEDGER_TH_CLS = cn(TH_CLS, "max-xl:px-3");
