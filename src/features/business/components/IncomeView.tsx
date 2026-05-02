"use client";

import { useState, useEffect } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD } from "@/features/business/lib/business";
import type { IncomeEntry } from "@/features/business/types/business";

const METHODS = ["Business Account", "Personal then Reimburse", "Cash"];

/**
 * Returns today's date as a YYYY-MM-DD string.
 * @returns ISO date string for today
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Client component for recording and displaying income entries.
 * @param props - Component props
 * @param props.token - Admin auth token
 * @returns Income view element
 */
export function IncomeView({ token }: { token: string }): React.ReactElement {
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    date: today(),
    customer: "",
    description: "",
    amount: "",
    method: "Business Account",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = { "X-Admin-Secret": token };

  useEffect(() => {
    fetch("/api/business/income", { headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEntries(d.entries);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalIncome = entries.reduce((s, e) => s + e.amount, 0);
  const taxReserve = totalIncome * 0.2;

  /**
   * Submits the add-income form and prepends the new entry to the list.
   * @param e - Form submit event
   */
  async function handleAdd(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/business/income", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    const d = await res.json();
    if (d.ok) {
      setEntries((prev) => [d.entry, ...prev]);
      setForm({
        date: today(),
        customer: "",
        description: "",
        amount: "",
        method: "Business Account",
        notes: "",
      });
    } else {
      setError(d.error ?? "Failed to save");
    }
    setSaving(false);
  }

  /**
   * Deletes an income entry after confirmation.
   * @param id - ID of the income entry to delete
   */
  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this income entry?")) return;
    const res = await fetch(`/api/business/income/${id}`, { method: "DELETE", headers });
    if ((await res.json()).ok) setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      {/* Totals bar */}
      <div className={cn("mb-6 grid grid-cols-3 gap-3")}>
        {[
          { label: "Total income", value: formatNZD(totalIncome), color: "text-green-600" },
          { label: "Entries", value: String(entries.length), color: "text-slate-700" },
          { label: "20% tax reserve", value: formatNZD(taxReserve), color: "text-amber-600" },
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
        <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>Add income</h2>
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
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Customer</label>
            <input
              type="text"
              required
              value={form.customer}
              onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))}
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
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Amount (NZD)
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
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
              {METHODS.map((m) => (
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
        </div>
        {error && <p className={cn("mt-2 text-xs text-red-600")}>{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "bg-russian-violet mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Add income"}
        </button>
      </form>

      {/* Table */}
      <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm")}>
        {loading ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>Loading...</p>
        ) : entries.length === 0 ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>No income entries yet.</p>
        ) : (
          <table className={cn("w-full text-sm")}>
            <thead className={cn("border-b border-slate-100 bg-slate-50")}>
              <tr>
                {["Date", "Customer", "Description", "Amount", "Method", ""].map((h) => (
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
                  <td className={cn("px-4 py-3 font-medium text-slate-700")}>{e.customer}</td>
                  <td className={cn("px-4 py-3 text-slate-500")}>{e.description}</td>
                  <td className={cn("whitespace-nowrap px-4 py-3 font-semibold text-green-600")}>
                    {formatNZD(e.amount)}
                  </td>
                  <td className={cn("px-4 py-3 text-xs text-slate-400")}>{e.method}</td>
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
