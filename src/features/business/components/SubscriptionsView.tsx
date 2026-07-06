"use client";
// src/features/business/components/SubscriptionsView.tsx
/**
 * @description Records and lists recurring subscription expenses (description,
 * supplier, amount, GST, frequency, next due) and flags overdue ones.
 */

import { formatNZD, todayISO } from "@/features/business/lib/business";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  VALID_FREQUENCIES,
} from "@/features/business/lib/constants";
import type { Subscription } from "@/features/business/types/business";
import { Button } from "@/shared/components/Button";
import { Field } from "@/shared/components/Field";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

const inputClasses = cn(
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm",
  "focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
);

interface FormState {
  description: string;
  supplier: string;
  category: string;
  amountIncl: string;
  gstRate: string;
  method: string;
  frequency: string;
  nextDue: string;
  notes: string;
}

/**
 * Returns a blank form state with sensible defaults.
 * @returns Default FormState.
 */
function emptyForm(): FormState {
  return {
    description: "",
    supplier: "",
    category: "Subscriptions",
    amountIncl: "",
    gstRate: "0.15",
    method: "Business Account",
    frequency: "monthly",
    nextDue: todayISO(),
    notes: "",
  };
}

/**
 * Today's date as a YYYY-MM-DD string in NZ time. Overdue/due-today are calendar
 * comparisons for a NZ operator, so UTC would lag by up to 13 hours.
 * @returns NZ-local ISO date string.
 */
function nzTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

/**
 * Returns true if the subscription's next due date is in the past.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is overdue.
 */
function isOverdue(nextDue: string): boolean {
  return new Date(nextDue) < new Date(nzTodayISO());
}

/**
 * Returns true if the subscription's next due date is today.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is due today.
 */
function isDueToday(nextDue: string): boolean {
  return nextDue.startsWith(nzTodayISO());
}

/**
 * Subscriptions manager - list, add, edit, record payment, delete.
 * @returns Subscriptions view element.
 */
