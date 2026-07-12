"use client";
// src/features/business/components/ExpensesView.tsx
/**
 * @description Records, edits, and lists expense entries against
 * /api/business/expenses. The add form doubles as the edit form and previews the
 * GST split. The list has search, FY + method + category filters, a
 * missing-receipt toggle, sortable columns, filter-aware summary cards with a
 * per-category breakdown drill-in, and a "Migrate to subscription" row action.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { useToast } from "@/features/admin/components/ui/Toast";
import { BreakdownModal, type BreakdownData } from "@/features/business/components/BreakdownModal";
import { MigrateToSubscriptionDialog } from "@/features/business/components/MigrateToSubscriptionDialog";
import { calcGstFromInclusive, formatNZD, todayISO } from "@/features/business/lib/business";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/features/business/lib/constants";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import type { ExpenseEntry } from "@/features/business/types/business";
import { Field } from "@/shared/components/Field";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/** Sortable column keys. */
type SortKey = "date" | "supplier" | "amount";
/** Sort direction. */
type SortDir = "asc" | "desc";

/** Props for {@link ExpensesView}. */
interface ExpensesViewProps {
  /** Called after an expense is migrated to a subscription (bumps the sibling list). */
  onMigrated?: () => void;
}

const INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";
const CONTROL_CLS = `h-9 ${INPUT_CLS}`;
// An expense can only migrate to a subscription once its supplier+description has
// repeated MORE THAN twice - one coincidental pair isn't a confirmed pattern.
const MIGRATE_MIN_MATCHES = 3;

/**
 * Extracts the `YYYY-YY` key from a financial-year label ("FY 2025-26").
 * @param label - The FY label.
 * @returns The key, or the label unchanged when it doesn't match.
 */
function fyKeyOf(label: string): string {
  return label.match(/(\d{4}-\d{2})/)?.[1] ?? label;
}

/**
 * Recurrence key: normalised supplier + description. Expenses sharing a key are
 * the same repeat cost (a likely subscription).
 * @param e - The expense.
 * @returns The group key.
 */
function groupKey(e: ExpenseEntry): string {
  return `${e.supplier.trim().toLowerCase()}||${e.description.trim().toLowerCase()}`;
}

/**
 * How many expenses share this one's supplier+description (>= 2 = recurring).
 * @param groups - The precomputed group map.
 * @param e - The expense.
 * @returns The match count (1 when unique).
 */
function matchCount(groups: Map<string, ExpenseEntry[]>, e: ExpenseEntry): number {
  return groups.get(groupKey(e))?.length ?? 1;
}

/**
 * Client component for recording, filtering, and displaying expense entries.
 * @param props - Component props.
 * @param props.onMigrated - Callback fired after a successful migrate-to-subscription.
 * @returns Expenses view element.
 */
