// src/features/business/components/assets/AssetClassFields.tsx
// How an asset is depreciated: the IR265 class picker (which fills in the rate for the
// chosen method), method, rate, business-use share, the kilometre-rate option for the
// motor vehicle class, and Investment Boost for brand-new bought items.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import {
  CLASS_GROUPS,
  CUSTOM_CLASS_KEY,
  classOptionLabel,
  withClass,
  withMethod,
  type AssetFormState,
} from "@/features/business/components/assets/asset-form-state";
import { isVehicleClass } from "@/features/business/lib/assets";
import type React from "react";

/** Props for {@link AssetClassFields}. */
interface AssetClassFieldsProps {
  /** Current form values. */
  form: AssetFormState;
  /** Form state setter from AssetFormModal. */
  setForm: React.Dispatch<React.SetStateAction<AssetFormState>>;
}

/**
 * Class, method, rate, business use, km rates and Investment Boost.
 * @param props - Component props.
 * @param props.form - Current form values.
 * @param props.setForm - Form state setter.
 * @returns The fields.
 */
export function AssetClassFields({ form, setForm }: AssetClassFieldsProps): React.ReactElement {
  const vehicle = isVehicleClass(form.classKey);
  const custom = form.classKey === CUSTOM_CLASS_KEY;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AdminField
        label="Asset class"
        htmlFor="asset-class"
        required
        className="sm:col-span-2"
        hint={
          custom ? (
            <>
              Look the rate up with{" "}
              <a
                href="https://www.ird.govt.nz/rate-finder"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-russian-violet underline"
              >
                IRD&apos;s rate finder
              </a>
              .
            </>
          ) : (
            "From IRD's depreciation rates (IR265). Picking one fills in the rate."
          )
        }
      >
        <AdminSelect
          id="asset-class"
          required
          value={form.classKey}
          onChange={(e) => setForm((f) => withClass(f, e.target.value))}
        >
          <option value="" disabled>
            Pick a class
          </option>
          {CLASS_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.classes.map((c) => (
                <option key={c.key} value={c.key}>
                  {classOptionLabel(c)}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM_CLASS_KEY}>Something else (enter the rate)</option>
        </AdminSelect>
      </AdminField>

      {vehicle && (
        <div className="sm:col-span-2">
          <AdminCheckbox
            checked={form.kmVehicle}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                kmVehicle: v,
                investmentBoost: v ? false : f.investmentBoost,
              }))
            }
            label="Claim this vehicle on IRD kilometre rates"
          />
          <p className="mt-1 text-sm text-admin-muted">
            The kilometre rate covers fuel, wear and depreciation, so the vehicle isn&apos;t
            depreciated and Fuel expenses stop counting while it&apos;s in use.
          </p>
        </div>
      )}

      <AdminField
        label="Method"
        htmlFor="asset-method"
        hint="Diminishing value claims more in the early years; straight line claims the same each year."
      >
        <AdminSelect
          id="asset-method"
          value={form.method}
          disabled={form.kmVehicle}
          onChange={(e) => setForm((f) => withMethod(f, e.target.value === "SL" ? "SL" : "DV"))}
        >
          <option value="DV">Diminishing value (DV)</option>
          <option value="SL">Straight line (SL)</option>
        </AdminSelect>
      </AdminField>
      <AdminField
        label="Rate per year (%)"
        htmlFor="asset-rate"
        required
        hint={
          custom
            ? "Use the rate IRD gives for the item."
            : "Filled in from the class. Only change it if IRD gives this item a different rate."
        }
      >
        <AdminInput
          id="asset-rate"
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="any"
          value={form.ratePct}
          disabled={form.kmVehicle}
          onChange={(e) => setForm((f) => ({ ...f, ratePct: e.target.value }))}
        />
      </AdminField>
      <AdminField
        label="Business use (%)"
        htmlFor="asset-business"
        required
        className="sm:col-span-2"
        hint="The share of its use that's for work. Only this share is claimed."
      >
        <AdminInput
          id="asset-business"
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          step="any"
          value={form.businessUsePct}
          onChange={(e) => setForm((f) => ({ ...f, businessUsePct: e.target.value }))}
        />
      </AdminField>

      {form.origin === "purchased" && !form.kmVehicle && (
        <div className="sm:col-span-2">
          <AdminCheckbox
            checked={form.investmentBoost}
            onChange={(v) => setForm((f) => ({ ...f, investmentBoost: v }))}
            label="Investment Boost (brand-new item)"
          />
          <p className="mt-1 text-sm text-admin-muted">
            Claims 20% of the cost in the first year on top of normal depreciation. Only for
            brand-new items first used in the business on or after 22 May 2025. Not for second-hand
            items.
          </p>
        </div>
      )}
    </div>
  );
}
