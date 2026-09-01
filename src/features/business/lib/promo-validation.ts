// src/features/business/lib/promo-validation.ts
// One place deciding whether a promo is well formed.
//
// The create and edit routes each carried their own copy of this, and they
// drifted: adding fixed_amount and free_travel to the create route left the
// edit route still demanding exactly one of the two original columns, so
// editing a fixed-amount promo was rejected outright.

/** The four shapes a promo's discount can take. */
export type PromoDiscountType = "flat_hourly" | "percent" | "fixed_amount" | "free_travel";

/** The value columns a promo can carry, as they arrive from a request. */
export interface PromoDiscountValues {
  discountType?: PromoDiscountType | null;
  flatHourlyRate?: number | null;
  percentDiscount?: number | null;
  fixedAmount?: number | null;
  travelPercent?: number | null;
}

/**
 * The type a set of values represents, falling back to the value columns for
 * promos written before `discountType` existed.
 * @param values - The promo's discount fields.
 * @returns The resolved discount type.
 */
export function resolveDiscountType(values: PromoDiscountValues): PromoDiscountType {
  if (values.discountType) return values.discountType;
  if (values.flatHourlyRate != null) return "flat_hourly";
  if (values.fixedAmount != null) return "fixed_amount";
  if (values.travelPercent != null) return "free_travel";
  return "percent";
}

/**
 * Checks that the value column matching the discount type is present and in
 * range. Validating per type rather than as a blanket XOR is what lets a
 * fixed-amount or travel promo exist at all.
 * @param values - The promo's discount fields.
 * @returns An error message, or null when the discount is well formed.
 */
export function validateDiscount(values: PromoDiscountValues): string | null {
  switch (resolveDiscountType(values)) {
    case "flat_hourly":
      return typeof values.flatHourlyRate === "number" && values.flatHourlyRate > 0
        ? null
        : "flatHourlyRate must be a positive number";
    case "percent":
      return typeof values.percentDiscount === "number" &&
        values.percentDiscount > 0 &&
        values.percentDiscount < 1
        ? null
        : "percentDiscount must be between 0 and 1 (e.g. 0.20 for 20%)";
    case "fixed_amount":
      return typeof values.fixedAmount === "number" && values.fixedAmount > 0
        ? null
        : "fixedAmount must be a positive number";
    case "free_travel":
      // The fraction still charged: 0 is free travel, 0.5 is half price. 1
      // would be a promo that does nothing.
      return typeof values.travelPercent === "number" &&
        values.travelPercent >= 0 &&
        values.travelPercent < 1
        ? null
        : "travelPercent must be between 0 and 1 (0 = free travel)";
  }
}

/**
 * How a customer comes by a promo. Mirrored from the schema enum rather than
 * imported, keeping this module free of the Prisma client for the same reason
 * {@link PromoDiscountType} is duplicated here.
 */
export type PromoKind = "automatic" | "code";

/** The kind/code pairing as it arrives from a request. */
export interface PromoKindValues {
  kind?: PromoKind | null;
  /** Already normalised (uppercase, trimmed, null when blank). */
  code?: string | null;
}

/** A code is uppercase letters, digits and dashes, 3 to 32 characters. */
const CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;

/**
 * Checks that a promo's kind and code agree.
 *
 * The pairing is validated rather than inferred: a code promo saved without a
 * code could never be claimed by anyone, and an automatic promo carrying one
 * would look like a code promo in the list while applying to every visitor.
 * @param values - The promo's kind and normalised code.
 * @returns An error message, or null when the pairing is well formed.
 */
export function validateKind(values: PromoKindValues): string | null {
  const kind = values.kind ?? "automatic";
  const code = values.code ?? null;
  if (kind === "code") {
    if (!code) return "a code promo needs a code";
    if (!CODE_PATTERN.test(code)) {
      return "code must be 3-32 characters, letters, numbers and dashes only";
    }
    return null;
  }
  return code ? "an automatic promo cannot have a code" : null;
}
