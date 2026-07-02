"use client";
// src/features/business/components/IncomeView.tsx
/**
 * @description Records, edits, and lists income entries against
 * /api/business/income, showing a running income total and a 20% tax-reserve
 * estimate. The form doubles as the edit form when an entry's Edit is clicked.
 */

import { formatNZD, todayISO } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import type { IncomeEntry } from "@/features/business/types/business";
import { Button } from "@/shared/components/Button";
import { Field } from "@/shared/components/Field";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useRef, useState } from "react";

const inputClasses = cn(
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm",
  "focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
);

/**
 * Client component for recording and displaying income entries.
 * @returns Income view element
 */
export function IncomeView(): React.ReactElement {
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const emptyForm = {
    date: todayISO(),
    customer: "",
    description: "",
    amount: "",
    method: "Business Account",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const headers = {};

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
   * Submits the form: POST creates and prepends a new entry; when editing,
   * PUT updates the entry in place.
   * @param e - Form submit event
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const url = editingId ? `/api/business/income/${editingId}` : "/api/business/income";
    const res = await fetch(url, {
      method: editingId ? "PUT" : "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    const d = await res.json();
    if (d.ok) {
      if (editingId) {
        setEntries((prev) => prev.map((en) => (en.id === editingId ? d.entry : en)));
      } else {
        setEntries((prev) => [d.entry, ...prev]);
      }
      setForm(emptyForm);
      setEditingId(null);
    } else {
      setError(d.error ?? "Failed to save");
    }
    setSaving(false);
  }

  /**
   * Loads an entry into the form for editing and scrolls the form into view.
   * @param entry - The income entry to edit
   */
  function startEdit(entry: IncomeEntry): void {
    setForm({
      date: entry.date.slice(0, 10),
      customer: entry.customer,
      description: entry.description,
      amount: String(entry.amount),
      method: entry.method,
      notes: entry.notes ?? "",
    });
    setEditingId(entry.id);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Leaves edit mode and clears the form. */
  function cancelEdit(): void {
    setForm(emptyForm);
    setEditingId(null);
    setError(null);
  }

  /**
   * Deletes an income entry after confirmation.
   * @param id - ID of the income entry to delete
   */
  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this income entry?")) return;
    const res = await fetch(`/api/business/income/${id}`, { method: "DELETE", headers });
    if ((await res.json()).ok) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (editingId === id) cancelEdit();
    }
  }

  return (
    <div>
      {/* Totals bar - stacks on mobile so three values stay readable below ~480px. */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Total income", value: formatNZD(totalIncome), color: "text-green-600" },
          { label: "Entries", value: String(entries.length), color: "text-slate-700" },
          { label: "20% tax reserve", value: formatNZD(taxReserve), color: "text-amber-600" },
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

      {/* Add/edit form - doubles as the edit form when an entry's Edit is clicked. */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-4 text-sm font-semibold text-russian-violet">
          {editingId ? "Edit income" : "Add income"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="inc-date" required>
            <input
              id="inc-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Customer" htmlFor="inc-customer" required>
            <input
              id="inc-customer"
              type="text"
              required
              value={form.customer}
              onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Description" htmlFor="inc-description" required>
            <input
              id="inc-description"
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Amount (NZD)" htmlFor="inc-amount" required>
            <input
              id="inc-amount"
              type="number"
              required
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              className={inputClasses}
            />
          </Field>
          <Field label="Payment method" htmlFor="inc-method">
            <select
              id="inc-method"
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
              className={inputClasses}
            >
              {INCOME_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" htmlFor="inc-notes" optional>
            <input
              id="inc-notes"
              type="text"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className={inputClasses}
            />
          </Field>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" variant="secondary" size="sm" disabled={saving}>
            {saving ? "Saving..." : editingId ? "Save changes" : "Add income"}
          </Button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {/* Mobile card list - stacks each entry so the date/amount/description
          stay readable below ~640px where the table would overflow. */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            Loading...
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            No income entries yet.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{e.customer}</p>
                  <p className="truncate text-xs text-slate-500">{e.description}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-green-600">
                  {formatNZD(e.amount)}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">{formatDateShort(e.date)}</span>
                <span className="text-slate-400">{e.method}</span>
                <button
                  onClick={() => startEdit(e)}
                  className="ml-auto inline-flex h-8 items-center text-moonstone-600 hover:text-moonstone-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="inline-flex h-8 items-center text-red-400 hover:text-red-600"
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
          <p className="px-5 py-6 text-sm text-slate-400">No income entries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {["Date", "Customer", "Description", "Amount", "Method", ""].map((h) => (
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
                  <td className="px-4 py-3 font-medium text-slate-700">{e.customer}</td>
                  <td className="px-4 py-3 text-slate-500">{e.description}</td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-green-600">
                    {formatNZD(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{e.method}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => startEdit(e)}
                        className="text-xs text-moonstone-600 hover:text-moonstone-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
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
