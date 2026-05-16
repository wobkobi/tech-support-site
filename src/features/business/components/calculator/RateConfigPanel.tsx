"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";
import type { RateConfig } from "@/features/business/types/business";

type RateType = "flat" | "hourly" | "modifier";

export interface RateFormState {
  label: string;
  type: RateType;
  amount: string;
  unit: string;
  isDefault: boolean;
}

interface Props {
  rates: RateConfig[];
  form: RateFormState;
  onFormChange: (updater: (prev: RateFormState) => RateFormState) => void;
  editingRateId: string | null;
  resettingRates: boolean;
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onStartEdit: (rate: RateConfig) => void;
  onCancelEdit: () => void;
  onDeleteRate: (id: string) => void;
  onResetRates: () => void;
}

/**
 * Admin-only rate management panel: lists every RateConfig with edit/delete
 * actions, and a form below to create or update one. Used at the top of the
 * calculator when the operator opens the Rate settings toggle. Pure
 * presentational - all state and handlers live in the parent.
 * @param props - Component props.
 * @param props.rates - Full rate list to render in the table.
 * @param props.form - Current form values (label/type/amount/unit/isDefault).
 * @param props.onFormChange - Functional setter for the form state.
 * @param props.editingRateId - When set, the form is in update mode and the matching row is highlighted.
 * @param props.resettingRates - True while a "Reset to defaults" call is in flight.
 * @param props.onSubmit - Form submit handler (creates or updates a rate).
 * @param props.onStartEdit - Click handler for a row's "Edit" button.
 * @param props.onCancelEdit - Click handler for the form's "Cancel" button (only shown in edit mode).
 * @param props.onDeleteRate - Click handler for a row's "Delete" button.
 * @param props.onResetRates - Click handler for the top-right "Reset to defaults" button.
 * @returns Rate config panel element.
 */
export function RateConfigPanel({
  rates,
  form,
  onFormChange,
  editingRateId,
  resettingRates,
  onSubmit,
  onStartEdit,
  onCancelEdit,
  onDeleteRate,
  onResetRates,
}: Props): React.ReactElement {
  return (
    <div className={cn("mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <div className={cn("mb-3 flex items-center justify-between gap-2")}>
        <h2 className={cn("text-russian-violet text-sm font-semibold")}>Rate config</h2>
        <button
          type="button"
          onClick={onResetRates}
          disabled={resettingRates}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
          )}
        >
          {resettingRates ? "Resetting..." : "Reset to defaults"}
        </button>
      </div>
      <table className={cn("mb-4 w-full text-xs")}>
        <thead>
          <tr className={cn("border-b border-slate-100")}>
            {["Label", "Rate", "Unit", "Default", ""].map((h) => (
              <th key={h} className={cn("pb-2 text-left text-xs font-semibold text-slate-400")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cn("divide-y divide-slate-50")}>
          {rates.map((r) => (
            <tr key={r.id} className={cn(editingRateId === r.id ? "bg-russian-violet/5" : "")}>
              <td className={cn("py-1.5 text-slate-700")}>{r.label}</td>
              <td className={cn("py-1.5 text-slate-500")}>
                {r.ratePerHour !== null
                  ? `$${r.ratePerHour}/hr`
                  : r.hourlyDelta !== null
                    ? `${r.hourlyDelta < 0 ? "-" : "+"}$${Math.abs(r.hourlyDelta)}/hr`
                    : r.flatRate !== null
                      ? `$${r.flatRate}`
                      : "-"}
              </td>
              <td className={cn("py-1.5 text-slate-400")}>{r.unit}</td>
              <td className={cn("py-1.5")}>{r.isDefault ? "✓" : ""}</td>
              <td className={cn("flex gap-2 py-1.5")}>
                <button
                  onClick={() => onStartEdit(r)}
                  className={cn("text-slate-400 hover:text-slate-700")}
                >
                  Edit
                </button>
                <button
                  onClick={() => onDeleteRate(r.id)}
                  className={cn("text-red-400 hover:text-red-600")}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        onSubmit={onSubmit}
        className={cn("grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-5")}
      >
        <input
          type="text"
          placeholder="Label"
          required
          value={form.label}
          onChange={(e) => onFormChange((p) => ({ ...p, label: e.target.value }))}
          className={cn(
            "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
          )}
        />
        <select
          value={form.type}
          onChange={(e) =>
            onFormChange((p) => ({
              ...p,
              type: e.target.value as RateType,
            }))
          }
          className={cn(
            "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
          )}
        >
          <option value="hourly">Hourly base</option>
          <option value="modifier">Modifier (+/-)</option>
          <option value="flat">Flat</option>
        </select>
        <input
          type="number"
          placeholder={form.type === "modifier" ? "Delta (+/-)" : "Amount"}
          required
          step="0.01"
          // Modifier rates carry a signed delta added to the base $/hr
          // (e.g. -10 for At home). Flat and hourly rates must be >= 0.
          min={form.type === "modifier" ? undefined : 0}
          value={form.amount}
          onChange={(e) => onFormChange((p) => ({ ...p, amount: e.target.value }))}
          className={cn(
            "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
          )}
        />
        <input
          type="text"
          placeholder="Unit"
          value={form.unit}
          onChange={(e) => onFormChange((p) => ({ ...p, unit: e.target.value }))}
          className={cn(
            "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
          )}
        />
        <div className={cn("flex gap-2")}>
          <button
            type="submit"
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 sm:py-2 sm:text-xs",
            )}
          >
            {editingRateId ? "Update" : "Add"}
          </button>
          {editingRateId && (
            <button
              type="button"
              onClick={onCancelEdit}
              className={cn(
                "rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:py-2 sm:text-xs",
              )}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
