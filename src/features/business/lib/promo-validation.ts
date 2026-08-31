// src/features/business/lib/promo-validation.ts
// One place deciding whether a promo's discount is well formed.
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
