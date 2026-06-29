"use client";
// src/features/business/components/ExpensesView.tsx
/**
 * @description Records and lists expense entries against /api/business/expenses,
 * with a GST-from-inclusive preview and running excl/GST totals.
 */

import { calcGstFromInclusive, formatNZD, todayISO } from "@/features/business/lib/business";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/features/business/lib/constants";
import type { ExpenseEntry } from "@/features/business/types/business";
import { Button } from "@/shared/components/Button";
import { Field } from "@/shared/components/Field";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useState } from "react";

const inputClasses = cn(
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm",
  "focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
);

/**
 * Client component for recording and displaying expense entries.
 * @returns Expenses view element
 */
export function ExpensesView(): React.ReactElement {
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    date: todayISO(),
    supplier: "",
    description: "",
    category: "Other",
    amountIncl: "",
    gstRate: "0.15",
    method: "Business Account",
    receipt: false,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = {};

  useEffect(() => {
    fetch("/api/business/expenses", { headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEntries(d.entries);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalExcl = entries.reduce((s, e) => s + e.amountExcl, 0);
  const totalGst = entries.reduce((s, e) => s + e.gstAmount, 0);

  const inclNum = parseFloat(form.amountIncl) || 0;
  const rate = parseFloat(form.gstRate) || 0;
  const previewGst = calcGstFromInclusive(inclNum, rate);

  /**
   * Submits the add-expense form and prepends the new entry to the list.
   * @param e - Form submit event
   */
  async function handleAdd(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/business/expenses", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...form, amountIncl: inclNum, gstRate: rate }),
    });
    const d = await res.json();
    if (d.ok) {
      setEntries((prev) => [d.entry, ...prev]);
      setForm({
        date: todayISO(),
        supplier: "",
        description: "",
        category: "Other",
        amountIncl: "",
        gstRate: "0.15",
        method: "Business Account",
        receipt: false,
        notes: "",
      });
    } else {
      setError(d.error ?? "Failed to save");
    }
    setSaving(false);
  }

  /**
   * Deletes an expense entry after confirmation.
   * @param id - ID of the expense entry to delete
   */
  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this expense?")) return;
    const res = await fetch(`/api/business/expenses/${id}`, { method: "DELETE", headers });
    if ((await res.json()).ok) setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      {/* Totals bar - stacks on mobile so three values stay readable below ~480px. */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            label: "Total expenses (excl. GST)",
            value: formatNZD(totalExcl),
            color: "text-slate-700",
          },
          { label: "GST claimable", value: formatNZD(totalGst), color: "text-moonstone-600" },
          { label: "Entries", value: String(entries.length), color: "text-slate-500" },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className={cn("text-xl font-extrabold", c.color)}>{c.value}</p>
            <p className="text-xs text-slate-500">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-4 text-sm font-semibold text-russian-violet">Add expense</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="exp-date" required>
            <input
              id="exp-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Supplier" htmlFor="exp-supplier" required>
            <input
              id="exp-supplier"
              type="text"
              required
              value={form.supplier}
              onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Description" htmlFor="exp-description" required>
            <input
              id="exp-description"
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Category" htmlFor="exp-category">
            <select
              id="exp-category"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className={inputClasses}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Amount incl. GST" htmlFor="exp-amount" required>
            <input
              id="exp-amount"
              type="number"
              required
              min="0"
              step="0.01"
              value={form.amountIncl}
              onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="GST rate" htmlFor="exp-gst">
            <select
              id="exp-gst"
              value={form.gstRate}
              onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
              className={inputClasses}
            >
              <option value="0.15">15%</option>
              <option value="0">0% (no GST)</option>
            </select>
            {inclNum > 0 && rate > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                GST: {formatNZD(previewGst)} | Excl: {formatNZD(inclNum - previewGst)}
              </p>
            )}
          </Field>
          <Field label="Payment method" htmlFor="exp-method">
            <select
              id="exp-method"
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
              className={inputClasses}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="exp-notes" optional>
            <input
              id="exp-notes"
              type="text"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="receipt"
              checked={form.receipt}
              onChange={(e) => setForm((p) => ({ ...p, receipt: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label htmlFor="receipt" className="text-sm text-slate-600">
              Receipt held
            </label>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <Button type="submit" variant="secondary" size="sm" disabled={saving} className="mt-4">
          {saving ? "Saving..." : "Add expense"}
        </Button>
      </form>

      {/* Mobile card list - stacks each entry; below lg the table overflows. */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            Loading...
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            No expense entries yet.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{e.supplier}</p>
                  <p className="truncate text-xs text-slate-500">{e.category}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-700">{formatNZD(e.amountExcl)}</p>
                  <p className="text-[11px] text-slate-400">{formatNZD(e.amountIncl)} incl.</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">{formatDateShort(e.date)}</span>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="ml-auto inline-flex h-8 items-center text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-400">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No expense entries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {["Date", "Supplier", "Category", "Incl. GST", "Excl. GST", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
                    {formatDateShort(e.date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{e.supplier}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{e.category}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {formatNZD(e.amountIncl)}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-slate-700">
                    {formatNZD(e.amountExcl)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