export function ExpensesView({ onMigrated }: ExpensesViewProps): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const emptyForm = {
    date: todayISO(),
    supplier: "",
    description: "",
    category: "Other",
    amountIncl: "",
    gstRate: "0.15",
    // Cast to string so the field stays widenable; the const-array element is a
    // literal type, which would otherwise pin `method` and reject edits.
    method: PAYMENT_METHODS[0] as string,
    receipt: false,
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
  const [methodFilter, setMethodFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [missingReceiptOnly, setMissingReceiptOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [migrateTarget, setMigrateTarget] = useState<ExpenseEntry | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const now = useMemo(() => new Date(), []);
  const financialYears = useMemo(() => listFinancialYears(now), [now]);
  const categoryOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.category))).sort(),
    [entries],
  );
  const methodOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.method))).sort(),
    [entries],
  );
  // Supplier+description groups for recurrence detection.
  const recurringGroups = useMemo(() => {
    const m = new Map<string, ExpenseEntry[]>();
    for (const e of entries) {
      const k = groupKey(e);
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    return m;
  }, [entries]);

  useEffect(() => {
    fetch("/api/business/expenses")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setEntries(d.entries);
        else toast("Couldn't load expense entries.", { tone: "error" });
      })
      .catch(() => toast("Couldn't load expense entries. Refresh to try again.", { tone: "error" }))
      .finally(() => setLoading(false));
  }, [toast]);

  const inclNum = parseFloat(form.amountIncl) || 0;
  const rate = parseFloat(form.gstRate) || 0;
  const previewGst = calcGstFromInclusive(inclNum, rate);

  /**
   * Submits the form: POST creates and prepends a new entry; PUT updates in place.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const url = editingId ? `/api/business/expenses/${editingId}` : "/api/business/expenses";
    try {
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, amountIncl: inclNum, gstRate: rate }),
      });
      const d = await res.json();
      if (d.ok) {
        setEntries((prev) =>
          editingId ? prev.map((en) => (en.id === editingId ? d.entry : en)) : [d.entry, ...prev],
        );
        if (d.sheetSyncWarning) {
          toast("Saved, but the Expenses sheet update didn't go through.", { tone: "warning" });
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
   * @param entry - The expense entry to edit.
   */
  function startEdit(entry: ExpenseEntry): void {
    setForm({
      date: entry.date.slice(0, 10),
      supplier: entry.supplier,
      description: entry.description,
      category: entry.category,
      amountIncl: String(entry.amountIncl),
      gstRate: entry.gstAmount > 0 ? "0.15" : "0",
      method: entry.method,
      receipt: entry.receipt,
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
   * Deletes an expense entry (already confirmed via the dialog).
   * @param id - ID of the expense entry to delete.
   */
  async function handleDelete(id: string): Promise<void> {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/business/expenses/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (d.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        if (editingId === id) cancelEdit();
        if (d.sheetSyncWarning) {
          toast("Deleted, but the Expenses sheet row couldn't be removed.", { tone: "warning" });
        }
      } else {
        toast(d.error ?? "Couldn't delete entry.", { tone: "error" });
      }
    } catch {
      toast("Couldn't delete entry. Check your connection.", { tone: "error" });
    }
  }

  /**
   * Toggles the sort: same column flips direction, else switches.
   * @param key - Column to sort by.
   */
  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "supplier" ? "asc" : "desc");
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
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (missingReceiptOnly && e.receipt) return false;
      if (q && !e.supplier.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [
    entries,
    search,
    fyKey,
    fromDate,
    toDate,
    methodFilter,
    categoryFilter,
    missingReceiptOnly,
    financialYears,
  ]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "date":
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
        case "supplier":
          return a.supplier.localeCompare(b.supplier) * dir;
        case "amount":
          return (a.amountExcl - b.amountExcl) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const totalExcl = filtered.reduce((s, e) => s + e.amountExcl, 0);
  const totalGst = filtered.reduce((s, e) => s + e.gstAmount, 0);

  const categoryBreakdown: BreakdownData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) map.set(e.category, (map.get(e.category) ?? 0) + e.amountExcl);
    const rows = Array.from(map.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
    return { title: "Expenses by category (excl. GST)", rows };
  }, [filtered]);

  const anyFilterActive =
    search !== "" ||
    fyKey !== "all" ||
    methodFilter !== "all" ||
    categoryFilter !== "all" ||
    fromDate !== "" ||
    toDate !== "" ||
    missingReceiptOnly;

  return (
    <div>
      {/* Summary cards - reflect the active filters; the category card drills in. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expenses (excl. GST)" value={formatNZD(totalExcl)} />
        <StatCard label="GST claimable" value={formatNZD(totalGst)} tone="success" />
        <StatCard label="Entries" value={sorted.length} />
        <StatCard
          label="Categories"
          value={categoryBreakdown.rows?.length ?? 0}
          sub="View breakdown"
          onClick={() => setBreakdownOpen(true)}
        />
      </div>

      {/* Add/edit form. */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-admin-border bg-admin-surface p-5 shadow-sm"
      >
        <h2 className="mb-4 text-sm font-semibold text-russian-violet">
          {editingId ? "Edit expense" : "Add expense"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="exp-date" required>
            <input
              id="exp-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Supplier" htmlFor="exp-supplier" required>
            <input
              id="exp-supplier"
              type="text"
              required
              value={form.supplier}
              onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Description" htmlFor="exp-description" required>
            <input
              id="exp-description"
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Category" htmlFor="exp-category">
            <select
              id="exp-category"
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className={INPUT_CLS}
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
              className={INPUT_CLS}
            />
          </Field>
          <Field label="GST rate" htmlFor="exp-gst">
            <select
              id="exp-gst"
              value={form.gstRate}
              onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
              className={INPUT_CLS}
            >
              <option value="0.15">15%</option>
              <option value="0">0% (no GST)</option>
            </select>
            {inclNum > 0 && rate > 0 && (
              <p className="mt-1 text-xs text-admin-muted">
                GST: {formatNZD(previewGst)} | Excl: {formatNZD(inclNum - previewGst)}
              </p>
            )}
          </Field>
          <Field label="Payment method" htmlFor="exp-method">
            <select
              id="exp-method"
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
              className={INPUT_CLS}
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
              className={INPUT_CLS}
            />
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              id="receipt"
              checked={form.receipt}
              onChange={(e) => setForm((p) => ({ ...p, receipt: e.target.checked }))}
              className="h-4 w-4"
            />
            <span className="text-sm text-admin-text-secondary">Receipt held</span>
          </label>
        </div>
        {formError && <p className="mt-2 text-xs text-coquelicot-400">{formError}</p>}
        <div className="mt-4 flex items-center gap-3">
          <AdminButton type="submit" busy={saving}>
            {editingId ? "Save changes" : "Add expense"}
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
            placeholder="Supplier or description"
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
          <span className="text-xs font-medium text-admin-muted">Category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={CONTROL_CLS}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
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
        <label className="flex h-9 items-center gap-2 text-sm text-admin-text-secondary">
          <input
            type="checkbox"
            checked={missingReceiptOnly}
            onChange={(e) => setMissingReceiptOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Missing receipt
        </label>
        {anyFilterActive && (
          <AdminButton
            variant="ghost"
            onClick={() => {
              setSearch("");
              setFyKey("all");
              setMethodFilter("all");
              setCategoryFilter("all");
              setFromDate("");
              setToDate("");
              setMissingReceiptOnly(false);
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
            {entries.length === 0 ? "No expense entries yet." : "No entries match your filters."}
          </p>
        ) : (
          sorted.map((e) => (
            <div
              key={e.id}
              className="rounded-xl border border-admin-border bg-admin-surface p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-admin-text">{e.supplier}</p>
                  <p className="truncate text-xs text-admin-muted">
                    {e.category}
                    {matchCount(recurringGroups, e) >= MIGRATE_MIN_MATCHES && (
                      <span className="ml-2 font-medium text-russian-violet">
                        recurring ×{matchCount(recurringGroups, e)}
                      </span>
                    )}
                    {!e.receipt && <span className="ml-2 text-amber-600">no receipt</span>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-admin-text">{formatNZD(e.amountExcl)}</p>
                  <p className="text-[11px] text-admin-faint">{formatNZD(e.amountIncl)} incl.</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-muted">
                <span>{formatDateShort(e.date)}</span>
                <div className="ml-auto flex items-center gap-3">
                  {matchCount(recurringGroups, e) >= MIGRATE_MIN_MATCHES && (
                    <button
                      onClick={() => setMigrateTarget(e)}
                      className="inline-flex h-8 items-center text-russian-violet hover:opacity-80"
                    >
                      Migrate
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(e)}
                    className="inline-flex h-8 items-center text-russian-violet hover:opacity-80"
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
            {entries.length === 0 ? "No expense entries yet." : "No entries match your filters."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-admin-border bg-admin-bg">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  <button
                    type="button"
                    onClick={() => toggleSort("date")}
                    className="inline-flex items-center gap-1 hover:text-admin-text"
                  >
                    Date
                    {sortKey === "date" && (
                      <span aria-hidden className="text-[0.6rem] text-admin-text">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  <button
                    type="button"
                    onClick={() => toggleSort("supplier")}
                    className="inline-flex items-center gap-1 hover:text-admin-text"
                  >
                    Supplier
                    {sortKey === "supplier" && (
                      <span aria-hidden className="text-[0.6rem] text-admin-text">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  Incl. GST
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">
                  <button
                    type="button"
                    onClick={() => toggleSort("amount")}
                    className="inline-flex items-center gap-1 hover:text-admin-text"
                  >
                    Excl. GST
                    {sortKey === "amount" && (
                      <span aria-hidden className="text-[0.6rem] text-admin-text">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
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
                  <td className="px-4 py-3 font-medium text-admin-text">
                    {e.supplier}
                    {matchCount(recurringGroups, e) >= MIGRATE_MIN_MATCHES && (
                      <span className="ml-2 rounded-full bg-russian-violet/10 px-1.5 py-0.5 text-[10px] font-semibold text-russian-violet">
                        recurring ×{matchCount(recurringGroups, e)}
                      </span>
                    )}
                    {!e.receipt && (
                      <span className="ml-2 text-xs font-normal text-amber-600">no receipt</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-admin-muted">{e.category}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-admin-text-secondary">
                    {formatNZD(e.amountIncl)}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-admin-text">
                    {formatNZD(e.amountExcl)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {matchCount(recurringGroups, e) >= MIGRATE_MIN_MATCHES && (
                        <button
                          onClick={() => setMigrateTarget(e)}
                          className="text-xs text-russian-violet hover:opacity-80"
                        >
                          Migrate
                        </button>
                      )}
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
        title="Delete this expense?"
        body="This removes it from the ledger and its Expenses sheet row."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {breakdownOpen && (
        <BreakdownModal data={categoryBreakdown} onClose={() => setBreakdownOpen(false)} />
      )}

      {migrateTarget && (
        <MigrateToSubscriptionDialog
          open
          expense={migrateTarget}
          matches={recurringGroups.get(groupKey(migrateTarget))}
          onClose={(migrated) => {
            setMigrateTarget(null);
            if (migrated) {
              toast("Subscription created from expense.", { tone: "success" });
              onMigrated?.();
            }
          }}
        />
      )}
    </div>
  );
}
