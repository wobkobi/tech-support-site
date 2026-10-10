"use client";
// src/features/business/components/IncomeView.tsx
// Records, edits, and lists income entries against /api/business/income. The add form
// doubles as the edit form. The list has search, date-range + financial-year + method
// filters, sortable columns, and filter-aware summary cards; rows created from an invoice
// link back to it. The tax estimate lives on the Tax page and the overview's tax card, not
// here.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import {
  IncomeListCards,
  IncomeListTable,
  type IncomeSortDir,
  type IncomeSortKey,
} from "@/features/business/components/IncomeListRows";
import { LedgerListToolbar } from "@/features/business/components/LedgerListToolbar";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import { fyKeyOf, listFinancialYears } from "@/features/business/lib/financial-year";
import type { IncomeEntry } from "@/features/business/types/business";
import {
  ContactNameInput,
  useGoogleContacts,
} from "@/features/contacts/components/ContactNameInput";
import { cn } from "@/shared/lib/cn";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaPlus } from "react-icons/fa6";

/** Sortable column keys. */
type SortKey = IncomeSortKey;
/** Sort direction. */
type SortDir = IncomeSortDir;

/** Rows per "Show more" batch. */
const BATCH = 25;

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
    // Cast to string so the field stays widenable; the const-array element is a
    // literal type, which would otherwise pin `method` and reject edits.
    method: INCOME_METHODS[0] as string,
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const contacts = useGoogleContacts();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Phones only: the form starts folded so the list isn't pushed a screen down.
  // lg+ always shows it.
  const [formOpen, setFormOpen] = useState(false);
  // The mobile + button links here with ?new=<stamp>; each fresh stamp opens the form,
  // including when this page is already showing and only the query changed.
  const newStamp = useSearchParams().get("new");
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (newStamp && newStamp !== openedFor) {
    setOpenedFor(newStamp);
    setFormOpen(true);
  }
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
        // A sheet-sync failure is the more useful message, so it replaces the
        // plain confirmation rather than stacking a second toast on top of it.
        if (d.sheetSyncWarning) {
          toast("Saved, but the Cashbook sheet update didn't go through.", { tone: "warning" });
        } else {
          toast(editingId ? "Income entry updated." : "Income entry saved.", { tone: "success" });
        }
        setForm(emptyForm);
        setEditingId(null);
        setFormOpen(false);
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
    setFormOpen(true);
    // Next frame: on a phone the form is still hidden until this render lands.
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  /** Leaves edit mode, clears the form and folds it away again on phones. */
  function cancelEdit(): void {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
    setFormOpen(false);
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
        } else {
          toast("Income entry deleted.", { tone: "success" });
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

  const pager = useShowMore(
    sorted,
    BATCH,
    [search, fyKey, fromDate, toDate, methodFilter, sortKey, sortDir].join("|"),
  );

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);
  const anyFilterActive =
    search !== "" || fyKey !== "all" || fromDate !== "" || toDate !== "" || methodFilter !== "all";

  return (
    <div>
      {/* Summary cards - reflect the active filters. */}
      <StatStrip label="Income totals" className="mb-5 grid-cols-2">
        <StatCard label="Income (filtered)" value={formatNZD(filteredTotal)} tone="success" />
        <StatCard label="Entries" value={sorted.length} />
      </StatStrip>

      {!formOpen && (
        <AdminButton className="mb-6 w-full lg:hidden" onClick={() => setFormOpen(true)}>
          <FaPlus aria-hidden />
          Add income
        </AdminButton>
      )}

      {/* Add/edit form, with the Card look on the form itself so the edit scroll lands on
          its top edge. */}
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className={cn(
          "mb-6 rounded-lg border border-admin-border bg-admin-surface p-4 sm:p-5",
          !formOpen && "max-lg:hidden",
        )}
      >
        <CardHeader title={editingId ? "Edit income" : "Add income"} />
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminField label="Date" htmlFor="inc-date" required>
            <AdminInput
              id="inc-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            />
          </AdminField>
          <AdminField label="Customer" htmlFor="inc-customer" required>
            <ContactNameInput
              id="inc-customer"
              required
              value={form.customer}
              onChange={(customer) => setForm((p) => ({ ...p, customer }))}
              contacts={contacts}
              className={ADMIN_INPUT_CLS}
            />
          </AdminField>
          <AdminField label="Description" htmlFor="inc-description" required>
            <AdminInput
              id="inc-description"
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </AdminField>
          <AdminField label="Amount (NZD)" htmlFor="inc-amount" required>
            <AdminInput
              id="inc-amount"
              type="number"
              required
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            />
          </AdminField>
          <AdminField label="Payment method" htmlFor="inc-method">
            <AdminSelect
              id="inc-method"
              value={form.method}
              onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
            >
              {INCOME_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </AdminSelect>
          </AdminField>
          <AdminField label="Notes" htmlFor="inc-notes" optional>
            <AdminInput
              id="inc-notes"
              type="text"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </AdminField>
        </div>
        {formError && <p className="mt-2 text-sm text-coquelicot-600">{formError}</p>}
        <div className="mt-4 flex items-center gap-3">
          <AdminButton type="submit" busy={saving}>
            {editingId ? "Save changes" : "Add income"}
          </AdminButton>
          {editingId ? (
            <AdminButton type="button" variant="ghost" onClick={cancelEdit}>
              Cancel edit
            </AdminButton>
          ) : (
            <AdminButton type="button" variant="ghost" onClick={cancelEdit} className="lg:hidden">
              Cancel
            </AdminButton>
          )}
        </div>
      </form>

      <LedgerListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Customer or description"
        fyKey={fyKey}
        onFyChange={setFyKey}
        financialYears={financialYears}
        methodFilter={methodFilter}
        onMethodChange={setMethodFilter}
        methodOptions={methodOptions}
        fromDate={fromDate}
        onFromChange={setFromDate}
        toDate={toDate}
        onToChange={setToDate}
        anyFilterActive={anyFilterActive}
        onClear={() => {
          setSearch("");
          setFyKey("all");
          setFromDate("");
          setToDate("");
          setMethodFilter("all");
        }}
      />

      {/* Loading and empty states render once for every width; the rows split into phone
          cards and the desktop table. */}
      {loading ? (
        <Card>
          <p className="text-sm text-admin-muted">Loading...</p>
        </Card>
      ) : sorted.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title={
              entries.length === 0 ? "No income entries yet." : "No entries match your filters."
            }
          />
        </Card>
      ) : (
        <>
          <IncomeListCards rows={pager.visible} onEdit={startEdit} onDelete={setConfirmDeleteId} />
          <IncomeListTable
            rows={pager.visible}
            onEdit={startEdit}
            onDelete={setConfirmDeleteId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        </>
      )}

      {!loading && <ShowMoreButton pager={pager} noun={["entry", "entries"]} className="mt-3" />}

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
