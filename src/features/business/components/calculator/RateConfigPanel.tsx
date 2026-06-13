"use client";

import type { RateConfig } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCheck } from "react-icons/fa6";

type RateType = "flat" | "hourly" | "modifier" | "percent";

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
 * Admin-only rate management panel: lists every {@link RateConfig} with
 * edit/delete actions, and a form below to create or update one. Pure
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
        <h2 className={cn("text-sm font-semibold text-russian-violet")}>Rate config</h2>
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
      {/* Mobile: stacked rate cards - five columns are too dense for phones. */}
      <div className={cn("mb-4 space-y-2 lg:hidden")}>
        {rates.map((r) => (
          <div
            key={r.id}
            className={cn(
              "rounded-lg border border-slate-200 p-3",
              editingRateId === r.id ? "bg-russian-violet/5" : "bg-white",
            )}
          >
            <div className={cn("flex items-start justify-between gap-2")}>
              <div className={cn("min-w-0 flex-1")}>
                <p className={cn("flex items-center gap-1.5 text-sm font-semibold text-slate-700")}>
                  <span className={cn("truncate")}>{r.label}</span>
                  {r.isDefault && (
                    <FaCheck
                      className={cn("h-3 w-3 shrink-0 text-emerald-600")}
                      aria-label="Default"
                    />
                  )}
                </p>
                <p className={cn("text-xs text-slate-500")}>
                  {r.ratePerHour !== null
                    ? `$${r.ratePerHour}/hr`
                    : r.hourlyDelta !== null
                      ? `${r.hourlyDelta < 0 ? "-" : "+"}$${Math.abs(r.hourlyDelta)}/hr`
                      : r.flatRate !== null
                        ? `$${r.flatRate}`
                        : r.percentDelta !== null
                          ? `${r.percentDelta < 0 ? "-" : "+"}${Math.round(r.percentDelta * 100)}%`
                          : "-"}
                  {r.unit && <span className={cn("ml-2 text-slate-400")}>{r.unit}</span>}
                </p>
              </div>
              <div className={cn("flex shrink-0 gap-2 text-xs")}>
                <button
                  onClick={() => onStartEdit(r)}
                  className={cn("inline-flex h-8 items-center text-slate-500 hover:text-slate-700")}
                >
                  Edit
                </button>
                <button
                  onClick={() => onDeleteRate(r.id)}
                  className={cn("inline-flex h-8 items-center text-red-400 hover:text-red-600")}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <table className={cn("mb-4 hidden w-full text-xs lg:table")}>
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
                      : r.percentDelta !== null
                        ? `${r.percentDelta < 0 ? "-" : "+"}${Math.round(r.percentDelta * 100)}%`
                        : "-"}
              </td>
              <td className={cn("py-1.5 text-slate-400")}>{r.unit}</td>
              <td className={cn("py-1.5")}>
                {r.isDefault ? <FaCheck className={cn("h-3 w-3")} aria-hidden /> : null}
              </td>
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
            "rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:py-2 sm:text-xs",
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
            "rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:py-2 sm:text-xs",
          )}
        >
          <option value="hourly">Hourly base</option>
          <option value="modifier">Modifier ($)</option>
          <option value="percent">Modifier (%)</option>
          <option value="flat">Flat</option>
        </select>
        <input
          type="number"
          placeholder={
            form.type === "modifier"
              ? "Delta $ (+/-)"
              : form.type === "percent"
                ? "Percent (+/-)"
                : "Amount"
          }
          required
          step="0.01"
          // Modifier rates carry a signed delta ($ or %) applied to the base
          // (e.g. -10 for At home, +25 for a holiday). Flat/hourly must be >= 0.
          min={form.type === "modifier" || form.type === "percent" ? undefined : 0}
          value={form.amount}
          onChange={(e) => onFormChange((p) => ({ ...p, amount: e.target.value }))}
          className={cn(
            "rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:py-2 sm:text-xs",
          )}
        />
        <input
          type="text"
          placeholder="Unit"
          value={form.unit}
          onChange={(e) => onFormChange((p) => ({ ...p, unit: e.target.value }))}
          className={cn(
            "rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:py-2 sm:text-xs",
          )}
        />
        <div className={cn("flex gap-2")}>
          <button
            type="submit"
            className={cn(
              "rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 sm:py-2 sm:text-xs",
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
