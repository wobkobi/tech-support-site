// src/features/business/lib/constants.ts
// Fixed ledger enumerations (frequencies, expense categories, payment and income methods)
// for form selects and validation.

export const VALID_FREQUENCIES = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annually",
] as const;

// Order must match the Expenses sheet's category dropdown.
export const EXPENSE_CATEGORIES = [
  "Fuel",
  // Rego, WOF, servicing, tyres, car insurance. Not deducted while on km rates.
  "Vehicle",
  "Tools",
  // Parts billed on to a client.
  "Parts for clients",
  "Software",
  "Marketing",
  "Phone/Internet",
  "Travel",
  // Recorded subscriptions post here, so it must also be a sheet Data-Validation option.
  "Subscriptions",
  "Bank fees",
  "Repairs",
  "Office supplies",
  "Insurance",
  "Accounting",
  // Courses, books, certifications.
  "Training",
  "Other",
] as const;

export const PAYMENT_METHODS = ["Business Account", "Personal then Reimburse", "Cash"] as const;

// Bank first: forms default to INCOME_METHODS[0].
export const INCOME_METHODS = ["Bank", "Cash", "Mixed"] as const;
