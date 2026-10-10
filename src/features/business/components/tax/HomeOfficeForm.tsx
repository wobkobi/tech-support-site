"use client";
// src/features/business/components/tax/HomeOfficeForm.tsx
// Home office, IRD rate and car total km inputs for one financial year. Saves through
// PUT /api/business/tax-years/[fyKey], then refreshes the server page so the estimate
// recomputes. A filed year shows the values read-only.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { FieldError } from "@/features/admin/components/ui/FieldError";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD } from "@/features/business/lib/business";
import { KM_TIER1_LIMIT } from "@/features/business/lib/tax/vehicle";
import { formatKm } from "@/features/business/lib/trips";
import { Notice } from "@/shared/components/Notice";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** The TaxYear fields this form edits. Null = not entered (the rates then use IRD's figure). */
export interface TaxYearFormValues {
  officeSqm: number | null;
  houseSqm: number | null;
  sqmRate: number | null;
  kmTier1: number | null;
  kmTier2: number | null;
  /** Every km the car travelled in the FY, business and private. */
  totalVehicleKm: number | null;
  mortgageInterestOrRent: number | null;
  rates: number | null;
}

type FieldKey = keyof TaxYearFormValues;
type Draft = Record<FieldKey, string>;
type FieldErrors = Partial<Record<FieldKey, string>>;

/** IRD's published rates for the year, shown as hints and placeholders. */
interface RateDefaults {
  sqmRate: number;
  kmTier1: number;
  kmTier2: number;
}

/** One input: its key, label, help line and placeholder. */
interface FieldSpec {
  key: FieldKey;
  label: string;
  hint?: string;
  placeholder?: string;
}

/** Props for {@link HomeOfficeForm}. */
interface HomeOfficeFormProps {
  fyKey: string;
  fyLabel: string;
  filed: boolean;
  initial: TaxYearFormValues;
  defaults: RateDefaults;
  fuel: string;
  claim: { officePct: number; sqmPart: number; proportionalPart: number; amount: number };
  /** Business km the FY's km claim counts, for the total km sanity check. */
  businessKm: number;
}

/** The Tier 1 km limit as the hint prints it, e.g. "14,000". */
const TIER1_KM = KM_TIER1_LIMIT.toLocaleString("en-NZ");

/** Every editable key, in the order the draft and the parser walk them. */
const FIELD_KEYS: readonly FieldKey[] = [
  "officeSqm",
  "houseSqm",
  "mortgageInterestOrRent",
  "rates",
  "sqmRate",
  "kmTier1",
  "kmTier2",
  "totalVehicleKm",
];

/**
 * Draft strings for the inputs: blank for a value that isn't set.
 * @param values - Saved values.
 * @returns Input text per field.
 */
function toDraft(values: TaxYearFormValues): Draft {
  const draft = {} as Draft;
  for (const key of FIELD_KEYS) {
    const value = values[key];
    draft[key] = value === null ? "" : String(value);
  }
  return draft;
}

/**
 * Parses the inputs. A blank field becomes null; anything that isn't a number of 0 or
 * more is an error, and the car's total km must be above 0 (blank means "not known").
 * The route checks the same rules.
 * @param draft - Input text per field.
 * @returns Parsed values and any field errors.
 */
function parseDraft(draft: Draft): { values: TaxYearFormValues; errors: FieldErrors } {
  const values = {} as TaxYearFormValues;
  const errors: FieldErrors = {};
  for (const key of FIELD_KEYS) {
    const raw = draft[key].trim();
    values[key] = null;
    if (raw === "") continue;
    const n = Number(raw);
    if (key === "totalVehicleKm" && (!Number.isFinite(n) || n <= 0)) {
      errors[key] = "Enter the car's total km, or leave it blank.";
      continue;
    }
    if (!Number.isFinite(n) || n < 0) {
      errors[key] = "Enter a number of 0 or more, or leave it blank.";
      continue;
    }
    values[key] = n;
  }
  if (values.officeSqm !== null && values.houseSqm !== null && values.officeSqm > values.houseSqm) {
    errors.officeSqm = "The office can't be bigger than the house.";
  }
  return { values, errors };
}

/**
 * The fields whose parsed value differs from what this tab last saw saved. Sending only
 * these keeps a stale tab from clearing a value another tab has saved since.
 * @param values - Parsed form values.
 * @param baseline - Values as last loaded or saved in this tab.
 * @returns Changed fields only (empty when nothing changed).
 */
function changedFields(
  values: TaxYearFormValues,
  baseline: TaxYearFormValues,
): Partial<TaxYearFormValues> {
  const changed: Partial<TaxYearFormValues> = {};
  for (const key of FIELD_KEYS) {
    if (values[key] !== baseline[key]) changed[key] = values[key];
  }
  return changed;
}

/**
 * Warning for a total km entry below the business km already logged. It doesn't block
 * the save: the km claim treats such a total as missing, so the save is harmless but
 * the figure is almost certainly a typo.
 * @param raw - Total km input text.
 * @param businessKm - Business km the FY's claim counts.
 * @returns Warning text, or undefined when the entry is blank, invalid or plausible.
 */
function totalKmWarning(raw: string, businessKm: number): string | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n >= businessKm) return undefined;
  return `That's less than the ${formatKm(businessKm)} of business trips logged this year, so it isn't used to split your km between the two rates. Check the odometer readings.`;
}

