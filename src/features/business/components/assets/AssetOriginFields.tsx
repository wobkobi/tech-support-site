// src/features/business/components/assets/AssetOriginFields.tsx
// Where an asset came from and what it's worth: the brought-in / bought choice, the date
// it went into business use, market value and how it was worked out (brought in) or cost,
// supplier and an optional expense link (bought). The cost label says whether to include
// GST, going by the GST registration on the in-service date.

import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import {
  costFieldText,
  withOrigin,
  type AssetFormState,
} from "@/features/business/components/assets/asset-form-state";
import type { ExpenseOption } from "@/features/business/lib/assets";
import type { AssetOrigin, GstStatus } from "@/features/business/lib/tax";
import { formatDollars } from "@/features/business/lib/tax/workings";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** The two origins, as the radio cards show them. */
const ORIGIN_CHOICES: readonly { value: AssetOrigin; label: string; hint: string }[] = [
  {
    value: "introduced",
    label: "Brought in",
    hint: "Something you already owned and started using for work",
  },
  { value: "purchased", label: "Bought", hint: "Bought for the business" },
];

/** Props for {@link AssetOriginFields}. */
interface AssetOriginFieldsProps {
  /** Current form values. */
  form: AssetFormState;
  /** Form state setter from AssetFormModal. */
  setForm: React.Dispatch<React.SetStateAction<AssetFormState>>;
  /** Expenses this asset may link to. */
  expenseOptions: readonly ExpenseOption[];
  /** Low-value write-off threshold, for the supplier hint. */
  lowValueThreshold: number;
  /** GST registration, which sets whether the cost is entered with or without GST. */
  gst: GstStatus;
}

/**
 * Origin, date and value fields.
 * @param props - Component props.
 * @param props.form - Current form values.
 * @param props.setForm - Form state setter.
 * @param props.expenseOptions - Expenses this asset may link to.
 * @param props.lowValueThreshold - Low-value write-off threshold.
 * @param props.gst - GST registration status, for the cost label and hint.
 * @returns The fields.
 */
export function AssetOriginFields({
  form,
  setForm,
  expenseOptions,
  lowValueThreshold,
  gst,
}: AssetOriginFieldsProps): React.ReactElement {
  const introduced = form.origin === "introduced";
  const linkMissing = form.expenseId !== "" && !expenseOptions.some((o) => o.id === form.expenseId);
  const cost = costFieldText(form, gst);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={ADMIN_LABEL_CLS}>Where it came from</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ORIGIN_CHOICES.map((c) => (
            <label
              key={c.value}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                form.origin === c.value
                  ? "border-russian-violet bg-admin-bg"
                  : "border-admin-border-strong bg-admin-surface",
              )}
            >
              <input
                type="radio"
                name="asset-origin"
                value={c.value}
                checked={form.origin === c.value}
                onChange={() => setForm((f) => withOrigin(f, c.value))}
                className="mt-0.5 h-4 w-4 accent-russian-violet"
              />
              <span>
                <span className="block font-bold text-admin-text">{c.label}</span>
                <span className="text-admin-muted">{c.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          label={introduced ? "Date brought into the business" : "Date first used for work"}
          htmlFor="asset-date"
          required
          hint="Depreciation starts from this month."
        >
          <AdminInput
            id="asset-date"
            type="date"
            required
            value={form.inServiceDate}
            onChange={(e) => setForm((f) => ({ ...f, inServiceDate: e.target.value }))}
          />
        </AdminField>
        <AdminField label={cost.label} htmlFor="asset-cost" required hint={cost.hint}>
          <AdminInput
            id="asset-cost"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={form.costBase}
            onChange={(e) => setForm((f) => ({ ...f, costBase: e.target.value }))}
          />
        </AdminField>

        {introduced ? (
          <AdminField
            label="How you worked out the value"
            htmlFor="asset-valuation"
            optional
            className="sm:col-span-2"
            hint="IRD can ask. For example: three sold Trade Me listings for the same model."
          >
            <AdminTextarea
              id="asset-valuation"
              rows={2}
              maxLength={1000}
              value={form.valuationNote}
              onChange={(e) => setForm((f) => ({ ...f, valuationNote: e.target.value }))}
            />
          </AdminField>
        ) : (
          <>
            <AdminField
              label="Supplier"
              htmlFor="asset-supplier"
              optional
              hint={`Items from one supplier on one day are added together for the ${formatDollars(lowValueThreshold)} write-off limit.`}
            >
              <AdminInput
                id="asset-supplier"
                maxLength={120}
                value={form.supplier}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              />
            </AdminField>
            <AdminField
              label="Linked expense"
              htmlFor="asset-expense"
              optional
              hint="A linked expense is depreciated here instead of claimed in one go."
            >
              <AdminSelect
                id="asset-expense"
                value={form.expenseId}
                onChange={(e) => setForm((f) => ({ ...f, expenseId: e.target.value }))}
              >
                <option value="">Not linked</option>
                {linkMissing && (
                  <option value={form.expenseId}>Linked expense no longer exists</option>
                )}
                {expenseOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>
          </>
        )}
      </div>
    </div>
  );
}
