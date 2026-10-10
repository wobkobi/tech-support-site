"use client";
// src/features/business/components/ExpensesView.tsx
// Records, edits, and lists expense entries against /api/business/expenses. The add form
// (ExpenseForm) doubles as the edit form and previews the GST split. The list has search,
// FY + method + category filters, a missing-receipt toggle, sortable columns, filter-aware
// summary cards with a per-category breakdown drill-in, a "Migrate to subscription" row
// action, and "Turn into an asset" on rows over the low-value write-off threshold ("View
// asset" once one is linked). The rows render in ExpensesListRows.
// Totals use the GST basis, and a new expense defaults to 0% GST while not registered.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { lastCardSpan, StatStrip } from "@/features/admin/components/ui/StatStrip";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import { BreakdownModal, type BreakdownData } from "@/features/business/components/BreakdownModal";
import { ExpenseForm, type ExpenseFormState } from "@/features/business/components/ExpenseForm";
import {
  groupKey,
  matchCount,
  MIGRATE_MIN_MATCHES,
} from "@/features/business/components/expenses-recurrence";
import {
  ExpensesListCards,
  ExpensesListTable,
  type ExpenseSortDir,
  type ExpenseSortKey,
} from "@/features/business/components/ExpensesListRows";
import { LedgerListToolbar } from "@/features/business/components/LedgerListToolbar";
import { MigrateToSubscriptionDialog } from "@/features/business/components/MigrateToSubscriptionDialog";
import { calcGstFromInclusive, formatNZD, todayISO } from "@/features/business/lib/business";
import { PAYMENT_METHODS } from "@/features/business/lib/constants";
import { fyKeyOf, listFinancialYears } from "@/features/business/lib/financial-year";
import { expenseTaxBasis, isGstRegisteredOn } from "@/features/business/lib/tax/gst-basis";
import type { GstStatus } from "@/features/business/lib/tax/types";
import type { ExpenseEntry, Subscription } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaPlus } from "react-icons/fa6";

/** Sortable column keys. */
type SortKey = ExpenseSortKey;
/** Sort direction. */
type SortDir = ExpenseSortDir;

/** Rows per "Show more" batch. */
const BATCH = 25;

/** Props for {@link ExpensesView}. */
interface ExpensesViewProps {
  /** Called after an expense is migrated to a subscription (bumps the sibling list). */
  onMigrated?: () => void;
  /** GST registration; sets the new-expense GST default and the totals' basis. */
  gst: GstStatus;
  /** Rows costing more than this on the GST basis offer "Turn into an asset"; settings.tax.lowValueThreshold. */
  assetThreshold: number;
  /** Expenses already linked to an asset; their rows offer "View asset" instead. */
  linkedExpenseIds: readonly string[];
}

/**
 * Loads every expense entry.
 * @returns The entries, newest first as the API orders them.
 */
async function fetchEntries(): Promise<ExpenseEntry[]> {
  const r = await fetch("/api/business/expenses");
  const d = (await r.json()) as { ok: boolean; entries?: ExpenseEntry[] };
  if (!d.ok || !d.entries) throw new Error(`expenses load failed (${r.status})`);
  return d.entries;
}

/**
 * Loads the {@link groupKey} of every active subscription.
 * @returns The keys of costs that already have a subscription.
 */
async function fetchSubscribedKeys(): Promise<Set<string>> {
  const r = await fetch("/api/business/subscriptions");
  const d = (await r.json()) as { ok: boolean; subscriptions?: Subscription[] };
  if (!d.ok || !d.subscriptions) throw new Error(`subscriptions load failed (${r.status})`);
  return new Set(d.subscriptions.filter((s) => s.isActive).map(groupKey));
}

/**
 * Client component for recording, filtering, and displaying expense entries.
 * @param props - Component props.
 * @param props.onMigrated - Callback fired after a successful migrate-to-subscription.
 * @param props.gst - GST registration status from the pricing settings.
 * @param props.assetThreshold - Cost (on the GST basis) above which a row offers "Turn into an asset".
 * @param props.linkedExpenseIds - Expenses already linked to an asset.
 * @returns Expenses view element.
 */
