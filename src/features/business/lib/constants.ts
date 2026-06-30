// src/features/business/lib/constants.ts
/**
 * @description Fixed enumerations for the business ledger - subscription
 * frequencies, expense categories, and payment/income methods - used to
 * populate form selects and validate entries.
 */

export const VALID_FREQUENCIES = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annually",
] as const;

export type Frequency = (typeof VALID_FREQUENCIES)[number];

export const EXPENSE_CATEGORIES = [
  "Fuel",
  "Tools",
  "Software",
  "Marketing",
  "Phone/Internet",
  "Travel",
  "Bank fees",
  "Repairs",
  "Office supplies",
  "Insurance",
  "Accounting",
  "Other",
] as const;

export const PAYMENT_METHODS = ["Business Account", "Personal then Reimburse", "Cash"] as const;

export const INCOME_METHODS = ["Bank Transfer", "Cash", "Mixed"] as const;
