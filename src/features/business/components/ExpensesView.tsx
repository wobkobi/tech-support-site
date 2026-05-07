"use client";

import { useState, useEffect } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, todayISO, calcGstFromInclusive } from "@/features/business/lib/business";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/features/business/lib/constants";
import type { ExpenseEntry } from "@/features/business/types/business";

/**
 * Client component for recording and displaying expense entries.
 * @param props - Component props
 * @param props.token - Admin auth token
 * @returns Expenses view element
 */
export function ExpensesView({ token }: { token: string }): React.ReactElement {
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

  const headers = { "X-Admin-Secret": token };

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
      {/* Totals bar */}
      <div className={cn("mb-6 grid grid-cols-3 gap-3")}>
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
            className={cn("rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm")}
          >
            <p className={cn("text-xl font-extrabold", c.color)}>{c.value}</p>
            <p className={cn("text-xs text-slate-500")}>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className={cn("mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
      >
        <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>Add expense</h2>
        <div className={cn("grid gap-3 sm:grid-cols-2")}>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Date</label>
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Supplier</label>
            <input
              type="text"
              required
              value={form.supplier}
              onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Description
            </label>
            <input
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Amount incl. GST
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={form.amountIncl}
              onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>GST rate</label>
            <select
              value={form.gstRate}
              onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            >
              <option value="0.15">15%</option>
              <option value="0">0% (no GST)</option>
            </select>
            {inclNum > 0 && rate > 0 && (
              <p className={cn("mt-1 text-xs text-slate-400")}>
                GST: {formatNZD(previewGst)} | Excl: {formatNZD(inclNum - previewGst)}
              </p>
            )}
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Payment method
            </label>
            <select
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Notes (optional)
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
          <div className={cn("flex items-center gap-2")}>
            <input
              type="checkbox"
              id="receipt"
              checked={form.receipt}
              onChange={(e) => setForm((p) => ({ ...p, receipt: e.target.checked }))}
              className={cn("h-4 w-4 rounded border-slate-300")}
            />
            <label htmlFor="receipt" className={cn("text-sm text-slate-600")}>
              Receipt held
            </label>
          </div>
        </div>
        {error && <p className={cn("mt-2 text-xs text-red-600")}>{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "bg-russian-violet mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Add expense"}
        </button>
      </form>

      {/* Table */}
      <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm")}>
        {loading ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>Loading...</p>
        ) : entries.length === 0 ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>No expense entries yet.</p>
        ) : (
          <table className={cn("w-full text-sm")}>
            <thead className={cn("border-b border-slate-100 bg-slate-50")}>
              <tr>
                {["Date", "Supplier", "Category", "Incl. GST", "Excl. GST", ""].map((h) => (
                  <th
                    key={h}
                    className={cn("px-4 py-3 text-left text-xs font-semibold text-slate-500")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y divide-slate-100")}>
              {entries.map((e) => (
                <tr key={e.id} className={cn("hover:bg-slate-50")}>
                  <td className={cn("whitespace-nowrap px-4 py-3 text-xs text-slate-500")}>
                    {new Date(e.date).toLocaleDateString("en-NZ")}
                  </td>
                  <td className={cn("px-4 py-3 font-medium text-slate-700")}>{e.supplier}</td>
                  <td className={cn("px-4 py-3 text-xs text-slate-500")}>{e.category}</td>
                  <td className={cn("whitespace-nowrap px-4 py-3 text-slate-700")}>
                    {formatNZD(e.amountIncl)}
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-3 font-semibold text-slate-700")}>
                    {formatNZD(e.amountExcl)}
                  </td>
                  <td className={cn("px-4 py-3")}>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className={cn("text-xs text-red-400 hover:text-red-600")}
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
