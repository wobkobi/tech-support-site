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

/** The eligibility limits a promo can carry, as they arrive from a request. */
export interface PromoLimitValues {
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
}

/**
 * Checks the eligibility limits are whole positive counts.
 *
 * Rejected rather than coerced: a limit of 0 would disable the promo through a
 * field nobody reads as an off switch, and a fractional one would compare
 * unpredictably against a count.
 * @param values - The promo's limit fields.
 * @returns An error message, or null when the limits are well formed.
 */
export function validateLimits(values: PromoLimitValues): string | null {
  for (const [name, value] of [
    ["maxRedemptions", values.maxRedemptions],
    ["perCustomerLimit", values.perCustomerLimit],
  ] as const) {
    if (value == null) continue;
    if (!Number.isInteger(value) || value < 1) {
      return `${name} must be a whole number of at least 1, or left empty for no limit`;
    }
  }
  return null;
}

/** The recurring restriction as it arrives from a request. */
export interface PromoWindowValues {
  activeWeekdays?: number[] | null;
  activeFromMinute?: number | null;
  activeToMinute?: number | null;
}

/**
 * Checks a promo's recurring restriction is one the resolver can act on.
 *
 * The two time bounds must both be set or both be absent. Half a range is
 * enforced as no range at all, so accepting one would silently give the
 * operator a wider promo than the form appeared to describe.
 * @param values - The promo's weekday and time-of-day fields.
 * @returns An error message, or null when the restriction is well formed.
 */
export function validateRecurringWindow(values: PromoWindowValues): string | null {
  const days = values.activeWeekdays ?? [];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return "activeWeekdays must be whole numbers from 0 (Sunday) to 6 (Saturday)";
  }
  if (new Set(days).size !== days.length) {
    return "activeWeekdays must not repeat a day";
  }
  if (days.length === 7) {
    return "selecting every day is the same as no weekday restriction - leave them all unticked";
  }

  const from = values.activeFromMinute ?? null;
  const to = values.activeToMinute ?? null;
  if ((from == null) !== (to == null)) {
    return "a time-of-day restriction needs both a start and an end";
  }
  if (from == null || to == null) return null;
  for (const value of [from, to]) {
    if (!Number.isInteger(value) || value < 0 || value > 1439) {
      return "times must be whole minutes from 0 to 1439";
    }
  }
  if (from === to) {
    return "the start and end of a time restriction must differ";
  }
  return null;
}

/** One spend band as it arrives from a request. */
export interface PromoTierInput {
  minSpend?: number | null;
  flatHourlyRate?: number | null;
  percentDiscount?: number | null;
  fixedAmount?: number | null;
  travelPercent?: number | null;
}

/**
 * Checks a promo's spend threshold and bands.
 *
 * Each band is put through {@link validateDiscount} against the parent's type,
 * so a band cannot carry a different kind of discount from the promo it belongs
 * to - a percent promo with a flat-rate band would price as neither.
 *
 * Floors must ascend with no repeats. Resolution takes the highest band reached
 * and must never depend on stored order, so two bands at the same floor have no
 * defined winner and are rejected rather than silently resolved.
 * @param discountType - The parent promo's resolved discount type.
 * @param minSpend - Floor for the whole promo, or null.
 * @param tiers - The spend bands, possibly empty.
 * @returns An error message, or null when the thresholds are well formed.
 */
export function validateTiers(
  discountType: PromoDiscountType,
  minSpend: number | null | undefined,
  tiers: PromoTierInput[] | null | undefined,
): string | null {
  if (minSpend != null && (typeof minSpend !== "number" || minSpend <= 0)) {
    return "minSpend must be a positive amount, or left empty";
  }

  const bands = tiers ?? [];
  if (bands.length === 0) return null;

  const floors: number[] = [];
  for (const tier of bands) {
    if (typeof tier.minSpend !== "number" || tier.minSpend <= 0) {
      return "every tier needs a positive spend threshold";
    }
    floors.push(tier.minSpend);
    const valueError = validateDiscount({ discountType, ...tier });
    if (valueError) return `tier at $${tier.minSpend}: ${valueError}`;
  }

  if (new Set(floors).size !== floors.length) {
    return "two tiers cannot share a spend threshold";
  }
  // The parent floor is the entry price, so a band below it could never be the
  // one that applies and is a mistake rather than a narrower offer.
  if (minSpend != null && floors.some((f) => f < minSpend)) {
    return "a tier cannot sit below the promo's own minimum spend";
  }
  return null;
}
