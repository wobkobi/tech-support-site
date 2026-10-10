// src/features/business/components/assets/AssetDisposalFields.tsx
// Disposal section of the asset form: a toggle for sold, given away or no longer used for
// work, then the date and the sale price or market value.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import type { AssetFormState } from "@/features/business/components/assets/asset-form-state";
import { todayISO } from "@/features/business/lib/business-format";
import type React from "react";

/** Props for {@link AssetDisposalFields}. */
interface AssetDisposalFieldsProps {
  /** Current form values. */
  form: AssetFormState;
  /** Form state setter from AssetFormModal. */
  setForm: React.Dispatch<React.SetStateAction<AssetFormState>>;
}

/**
 * Disposal toggle, date and amount.
 * @param props - Component props.
 * @param props.form - Current form values.
 * @param props.setForm - Form state setter.
 * @returns The fields.
 */
export function AssetDisposalFields({
  form,
  setForm,
}: AssetDisposalFieldsProps): React.ReactElement {
  return (
    <fieldset className="space-y-3 border-t border-admin-border pt-4">
      <legend className="sr-only">Disposal</legend>
      <AdminCheckbox
        checked={form.disposed}
        onChange={(v) =>
          setForm((f) => ({
            ...f,
            disposed: v,
            disposedAt: v && f.disposedAt === "" ? todayISO() : f.disposedAt,
          }))
        }
        label="Sold, given away, or no longer used for work"
      />
      {form.disposed && (
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Date" htmlFor="asset-disposed-at" required>
            <AdminInput
              id="asset-disposed-at"
              type="date"
              required
              value={form.disposedAt}
              onChange={(e) => setForm((f) => ({ ...f, disposedAt: e.target.value }))}
            />
          </AdminField>
          <AdminField
            label="Sale price or market value"
            htmlFor="asset-disposal-amount"
            optional
            hint="Leave blank if it was thrown out. Moving it to personal use counts as selling it at market value."
          >
            <AdminInput
              id="asset-disposal-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.disposalAmount}
              onChange={(e) => setForm((f) => ({ ...f, disposalAmount: e.target.value }))}
            />
          </AdminField>
        </div>
      )}
    </fieldset>
  );
}