/**
 * Home office inputs, ending with the year's square-metre rate.
 * @param defaults - IRD's rates for the year.
 * @returns Field specs.
 */
function homeFields(defaults: RateDefaults): FieldSpec[] {
  return [
    {
      key: "officeSqm",
      label: "Office floor area (m²)",
      hint: "The space set aside mainly for the business.",
    },
    { key: "houseSqm", label: "Whole house floor area (m²)" },
    {
      key: "mortgageInterestOrRent",
      label: "Mortgage interest or rent for the year ($)",
      hint: "For the whole house. The office's share is claimed.",
    },
    { key: "rates", label: "Council rates for the year ($)", hint: "For the whole house." },
    {
      key: "sqmRate",
      label: "Square-metre rate ($/m²)",
      hint: `Leave blank for IRD's rate: ${formatNZD(defaults.sqmRate)}`,
      placeholder: String(defaults.sqmRate),
    },
  ];
}

/**
 * Car inputs: the year's two kilometre rates, then its total km, which sets the
 * business share of Tier 1.
 * @param defaults - IRD's rates for the year.
 * @param fuel - Readable fuel type, e.g. "petrol".
 * @returns Field specs.
 */
function carFields(defaults: RateDefaults, fuel: string): FieldSpec[] {
  return [
    {
      key: "kmTier1",
      label: "Kilometre rate, Tier 1 ($/km)",
      hint: `Leave blank for IRD's ${fuel} rate: ${formatNZD(defaults.kmTier1)}`,
      placeholder: String(defaults.kmTier1),
    },
    {
      key: "kmTier2",
      label: "Kilometre rate, Tier 2 ($/km)",
      hint: `Leave blank for IRD's ${fuel} rate: ${formatNZD(defaults.kmTier2)}`,
      placeholder: String(defaults.kmTier2),
    },
    {
      key: "totalVehicleKm",
      label: "Total km the car travelled this year (odometer)",
      hint: `Business and private km together. If it's over ${TIER1_KM} km, Tier 1 covers only your business share of the first ${TIER1_KM}.`,
    },
  ];
}

/**
 * Home office form card.
 * @param props - Component props.
 * @param props.fyKey - FY key the record belongs to, e.g. "2026-27".
 * @param props.fyLabel - FY display label.
 * @param props.filed - True when the year is filed (inputs locked).
 * @param props.initial - Saved values (null = not set).
 * @param props.defaults - IRD's published rates for the year.
 * @param props.fuel - Readable vehicle fuel type for the km rate hints.
 * @param props.claim - Home office claim the estimate worked out from the saved values.
 * @param props.businessKm - Business km the FY's km claim counts.
 * @returns The card.
 */
