// src/features/business/components/assets/asset-form-state.ts
// Field state for AssetFormModal: the string values the inputs bind to, how a form is
// filled (blank, from a saved asset, from an expense) and how it becomes the JSON body
// the assets API validates. Rates show as percentages here and travel as fractions.
// Also the cost field's label and hint, which say whether to enter it with or without GST.
// Pure: no React, so scripts/check-assets.ts can round-trip it through parseAssetBody.

import {
  defaultRate,
  isVehicleClass,
  parseLedgerDay,
  type AssetPrefill,
  type AssetView,
} from "@/features/business/lib/assets";
import { todayISO } from "@/features/business/lib/business-format";
import {
  ASSET_CLASSES,
  isGstRegisteredOn,
  type AssetClass,
  type AssetOrigin,
  type DepreciationMethod,
  type GstStatus,
} from "@/features/business/lib/tax";

/** Class key stored when the operator types a rate instead of picking an IR265 class. */
export const CUSTOM_CLASS_KEY = "custom";

/** What the form dialog works on: a new asset (maybe filled from an expense) or a saved one. */
export type AssetFormTarget =
  { mode: "new"; prefill: AssetPrefill | null } | { mode: "edit"; asset: AssetView };

/** Every form field as its input holds it. */
export interface AssetFormState {
  name: string;
  /** "" until picked; {@link CUSTOM_CLASS_KEY} for a typed rate. */
  classKey: string;
  origin: AssetOrigin;
  /** YYYY-MM-DD. */
  inServiceDate: string;
  costBase: string;
  supplier: string;
  valuationNote: string;
  method: DepreciationMethod;
  /** Rate as a percentage, e.g. "50". */
  ratePct: string;
  businessUsePct: string;
  investmentBoost: boolean;
  kmVehicle: boolean;
  /** "" = not linked. */
  expenseId: string;
  disposed: boolean;
  disposedAt: string;
  disposalAmount: string;
  notes: string;
}

/** IR265 classes under one heading, for the picker's optgroups. */
export interface ClassGroup {
  group: string;
  classes: AssetClass[];
}

/**
 * Groups classes by their `group`, keeping the table's order.
 * @param classes - Classes to group.
 * @returns One entry per group, in first-seen order.
 */
export function groupClasses(classes: readonly AssetClass[]): ClassGroup[] {
  const out: ClassGroup[] = [];
  for (const c of classes) {
    const existing = out.find((g) => g.group === c.group);
    if (existing) existing.classes.push(c);
    else out.push({ group: c.group, classes: [c] });
  }
  return out;
}

/** {@link ASSET_CLASSES} grouped once for the picker. */
export const CLASS_GROUPS: readonly ClassGroup[] = groupClasses(ASSET_CLASSES);

/**
 * A fraction as the percentage string the rate input shows, without float noise.
 * @param rate - Fraction, e.g. 0.105.
 * @returns Percentage text, e.g. "10.5".
 */
export function toPctString(rate: number): string {
  return String(Math.round(rate * 10000) / 100);
}

/**
 * Picker label for a class: its name with both IR265 rates.
 * @param c - The class.
 * @returns e.g. "Laptops (DV 50%, SL 40%)".
 */
export function classOptionLabel(c: AssetClass): string {
  return `${c.label} (DV ${toPctString(c.dv)}%, SL ${toPctString(c.sl)}%)`;
}

/**
 * Blank form for a new asset: brought in (the common case for the first entries), fully
 * business use, diminishing value.
 * @returns The form.
 */
export function emptyAssetForm(): AssetFormState {
  return {
    name: "",
    classKey: "",
    origin: "introduced",
    inServiceDate: todayISO(),
    costBase: "",
    supplier: "",
    valuationNote: "",
    method: "DV",
    ratePct: "",
    businessUsePct: "100",
    investmentBoost: false,
    kmVehicle: false,
    expenseId: "",
    disposed: false,
    disposedAt: "",
    disposalAmount: "",
    notes: "",
  };
}

/**
 * A saved asset loaded into the form.
 * @param a - The asset.
 * @returns The form.
 */
export function formFromAsset(a: AssetView): AssetFormState {
  return {
    name: a.name,
    classKey: a.classKey,
    origin: a.origin,
    inServiceDate: a.inServiceDate,
    costBase: String(a.costBase),
    supplier: a.supplier ?? "",
    valuationNote: a.valuationNote ?? "",
    method: a.method,
    ratePct: toPctString(a.rate),
    businessUsePct: String(a.businessUsePct),
    investmentBoost: a.investmentBoost,
    kmVehicle: a.vehicleMethod === "km",
    expenseId: a.expenseId ?? "",
    disposed: a.disposedAt !== null,
    disposedAt: a.disposedAt ?? "",
    disposalAmount: a.disposalAmount === null ? "" : String(a.disposalAmount),
    notes: a.notes ?? "",
  };
}

/**
 * A new bought asset filled in from an expense; the class is left for the operator.
 * @param p - Values from the expense.
 * @returns The form.
 */
export function formFromPrefill(p: AssetPrefill): AssetFormState {
  return {
    ...emptyAssetForm(),
    name: p.name,
    origin: "purchased",
    inServiceDate: p.inServiceDate,
    costBase: String(p.costBase),
    supplier: p.supplier,
    expenseId: p.expenseId,
  };
}