export function SubscriptionsView(): React.ReactElement {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; warn?: boolean } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const showToast = useCallback((msg: string, warn = false) => {
    setToast({ msg, warn });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/business/subscriptions");
      const data = (await res.json()) as { ok: boolean; subscriptions: Subscription[] };
      if (data.ok) setSubs(data.subscriptions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Populates the form with an existing subscription's values and opens the edit form.
   * @param sub - Subscription to edit.
   */
  function startEdit(sub: Subscription): void {
    setEditId(sub.id);
    setForm({
      description: sub.description,
      supplier: sub.supplier,
      category: sub.category,
      amountIncl: String(sub.amountIncl),
      gstRate: String(sub.gstRate),
      method: sub.method,
      frequency: sub.frequency,
      nextDue: sub.nextDue.split("T")[0],
      notes: sub.notes ?? "",
    });
    setShowForm(true);
  }

  /** Closes the form and resets it to blank state. */
  function cancelForm(): void {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
  }

  /**
   * Submits the subscription form - creates or updates via API.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editId ? `/api/business/subscriptions/${editId}` : "/api/business/subscriptions";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          amountIncl: parseFloat(form.amountIncl),
          gstRate: parseFloat(form.gstRate),
        }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (res.ok && data.ok) {
        showToast(editId ? "Subscription updated." : "Subscription added.");
        cancelForm();
        await load();
      } else {
        showToast("Save failed.", true);
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * Records a payment for a subscription, advancing its next due date.
   * @param sub - Subscription to record payment for.
   */
  async function handleRecord(sub: Subscription): Promise<void> {
    setRecording(sub.id);
    try {
      const res = await fetch(`/api/business/subscriptions/${sub.id}/record`, {
        method: "POST",
        headers: {},
      });
      const data = (await res.json()) as {
        ok: boolean;
        nextDue?: string;
        sheetSyncWarning?: boolean;
      };
      if (res.ok && data.ok) {
        const msg = data.sheetSyncWarning
          ? "Payment recorded - sheet sync failed, add row manually."
          : "Payment recorded.";
        showToast(msg, data.sheetSyncWarning);
        await load();
      } else {
        showToast("Record failed.", true);
      }
    } finally {
      setRecording(null);
    }
  }

  /**
   * Toggles the isActive flag on a subscription.
   * @param sub - Subscription to toggle.
   */
  async function handleToggleActive(sub: Subscription): Promise<void> {
    await fetch(`/api/business/subscriptions/${sub.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !sub.isActive }),
    });
    await load();
  }

  /**
   * Prompts for confirmation then deletes the subscription.
   * @param sub - Subscription to delete.
   */
  async function handleDelete(sub: Subscription): Promise<void> {
    if (!confirm(`Delete subscription "${sub.description}"?`)) return;
    setDeleting(sub.id);
    try {
      await fetch(`/api/business/subscriptions/${sub.id}`, {
        method: "DELETE",
        headers: {},
      });
      showToast("Deleted.");
      await load();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      {toast && (
        <div
          className={cn(
            "mb-4 rounded-lg px-4 py-2 text-sm font-medium",
            toast.warn
              ? "border border-amber-200 bg-amber-50 text-amber-800"
              : "border border-green-200 bg-green-50 text-green-800",
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Subscriptions</h2>
        {!showForm && (
          <button
            onClick={() => {
              setEditId(null);
              setForm(emptyForm());
              setShowForm(true);
            }}
            className="rounded-lg bg-russian-violet px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Add subscription
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h3 className="mb-4 font-semibold text-slate-700">
            {editId ? "Edit subscription" : "New subscription"}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field
              label="Description"
              htmlFor="sub-description"
              required
              className="col-span-2 sm:col-span-2"
            >
              <input
                id="sub-description"
                required
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className={inputClasses}
              />
            </Field>
            <Field label="Supplier" htmlFor="sub-supplier" required>
              <input
                id="sub-supplier"
                required
                value={form.supplier}
                onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
                className={inputClasses}
              />
            </Field>
            <Field label="Category" htmlFor="sub-category">
              <select
                id="sub-category"
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className={inputClasses}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (incl. GST)" htmlFor="sub-amount" required>
              <input
                id="sub-amount"
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.amountIncl}
                onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
                className={inputClasses}
              />
            </Field>
            <Field label="GST rate" htmlFor="sub-gst">
              <select
                id="sub-gst"
                value={form.gstRate}
                onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
                className={inputClasses}
              >
                <option value="0.15">15%</option>
                <option value="0">No GST</option>
              </select>
            </Field>
            <Field label="Payment method" htmlFor="sub-method">
              <select
                id="sub-method"
                value={form.method}
                onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                className={inputClasses}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frequency" htmlFor="sub-frequency">
              <select
                id="sub-frequency"
                value={form.frequency}
                onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                className={inputClasses}
              >
                {VALID_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={editId ? "Next due" : "First due"} htmlFor="sub-nextdue" required>
              <input
                id="sub-nextdue"
                required
                type="date"
                value={form.nextDue}
                onChange={(e) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
                className={inputClasses}
              />
            </Field>
            <Field label="Notes" htmlFor="sub-notes" optional className="col-span-2 sm:col-span-3">
              <input
                id="sub-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className={inputClasses}
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={saving}>
              {saving ? "Saving..." : editId ? "Update" : "Add"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : subs.length === 0 ? (
        <p className="text-sm text-slate-500">No subscriptions yet.</p>
      ) : (
        <>
          {/* Mobile card list - the desktop table is too wide for phones with
              seven columns including the action buttons. */}
          <div className="space-y-2 lg:hidden">
            {subs.map((sub) => {
              const overdue = sub.isActive && isOverdue(sub.nextDue);
              const dueToday = sub.isActive && isDueToday(sub.nextDue);
              return (
                <div
                  key={sub.id}
                  className={cn(
                    "rounded-xl border border-slate-200 bg-white p-3 shadow-sm",
                    overdue ? "border-amber-300 bg-amber-50" : dueToday ? "bg-amber-50/50" : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {sub.description}
                      </p>
                      <p className="truncate text-xs text-slate-500">{sub.supplier}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-slate-800">
                      {formatNZD(sub.amountIncl)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500 capitalize">{sub.frequency}</span>
                    <span
                      className={cn(
                        overdue
                          ? "font-semibold text-amber-700"
                          : dueToday
                            ? "font-semibold text-amber-600"
                            : "text-slate-500",
                      )}
                    >
                      Due {formatDateShort(sub.nextDue)}
                      {overdue && " (overdue)"}
                    </span>
                    <button
                      onClick={() => {
                        void handleToggleActive(sub);
                      }}
                      className={cn(
                        "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
                        sub.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {sub.isActive ? "Active" : "Paused"}
                    </button>
                  </div>
                  {sub.notes && <p className="mt-1 truncate text-xs text-slate-400">{sub.notes}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        void handleRecord(sub);
                      }}
                      disabled={recording === sub.id}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {recording === sub.id ? "Recording..." : "Record"}
                    </button>
                    <button
                      onClick={() => startEdit(sub)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        void handleDelete(sub);
                      }}
                      disabled={deleting === sub.id}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-3 font-semibold text-slate-600">Description</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Supplier</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Amount</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Frequency</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Next due</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Active</th>
                  <th className="px-4 py-3 font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => {
                  const overdue = sub.isActive && isOverdue(sub.nextDue);
                  const dueToday = sub.isActive && isDueToday(sub.nextDue);
                  return (
                    <tr
                      key={sub.id}
                      className={cn(
                        "border-b border-slate-100 last:border-0",
                        overdue ? "bg-amber-50" : dueToday ? "bg-amber-50/50" : "",
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {sub.description}
                        {sub.notes && (
                          <span className="ml-1 text-xs text-slate-400">({sub.notes})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{sub.supplier}</td>
                      <td className="px-4 py-3 text-slate-800">{formatNZD(sub.amountIncl)}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{sub.frequency}</td>
                      <td
                        className={cn(
                          "px-4 py-3",
                          overdue
                            ? "font-semibold text-amber-700"
                            : dueToday
                              ? "font-semibold text-amber-600"
                              : "text-slate-600",
                        )}
                      >
                        {formatDateShort(sub.nextDue)}
                        {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            void handleToggleActive(sub);
                          }}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            sub.isActive
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {sub.isActive ? "Active" : "Paused"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              void handleRecord(sub);
                            }}
                            disabled={recording === sub.id}
                            className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {recording === sub.id ? "Recording..." : "Record"}
                          </button>
                          <button
                            onClick={() => startEdit(sub)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              void handleDelete(sub);
                            }}
                            disabled={deleting === sub.id}
                            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
