// src/features/business/lib/promo-form.ts
// Promo admin form model: the form's string-held state, conversion to and from
// stored promo columns, and the preview promo the customer-facing helpers read.

import type { PromoRow } from "@/app/admin/(shell)/promos/page";
import type { ActivePromo } from "@/features/business/lib/promos";

/** Shared classes for the promo form inputs. */
export const PROMO_INPUT_CLASS =
  "rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:ring-2 focus:ring-russian-violet/30 focus:outline-none";

export type PromoType = "flat" | "percent" | "fixed" | "travel";

/**
 * The stored columns for one amount of a given type.
 *
 * Shared by the promo's own value and every tier, so a band cannot be stored
 * differently from the promo it belongs to - the travel inversion in particular
 * is easy to apply once and forget the second time.
 * @param type - The form's discount type.
 * @param amount - The number the operator typed.
 * @returns The four value columns, exactly one of them set.
 */
export function discountColumns(
  type: PromoType,
  amount: number,
): {
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount: number | null;
  travelPercent: number | null;
} {
  return {
    flatHourlyRate: type === "flat" ? amount : null,
    percentDiscount: type === "percent" ? amount / 100 : null,
    fixedAmount: type === "fixed" ? amount : null,
    // The operator enters "% off travel"; the column stores the fraction still
    // charged, so 100% off is 0.
    travelPercent: type === "travel" ? 1 - amount / 100 : null,
  };
}

/**
 * The number to show in a tier's amount input, read the same way as the
 * promo's own.
 * @param tier - The stored tier.
 * @param promo - Its parent, which decides how the value is read.
 * @returns The operator-facing amount, or "" when the tier is blank.
 */
function tierAmountFor(tier: PromoRow["tiers"][number], promo: PromoRow): number | string {
  return amountFor({ ...promo, ...tier });
}

/** Form type > the column the API stores it under. */
export const DISCOUNT_TYPE: Record<
  PromoType,
  "flat_hourly" | "percent" | "fixed_amount" | "free_travel"
> = {
  flat: "flat_hourly",
  percent: "percent",
  fixed: "fixed_amount",
  travel: "free_travel",
};

/** What the amount field means for each type, shown beside the input. */
export const AMOUNT_LABEL: Record<PromoType, string> = {
  flat: "Hourly rate ($/hr)",
  percent: "Discount (%)",
  fixed: "Amount off ($)",
  travel: "Travel discount (%)",
};

/**
 * The form type a stored promo corresponds to. Falls back to the value columns
 * for rows written before discountType existed.
 * @param p - Stored promo row.
 * @returns The matching form type.
 */
export function promoTypeOf(p: PromoRow): PromoType {
  if (p.discountType === "fixed_amount") return "fixed";
  if (p.discountType === "free_travel") return "travel";
  if (p.discountType === "flat_hourly") return "flat";
  if (p.discountType === "percent") return "percent";
  return p.flatHourlyRate !== null ? "flat" : "percent";
}

/**
 * The number to show in the amount field for a stored promo, in the units the
 * operator types rather than the units the column stores.
 * @param p - Stored promo row.
 * @returns The amount, or an empty string when the promo has no value set.
 */
function amountFor(p: PromoRow): number | string {
  switch (promoTypeOf(p)) {
    case "flat":
      return p.flatHourlyRate ?? "";
    case "percent":
      // 2dp so a fractional discount like 13.33% survives a round trip.
      return p.percentDiscount !== null ? Math.round(p.percentDiscount * 10000) / 100 : "";
    case "fixed":
      return p.fixedAmount ?? "";
    case "travel":
      // Stored as the fraction still charged; shown as the discount.
      return p.travelPercent !== null ? Math.round((1 - p.travelPercent) * 10000) / 100 : "";
  }
}

export interface FormState {
  title: string;
  description: string;
  /** Start date in YYYY-MM-DD form. Internally widened to local-midnight when sent. */
  startDate: string;
  /** End date (inclusive) in YYYY-MM-DD form. Internally widened to start-of-next-day. */
  endDate: string;
  type: PromoType;
  amount: string;
  isActive: boolean;
  /** Higher wins when windows overlap. Held as a string for the input. */
  priority: string;
  /** Automatic promos apply to everyone; a code promo only to whoever enters it. */
  kind: "automatic" | "code";
  /** The code, uppercase. Ignored when the kind is automatic. */
  code: string;
  /** Total uses allowed across everyone. Blank for no cap. */
  maxRedemptions: string;
  /** Uses allowed per customer. Blank for no cap. */
  perCustomerLimit: string;
  newCustomersOnly: boolean;
  /** NZ weekdays it applies on (0 = Sunday); empty means every day. */
  activeWeekdays: number[];
  /** NZ start time as "HH:mm", or "" for no time restriction. */
  activeFrom: string;
  /** NZ end time as "HH:mm", or "" for no time restriction. */
  activeTo: string;
  /** Floor for the pre-discount total. Blank for none. */
  minSpend: string;
  /**
   * Spend bands, held as strings for the inputs. Empty is the ordinary
   * single-value promo; the amount is read the same way the top-level one is,
   * so a percent band is entered as "20" and stored as 0.2.
   */
  tiers: { minSpend: string; amount: string }[];
}

/**
 * "HH:mm" > minutes past midnight, or null when blank or unparseable.
 * @param value - Time-input value.
 * @returns Minutes past midnight, or null.
 */
export function toMinuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 1439 ? minute : null;
}

/**
 * Minutes past midnight > the "HH:mm" a time input expects.
 * @param minute - Minutes past midnight, or null.
 * @returns Time-input value, or "" when there is none.
 */
