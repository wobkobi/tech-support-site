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
  // Subscriptions post here when a recurring subscription is recorded (its
  // category flows straight to the Expenses sheet), so it must be a valid
  // category + a Data-Validation option in the Expenses category column.
  "Subscriptions",
  "Other",
] as const;

export const PAYMENT_METHODS = ["Business Account", "Personal then Reimburse", "Cash"] as const;

export const INCOME_METHODS = ["Bank Transfer", "Cash", "Mixed"] as const;
