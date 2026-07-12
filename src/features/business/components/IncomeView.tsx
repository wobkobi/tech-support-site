"use client";
// src/features/business/components/IncomeView.tsx
/**
 * @description Records, edits, and lists income entries against
 * /api/business/income. The add form doubles as the edit form. The list has
 * search, date-range + financial-year + method filters, sortable columns, and
 * filter-aware summary cards; rows created from an invoice link back to it. The
 * tax reserve lives on the business overview (single source), not here.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import type { IncomeEntry } from "@/features/business/types/business";
import { Field } from "@/shared/components/Field";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/** Sortable column keys. */
type SortKey = "date" | "customer" | "amount";
/** Sort direction. */
type SortDir = "asc" | "desc";

const INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";
const CONTROL_CLS = `h-9 ${INPUT_CLS}`;

/**
 * Client component for recording, filtering, and displaying income entries.
 * @returns Income view element.
 */
export function IncomeView(): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const emptyForm = {
    date: todayISO(),
    customer: "",
    description: "",
    amount: "",
    method: INCOME_METHODS[0],
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Filters + sort.
  const [search, setSearch] = useState("");
  const [fyKey, setFyKey] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const financialYears = useMemo(() => listFinancialYears(now), [now]);
  // Distinct methods actually present (covers legacy off-list values).
  const methodOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.method))).sort(),
    [entries],
  );

  useEffect(() => {
    fetch("/api/business/income")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEntries(d.entries);
        else toast("Couldn't load income entries.", { tone: "error" });
      })
      .catch(() => toast("Couldn't load income entries. Refresh to try again.", { tone: "error" }))
      .finally(() => setLoading(false));
  }, [toast]);

  /**
   * Submits the form: POST creates and prepends a new entry; PUT updates in place.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const url = editingId ? `/api/business/income/${editingId}` : "/api/business/income";
    try {
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      const d = await res.json();
      if (d.ok) {
        setEntries((prev) =>
          editingId ? prev.map((en) => (en.id === editingId ? d.entry : en)) : [d.entry, ...prev],
        );
        if (d.sheetSyncWarning) {
          toast("Saved, but the Cashbook sheet update didn't go through.", { tone: "warning" });
        }
        setForm(emptyForm);
        setEditingId(null);
      } else {
        setFormError(d.error ?? "Failed to save.");
      }
    } catch {
      setFormError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Loads an entry into the form for editing and scrolls the form into view.
   * @param entry - The income entry to edit.
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
    setFormError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Leaves edit mode and clears the form. */
  function cancelEdit(): void {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
  }

  /**
   * Deletes an income entry (already confirmed via the dialog).
   * @param id - ID of the income entry to delete.
   */
  async function handleDelete(id: string): Promise<void> {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/business/income/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (d.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        if (editingId === id) cancelEdit();
        if (d.sheetSyncWarning) {
          toast("Deleted, but the Cashbook sheet row couldn't be removed.", { tone: "warning" });
        }
      } else {
        toast(d.error ?? "Couldn't delete entry.", { tone: "error" });
      }
    } catch {
      toast("Couldn't delete entry. Check your connection.", { tone: "error" });
    }
  }

  /**
   * Toggles the sort: same column flips direction, else switches (dates/amounts
   * default to descending, text to ascending).
   * @param key - Column to sort by.
   */
  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "customer" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fy = fyKey === "all" ? null : financialYears.find((f) => fyKeyOf(f.label) === fyKey);
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
    return entries.filter((e) => {
      const d = new Date(e.date);
      if (fy && !(d >= fy.start && d < fy.end)) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (methodFilter !== "all" && e.method !== methodFilter) return false;
      if (q && !e.customer.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [entries, search, fyKey, fromDate, toDate, methodFilter, financialYears]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "date":
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
        case "customer":
          return a.customer.localeCompare(b.customer) * dir;
        case "amount":
          return (a.amount - b.amount) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);
  const anyFilterActive =
    search !== "" || fyKey !== "all" || fromDate !== "" || toDate !== "" || methodFilter !== "all";

  return (
    <div>
      {/* Summary cards - reflect the active filters. */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <StatCard label="Income (filtered)" value={formatNZD(filteredTotal)} tone="success" />
        <StatCard label="Entries" value={sorted.length} />
      </div>

      {/* Add/edit form. */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-admin-border bg-admin-surface p-5 shadow-sm"
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
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Customer" htmlFor="inc-customer" required>
            <input
              id="inc-customer"
              type="text"
              required
              value={form.customer}
              onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Description" htmlFor="inc-description" required>
            <input
              id="inc-description"
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={INPUT_CLS}
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
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Payment method" htmlFor="inc-method">
            <select
              id="inc-method"
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
              className={INPUT_CLS}
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
              className={INPUT_CLS}
            />
          </Field>
        </div>
        {formError && <p className="mt-2 text-xs text-coquelicot-400">{formError}</p>}
        <div className="mt-4 flex items-center gap-3">
          <AdminButton type="submit" busy={saving}>
            {editingId ? "Save changes" : "Add income"}
          </AdminButton>
          {editingId && (
            <AdminButton type="button" variant="ghost" onClick={cancelEdit}>
              Cancel edit
            </AdminButton>
          )}
        </div>
      </form>

      {/* Filter controls. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer or description"
            className={CONTROL_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Financial year</span>
          <select value={fyKey} onChange={(e) => setFyKey(e.target.value)} className={CONTROL_CLS}>
            <option value="all">All years</option>
            {financialYears.map((f) => (
              <option key={f.label} value={fyKeyOf(f.label)}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Method</span>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className={CONTROL_CLS}
          >
            <option value="all">All methods</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={CONTROL_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={CONTROL_CLS}
          />
        </label>
        {anyFilterActive && (
          <AdminButton
            variant="ghost"
            onClick={() => {
              setSearch("");
              setFyKey("all");
              setFromDate("");
              setToDate("");
              setMethodFilter("all");
            }}
          >
            Clear
          </AdminButton>
        )}
      </div>

      {/* Mobile card list. */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="rounded-xl border border-admin-border bg-admin-surface px-5 py-6 text-sm text-admin-faint shadow-sm">
            Loading...
          </p>
        ) : sorted.length === 0 ? (
          <p className="rounded-xl border border-admin-border bg-admin-surface px-5 py-6 text-sm text-admin-faint shadow-sm">
            {entries.length === 0 ? "No income entries yet." : "No entries match your filters."}
          </p>
        ) : (
          sorted.map((e) => (
            <div
              key={e.id}
              className="rounded-xl border border-admin-border bg-admin-surface p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-admin-text">{e.customer}</p>
                  <p className="truncate text-xs text-admin-muted">{e.description}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-emerald-600">
                  {formatNZD(e.amount)}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-muted">
                <span>{formatDateShort(e.date)}</span>
                <span>{e.method}</span>
                {e.invoiceId && (
                  <Link
                    href={`/admin/business/invoices/${e.invoiceId}`}
                    className="text-blue-500 hover:text-blue-700"
                  >
                    Invoice ↗
                  </Link>
                )}
                <button
                  onClick={() => startEdit(e)}
                  className="ml-auto inline-flex h-8 items-center text-russian-violet hover:opacity-80"
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(e.id)}
                  className="inline-flex h-8 items-center text-coquelicot-400 hover:text-coquelicot-500"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table. */}
      <div className="hidden overflow-x-auto rounded-xl border border-admin-border bg-admin-surface shadow-sm lg:block">
        {loading ? (
          <p className="px-5 py-6 text-sm text-admin-faint">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="px-5 py-6 text-sm text-admin-faint">
            {entries.length === 0 ? "No income entries yet." : "No entries match your filters."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-admin-border bg-admin-bg">
              <tr>
                {(
                  [
                    { key: "date", label: "Date" },
                    { key: "customer", label: "Customer" },
                  ] as { key: SortKey; label: string }[]
                ).map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-xs font-semibold text-admin-muted"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-admin-text"
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span aria-hidden className="text-[0.6rem] text-admin-text">
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  <button
                    type="button"
                    onClick={() => toggleSort("amount")}
                    className="inline-flex items-center gap-1 hover:text-admin-text"
                  >
                    Amount
                    {sortKey === "amount" && (
                      <span aria-hidden className="text-[0.6rem] text-admin-text">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  Method
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {sorted.map((e) => (
                <tr key={e.id} className="hover:bg-admin-bg">
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-admin-muted">
                    {formatDateShort(e.date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-admin-text">{e.customer}</td>
                  <td className="px-4 py-3 text-admin-text-secondary">
                    {e.description}
                    {e.invoiceId && (
                      <Link
                        href={`/admin/business/invoices/${e.invoiceId}`}
                        className="ml-2 text-xs text-blue-500 hover:text-blue-700"
                      >
                        Invoice ↗
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-emerald-600">
                    {formatNZD(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-admin-muted">{e.method}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => startEdit(e)}
                        className="text-xs text-russian-violet hover:opacity-80"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(e.id)}
                        className="text-xs text-coquelicot-400 hover:text-coquelicot-500"
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

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this income entry?"
        body="This removes it from the ledger and its Cashbook sheet row."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

/**
 * Extracts the `YYYY-YY` key from a financial-year label ("FY 2025-26").
 * @param label - The FY label.
 * @returns The key, or the label unchanged when it doesn't match.
 */
function fyKeyOf(label: string): string {
  return label.match(/(\d{4}-\d{2})/)?.[1] ?? label;
}