function fromMinuteOfDay(minute: number | null): string {
  if (minute == null) return "";
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Weekday labels for the recurring-window picker, indexed 0 = Sunday. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * ISO timestamp > "YYYY-MM-DD" (local date parts) for <input type="date">.
 * @param iso - ISO 8601 timestamp.
 * @returns Date-input string, or empty for invalid input.
 */
export function toDateInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  /**
   * Left-pads a single digit with a leading zero.
   * @param n - Number to pad.
   * @returns Two-character string.
   */
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * YYYY-MM-DD > ISO timestamp at local-midnight (start of day).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
export function startOfDayISO(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/**
 * YYYY-MM-DD > ISO timestamp at start of next day (so end is inclusive).
 * @param date - YYYY-MM-DD string.
 * @returns ISO timestamp.
 */
export function endOfDayISO(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * `endAt` ISO > inclusive YYYY-MM-DD (subtracts the day added on save).
 * @param iso - ISO 8601 timestamp.
 * @returns Date-input string.
 */
export function endIsoToInclusiveDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - 1);
  return toDateInput(d.toISOString());
}

/**
 * Turns the form into the promo shape the customer-facing helpers read, so the
 * preview below is produced by the same code that writes the real banner.
 *
 * Null until there is an amount to describe - a half-typed form would otherwise
 * preview "Limited offer", which is the fallback for a misconfigured promo and
 * would read as a warning.
 * @param form - Current form state.
 * @returns A promo to describe, or null when the form is not ready.
 */
export function previewPromo(form: FormState): ActivePromo | null {
  const amount = parseFloat(form.amount);
  if (isNaN(amount) || amount <= 0) return null;
  if (!form.endDate) return null;
  return {
    id: "preview",
    title: form.title,
    description: form.description || null,
    startAt: startOfDayISO(form.startDate),
    endAt: endOfDayISO(form.endDate),
    kind: form.kind,
    code: form.kind === "code" ? form.code : null,
    discountType: DISCOUNT_TYPE[form.type],
    ...discountColumns(form.type, amount),
    minSpend: form.minSpend.trim() ? parseFloat(form.minSpend) : null,
    tiers: form.tiers
      .filter((t) => t.minSpend.trim() && t.amount.trim())
      .map((t) => ({
        minSpend: parseFloat(t.minSpend),
        ...discountColumns(form.type, parseFloat(t.amount)),
      })),
    activeWeekdays: form.activeWeekdays,
    activeFromMinute: toMinuteOfDay(form.activeFrom),
    activeToMinute: toMinuteOfDay(form.activeTo),
  };
}

/**
 * Empty form pre-populated with today + a week-out end.
 * @returns Default FormState.
 */
export function emptyForm(): FormState {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    startDate: toDateInput(now.toISOString()),
    endDate: toDateInput(nextWeek.toISOString()),
    type: "flat",
    amount: "",
    isActive: true,
    priority: "0",
    kind: "automatic",
    code: "",
    maxRedemptions: "",
    perCustomerLimit: "",
    newCustomersOnly: false,
    activeWeekdays: [],
    activeFrom: "",
    activeTo: "",
    minSpend: "",
    tiers: [],
  };
}

/**
 * Short chips naming every advanced setting that differs from the default, so
 * the folded "Advanced options" summary never hides a live restriction.
 * @param form - Current form state.
 * @returns One chip per non-default setting; empty when all are default.
 */
export function advancedChips(form: FormState): string[] {
  const chips: string[] = [];
  const priority = parseInt(form.priority, 10);
  if (!isNaN(priority) && priority !== 0) chips.push(`Priority ${priority}`);
  if (form.minSpend.trim()) chips.push(`Min spend $${form.minSpend.trim()}`);
  if (form.tiers.length > 0)
    chips.push(`${form.tiers.length} spend tier${form.tiers.length === 1 ? "" : "s"}`);
  if (form.maxRedemptions.trim()) chips.push(`${form.maxRedemptions.trim()} uses total`);
  if (form.perCustomerLimit.trim()) chips.push(`${form.perCustomerLimit.trim()} per customer`);
  if (form.newCustomersOnly) chips.push("New customers only");
  if (form.activeWeekdays.length > 0)
    chips.push(form.activeWeekdays.map((d) => WEEKDAY_LABELS[d]).join(", "));
  if (form.activeFrom || form.activeTo)
    chips.push(`${form.activeFrom || "start"} to ${form.activeTo || "end"}`);
  return chips;
}

/**
 * A stored promo loaded back into the form, in the units the operator types.
 * @param p - Stored promo row.
 * @returns Form state for editing it.
 */
export function formFromPromo(p: PromoRow): FormState {
  return {
    title: p.title,
    description: p.description ?? "",
    startDate: toDateInput(p.startAt),
    // Stored as start-of-next-day; render the inclusive end date.
    endDate: endIsoToInclusiveDate(p.endAt),
    type: promoTypeOf(p),
    amount: String(amountFor(p)),
    isActive: p.isActive,
    priority: String(p.priority),
    kind: p.kind,
    code: p.code ?? "",
    maxRedemptions: p.maxRedemptions != null ? String(p.maxRedemptions) : "",
    perCustomerLimit: p.perCustomerLimit != null ? String(p.perCustomerLimit) : "",
    newCustomersOnly: p.newCustomersOnly,
    activeWeekdays: p.activeWeekdays,
    activeFrom: fromMinuteOfDay(p.activeFromMinute),
    activeTo: fromMinuteOfDay(p.activeToMinute),
    minSpend: p.minSpend != null ? String(p.minSpend) : "",
    tiers: [...p.tiers]
      .sort((a, b) => a.minSpend - b.minSpend)
      .map((t) => ({ minSpend: String(t.minSpend), amount: String(tierAmountFor(t, p)) })),
  };
}