export function ExpensesView({
  onMigrated,
  gst,
  assetThreshold,
  linkedExpenseIds,
}: ExpensesViewProps): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const emptyForm = {
    date: todayISO(),
    supplier: "",
    description: "",
    category: "Other",
    amountIncl: "",
    // No GST to claim while unregistered, so a new expense isn't split; an edit keeps
    // its own rate (startEdit).
    gstRate: isGstRegisteredOn(todayISO(), gst) ? "0.15" : "0",
    // Cast to string so the field stays widenable; the const-array element is a
    // literal type, which would otherwise pin `method` and reject edits.
    method: PAYMENT_METHODS[0] as string,
    receipt: false,
    notes: "",
  };
  const [form, setForm] = useState<ExpenseFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const [methodFilter, setMethodFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [missingReceiptOnly, setMissingReceiptOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [migrateTarget, setMigrateTarget] = useState<ExpenseEntry | null>(null);
  // Group keys that already have an active subscription, so their rows offer no
  // second Migrate - the subscription records each payment, and a copy doubles it.
  // Null until loaded: with no answer, Migrate stays hidden rather than guessing.
  const [subscribedKeys, setSubscribedKeys] = useState<Set<string> | null>(null);
  const [subsLoadKey, setSubsLoadKey] = useState(0);
  // A failed load shows a banner with Try again, never an empty ledger or $0 totals.
  const [loadError, setLoadError] = useState(false);
  const [subsError, setSubsError] = useState(false);
  const [retrying, setRetrying] = useState(false);
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
  const linkedSet = useMemo(() => new Set(linkedExpenseIds), [linkedExpenseIds]);

  useEffect(() => {
    fetchEntries()
      .then(setEntries)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSubscribedKeys()
      .then((keys) => {
        setSubscribedKeys(keys);
        setSubsError(false);
      })
      .catch(() => setSubsError(true));
  }, [subsLoadKey]);

  /**
   * Re-runs both loads from the error banner's Try again button.
   */
  async function retryLoad(): Promise<void> {
    setRetrying(true);
    const [entriesRes, keysRes] = await Promise.allSettled([fetchEntries(), fetchSubscribedKeys()]);
    if (entriesRes.status === "fulfilled") {
      setEntries(entriesRes.value);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    if (keysRes.status === "fulfilled") {
      setSubscribedKeys(keysRes.value);
      setSubsError(false);
    } else {
      setSubsError(true);
    }
    setRetrying(false);
  }

  /**
   * Whether a row offers Migrate: a confirmed repeat with no active subscription yet.
   * @param e - The expense.
   * @returns True when the Migrate action should show.
   */
  function canMigrate(e: ExpenseEntry): boolean {
    return (
      subscribedKeys !== null &&
      matchCount(recurringGroups, e) >= MIGRATE_MIN_MATCHES &&
      !subscribedKeys.has(groupKey(e))
    );
  }

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
        // A sheet-sync failure is the more useful message, so it replaces the
        // plain confirmation rather than stacking a second toast on top of it.
        if (d.sheetSyncWarning) {
          toast("Saved, but the Expenses sheet update didn't go through.", { tone: "warning" });
        } else {
          toast(editingId ? "Expense updated." : "Expense saved.", { tone: "success" });
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
        } else {
          toast("Expense deleted.", { tone: "success" });
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

  const pager = useShowMore(
    sorted,
    BATCH,
    [
      search,
      fyKey,
      fromDate,
      toDate,
      methodFilter,
      categoryFilter,
      missingReceiptOnly,
      sortKey,
      sortDir,
    ].join("|"),
  );

  // GST basis: a row dated before registration (or any row while unregistered) costs its
  // GST-inclusive amount, and none of its GST is claimable.
  const totalExpenses = filtered.reduce((s, e) => s + expenseTaxBasis(e, gst), 0);
  const totalGst = filtered.reduce(
    (s, e) => s + (isGstRegisteredOn(e.date, gst) ? e.gstAmount : 0),
    0,
  );
  const expensesLabel = gst.registered ? "Expenses (excl. GST)" : "Expenses";

  const categoryBreakdown: BreakdownData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      map.set(e.category, (map.get(e.category) ?? 0) + expenseTaxBasis(e, gst));
    }
    const rows = Array.from(map.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      title: gst.registered ? "Expenses by category (excl. GST)" : "Expenses by category",
      rows,
    };
  }, [filtered, gst]);

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
      {(loadError || subsError) && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>
            {loadError
              ? "Couldn't load your expenses. Try again, or come back later."
              : "Couldn't check your subscriptions, so Migrate is hidden until they load."}
          </span>
          <AdminButton
            size="xs"
            variant="secondary"
            onClick={() => void retryLoad()}
            busy={retrying}
          >
            Try again
          </AdminButton>
        </div>
      )}

      {/* Summary cards - reflect the active filters; the category card drills in.
          Unloaded data shows "-", not totals of an empty list. */}
      <StatStrip
        label="Expense totals"
        className={cn("mb-5 grid-cols-2", gst.registered ? "lg:grid-cols-4" : "lg:grid-cols-3")}
      >
        <StatCard label={expensesLabel} value={loadError ? "-" : formatNZD(totalExpenses)} />
        {/* Nothing is claimable while unregistered, so the card would only ever read $0.00. */}
        {gst.registered && (
          <StatCard
            label="GST claimable"
            value={loadError ? "-" : formatNZD(totalGst)}
            tone="success"
          />
        )}
        <StatCard label="Entries" value={loadError ? "-" : sorted.length} />
        <StatCard
          label="Categories"
          value={loadError ? "-" : (categoryBreakdown.rows?.length ?? 0)}
          sub="View breakdown"
          onClick={() => setBreakdownOpen(true)}
          className={lastCardSpan(gst.registered ? 4 : 3, { base: 2, lg: gst.registered ? 4 : 3 })}
        />
      </StatStrip>

      {!formOpen && (
        <AdminButton className="mb-6 w-full lg:hidden" onClick={() => setFormOpen(true)}>
          <FaPlus aria-hidden />
          Add expense
        </AdminButton>
      )}

      <ExpenseForm
        formRef={formRef}
        formOpen={formOpen}
        editingId={editingId}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
        onCancel={cancelEdit}
        saving={saving}
        formError={formError}
        inclNum={inclNum}
        rate={rate}
        previewGst={previewGst}
      />

      <LedgerListToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Supplier or description"
        fyKey={fyKey}
        onFyChange={setFyKey}
        financialYears={financialYears}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        categoryOptions={categoryOptions}
        methodFilter={methodFilter}
        onMethodChange={setMethodFilter}
        methodOptions={methodOptions}
        fromDate={fromDate}
        onFromChange={setFromDate}
        toDate={toDate}
        onToChange={setToDate}
        missingReceiptOnly={missingReceiptOnly}
        onMissingReceiptChange={setMissingReceiptOnly}
        anyFilterActive={anyFilterActive}
        onClear={() => {
          setSearch("");
          setFyKey("all");
          setMethodFilter("all");
          setCategoryFilter("all");
          setFromDate("");
          setToDate("");
          setMissingReceiptOnly(false);
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
              entries.length > 0
                ? "No entries match your filters."
                : loadError
                  ? "Expenses didn't load."
                  : "No expense entries yet."
            }
          />
        </Card>
      ) : (
        <>
          <ExpensesListCards
            rows={pager.visible}
            recurringGroups={recurringGroups}
            subscribedKeys={subscribedKeys}
            canMigrate={canMigrate}
            gst={gst}
            assetThreshold={assetThreshold}
            linkedSet={linkedSet}
            onMigrate={setMigrateTarget}
            onEdit={startEdit}
            onDelete={setConfirmDeleteId}
          />
          <ExpensesListTable
            rows={pager.visible}
            recurringGroups={recurringGroups}
            subscribedKeys={subscribedKeys}
            canMigrate={canMigrate}
            gst={gst}
            assetThreshold={assetThreshold}
            linkedSet={linkedSet}
            onMigrate={setMigrateTarget}
            onEdit={startEdit}
            onDelete={setConfirmDeleteId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        </>
      )}

      {!loading && <ShowMoreButton pager={pager} noun={["expense", "expenses"]} className="mt-3" />}

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
              setSubsLoadKey((k) => k + 1);
              onMigrated?.();
            }
          }}
        />
      )}
    </div>
  );
}