export function HomeOfficeForm({
  fyKey,
  fyLabel,
  filed,
  initial,
  defaults,
  fuel,
  claim,
  businessKm,
}: HomeOfficeFormProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  // What this tab last saw saved; only fields that differ from it are sent.
  const [baseline, setBaseline] = useState<TaxYearFormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  /**
   * Updates one input's draft text.
   * @param key - Field being edited.
   * @param value - New input text.
   */
  function setField(key: FieldKey, value: string): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Validates, saves the changed fields, then refreshes the page so every figure
   * recomputes.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const { values, errors: nextErrors } = parseDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const changed = changedFields(values, baseline);
    if (Object.keys(changed).length === 0) {
      toast("Nothing to save. These figures match what's saved.", { tone: "info" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/business/tax-years/${encodeURIComponent(fyKey)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.status === 409) {
        // Filed from another tab since this page loaded; a reload shows the locked year.
        toast("This year has been marked as filed. Reload the page to see it.", {
          tone: "error",
        });
        return;
      }
      if (!res.ok || !data?.ok) {
        toast(data?.error ?? "Couldn't save this year's figures.", { tone: "error" });
        return;
      }
      setBaseline(values);
      toast("Saved. The estimate is updated.", { tone: "success" });
      router.refresh();
    } catch {
      toast("Couldn't reach the server. Check the connection and try again.", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  /**
   * One labelled number input, with an optional non-blocking warning under it.
   * @param spec - Field spec.
   * @param warning - Warning text, shown when the field has no error.
   * @returns The field.
   */
  function renderField(spec: FieldSpec, warning?: string): React.ReactElement {
    const id = `tax-${spec.key}`;
    const errorId = `${id}-error`;
    const warningId = `${id}-warning`;
    const error = errors[spec.key];
    const showWarning = !error && warning !== undefined;
    const describedBy = error ? errorId : showWarning ? warningId : undefined;
    return (
      <AdminField key={spec.key} label={spec.label} htmlFor={id} optional hint={spec.hint}>
        <AdminInput
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={draft[spec.key]}
          placeholder={spec.placeholder}
          disabled={filed || saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => setField(spec.key, e.target.value)}
        />
        <FieldError id={errorId} message={error} />
        {showWarning && (
          <p id={warningId} className="mt-1 text-sm text-amber-800">
            {warning}
          </p>
        )}
      </AdminField>
    );
  }

  const officePct = `${Number((claim.officePct * 100).toFixed(1))}%`;
  const kmWarning = totalKmWarning(draft.totalVehicleKm, businessKm);

  return (
    <Card>
      <CardHeader
        title="Home office and car"
        description={`${fyLabel}. The office is claimed on IRD's square-metre rate, plus its share of mortgage interest or rent and rates. The car is claimed on IRD's kilometre rates.`}
      />
      {filed && (
        <Notice tone="info" className="mb-4">
          This year is filed, so these figures are locked.
        </Notice>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <p className="mb-5 text-sm text-admin-muted">
          Leave a rate blank to use IRD's published rate. Fill it in when IRD publishes this year's
          figures, or when your accountant gives you a different rate.
        </p>
        <h3 className="mb-3 text-base font-semibold text-admin-text">Home office</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {homeFields(defaults).map((spec) => renderField(spec))}
        </div>

        <div className="mt-5 rounded-md bg-admin-bg px-4 py-3">
          <p className="text-[0.9375rem] font-semibold text-admin-text">
            Home office claim: {formatNZD(claim.amount)}
          </p>
          <p className="mt-0.5 text-sm text-admin-text-secondary">
            {claim.amount > 0
              ? `The office is ${officePct} of the house: ${formatNZD(claim.sqmPart)} from the square-metre rate plus ${formatNZD(claim.proportionalPart)} of interest or rent and rates.`
              : "Enter the office and house floor areas to work out the claim."}
          </p>
        </div>

        <h3 className="mt-6 mb-3 text-base font-semibold text-admin-text">Car</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {carFields(defaults, fuel).map((spec) =>
            renderField(spec, spec.key === "totalVehicleKm" ? kmWarning : undefined),
          )}
        </div>

        {!filed && (
          <div className="mt-5">
            <AdminButton type="submit" busy={saving}>
              Save
            </AdminButton>
          </div>
        )}
      </form>
    </Card>
  );
}