/**
 * The form a dialog opens with.
 * @param target - What the dialog works on.
 * @returns The starting form.
 */
export function initialForm(target: AssetFormTarget): AssetFormState {
  if (target.mode === "edit") return formFromAsset(target.asset);
  return target.prefill ? formFromPrefill(target.prefill) : emptyAssetForm();
}

/**
 * Switches the class. A listed class fills in its rate for the current method; an
 * unlisted one keeps whatever rate was typed; leaving the vehicle class drops km rates.
 * @param f - Current form.
 * @param classKey - New class key.
 * @returns The updated form.
 */
export function withClass(f: AssetFormState, classKey: string): AssetFormState {
  const rate = defaultRate(classKey, f.method);
  return {
    ...f,
    classKey,
    kmVehicle: f.kmVehicle && isVehicleClass(classKey),
    ratePct: rate === null ? f.ratePct : toPctString(rate),
  };
}

/**
 * Switches DV/SL, refilling the rate from the table when the class is listed.
 * @param f - Current form.
 * @param method - New method.
 * @returns The updated form.
 */
export function withMethod(f: AssetFormState, method: DepreciationMethod): AssetFormState {
  const rate = defaultRate(f.classKey, method);
  return { ...f, method, ratePct: rate === null ? f.ratePct : toPctString(rate) };
}

/**
 * Switches between brought in and bought. Brought-in items can't carry an expense link
 * or Investment Boost, so both clear.
 * @param f - Current form.
 * @param origin - New origin.
 * @returns The updated form.
 */
export function withOrigin(f: AssetFormState, origin: AssetOrigin): AssetFormState {
  return origin === "purchased"
    ? { ...f, origin }
    : { ...f, origin, investmentBoost: false, expenseId: "" };
}

/**
 * The JSON body for POST/PUT /api/business/assets. Fields the current origin, vehicle
 * option or disposal toggle hides are sent blank so a hidden value never saves.
 * @param f - The form.
 * @returns The request body.
 */
export function formToBody(f: AssetFormState): Record<string, unknown> {
  const rate = f.ratePct.trim();
  return {
    name: f.name,
    classKey: f.classKey,
    origin: f.origin,
    inServiceDate: f.inServiceDate,
    costBase: f.costBase,
    supplier: f.origin === "purchased" ? f.supplier : "",
    valuationNote: f.origin === "introduced" ? f.valuationNote : "",
    method: f.method,
    // Sent as a string so an unreadable entry reaches the API as "NaN" and is refused,
    // rather than serialising to null and quietly taking the class rate.
    rate: rate === "" ? "" : String(Number(rate) / 100),
    businessUsePct: f.businessUsePct,
    investmentBoost: f.origin === "purchased" && !f.kmVehicle && f.investmentBoost,
    vehicleMethod: f.kmVehicle && isVehicleClass(f.classKey) ? "km" : "",
    expenseId: f.origin === "purchased" ? f.expenseId : "",
    disposedAt: f.disposed ? f.disposedAt : "",
    disposalAmount: f.disposed ? f.disposalAmount : "",
    notes: f.notes,
  };
}

/** Label and hint for the cost (or market value) input. */
export interface CostFieldText {
  /** "Cost (incl. GST)", "Cost (excl. GST)" or "Market value on that date". */
  label: string;
  /** What to enter, and why GST is in or out. */
  hint: string;
  /** True when the figure should include GST. */
  gstInclusive: boolean;
}

/**
 * Label and hint for the cost input. The figure is entered on the GST basis for the
 * in-service date: GST-inclusive while not registered on that day (the GST is part of
 * the cost), exclusive from the registration date (the GST is claimed back). The maths
 * takes costBase as entered, so this label is the only place the GST decision is made.
 * A brought-in item's label carries no GST suffix; its hint says whether to take GST off.
 * A date that isn't a full YYYY-MM-DD yet (mid-typing, or cleared) reads as today.
 * @param f - The form's origin and in-service date.
 * @param f.origin - Brought in (market value) or bought (cost).
 * @param f.inServiceDate - YYYY-MM-DD, possibly incomplete.
 * @param gst - GST registration status (loadGstStatus on the server).
 * @returns The label, hint and which side of GST the figure is on.
 */
export function costFieldText(
  f: Pick<AssetFormState, "origin" | "inServiceDate">,
  gst: GstStatus,
): CostFieldText {
  const day = parseLedgerDay(f.inServiceDate) ?? parseLedgerDay(todayISO()) ?? new Date();
  const gstInclusive = !isGstRegisteredOn(day, gst);
  if (f.origin === "introduced") {
    // A second-hand market value has no GST line to strip, so the label stays plain and
    // only the hint changes: GST comes off only when it is claimed back in a return.
    return {
      label: "Market value on that date",
      hint: gstInclusive
        ? "What it would have sold for second-hand that day. Don't add GST."
        : "What it would have sold for second-hand that day. If you claim GST back on it in a GST return, enter the value less that GST.",
      gstInclusive,
    };
  }
  return {
    label: gstInclusive ? "Cost (incl. GST)" : "Cost (excl. GST)",
    hint: gstInclusive
      ? "What you paid, including GST. You weren't GST-registered on that date, so the GST is part of the cost."
      : "What you paid, less GST. You were GST-registered on that date, so the GST is claimed back in your GST return instead.",
    gstInclusive,
  };
}
