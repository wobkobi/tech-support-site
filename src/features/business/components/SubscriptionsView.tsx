"use client";

import { useState, useEffect, useCallback } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  VALID_FREQUENCIES,
} from "@/features/business/lib/constants";
import type { Subscription } from "@/features/business/types/business";

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
 * Formats an ISO date string as a human-readable NZ date (e.g. "03 May 2026").
 * @param iso - ISO date string
 * @returns Formatted date string
 */
function formatNextDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Returns true if the subscription's next due date is in the past.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is overdue.
 */
function isOverdue(nextDue: string): boolean {
  return new Date(nextDue) < new Date(new Date().toISOString().split("T")[0]);
}

/**
 * Returns true if the subscription's next due date is today.
 * @param nextDue - ISO date string of next due date.
 * @returns Whether the subscription is due today.
 */
function isDueToday(nextDue: string): boolean {
  return nextDue.startsWith(new Date().toISOString().split("T")[0]);
}

/**
 * Subscriptions manager - list, add, edit, record payment, delete.
 * @param root0 - Props
 * @param root0.token - Admin token
 * @returns Subscriptions view element.
 */
export function SubscriptionsView({ token }: { token: string }): React.ReactElement {
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
      const res = await fetch("/api/business/subscriptions", {
        headers: { "x-admin-secret": token },
      });
      const data = (await res.json()) as { ok: boolean; subscriptions: Subscription[] };
      if (data.ok) setSubs(data.subscriptions);
    } finally {
      setLoading(false);
    }
  }, [token]);

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
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editId ? `/api/business/subscriptions/${editId}` : "/api/business/subscriptions";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "x-admin-secret": token, "content-type": "application/json" },
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
        headers: { "x-admin-secret": token },
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
      headers: { "x-admin-secret": token, "content-type": "application/json" },
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
        headers: { "x-admin-secret": token },
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

      <div className={cn("mb-4 flex items-center justify-between")}>
        <h2 className={cn("text-lg font-bold text-slate-800")}>Subscriptions</h2>
        {!showForm && (
          <button
            onClick={() => {
              setEditId(null);
              setForm(emptyForm());
              setShowForm(true);
            }}
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90",
            )}
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
          className={cn("mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
        >
          <h3 className={cn("mb-4 font-semibold text-slate-700")}>
            {editId ? "Edit subscription" : "New subscription"}
          </h3>
          <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3")}>
            <div className="col-span-2 sm:col-span-2">
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Description
              </label>
              <input
                required
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Supplier
              </label>
              <input
                required
                value={form.supplier}
                onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Amount (incl. GST)
              </label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.amountIncl}
                onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                GST rate
              </label>
              <select
                value={form.gstRate}
                onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              >
                <option value="0.15">15%</option>
                <option value="0">No GST</option>
              </select>
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Payment method
              </label>
              <select
                value={form.method}
                onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                Frequency
              </label>
              <select
                value={form.frequency}
                onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              >
                {VALID_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                {editId ? "Next due" : "First due"}
              </label>
              <input
                required
                type="date"
                value={form.nextDue}
                onChange={(e) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
          </div>
          <div className={cn("mt-4 flex gap-2")}>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
              )}
            >
              {saving ? "Saving..." : editId ? "Update" : "Add"}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className={cn(
                "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50",
              )}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className={cn("text-sm text-slate-500")}>Loading...</p>
      ) : subs.length === 0 ? (
        <p className={cn("text-sm text-slate-500")}>No subscriptions yet.</p>
      ) : (
        <div
          className={cn("overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm")}
        >
          <table className={cn("w-full text-sm")}>
            <thead>
              <tr className={cn("border-b border-slate-100 bg-slate-50 text-left")}>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Description</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Supplier</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Amount</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Frequency</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Next due</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Active</th>
                <th className={cn("px-4 py-3 font-semibold text-slate-600")}>Actions</th>
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
                    <td className={cn("px-4 py-3 font-medium text-slate-800")}>
                      {sub.description}
                      {sub.notes && (
                        <span className={cn("ml-1 text-xs text-slate-400")}>({sub.notes})</span>
                      )}
                    </td>
                    <td className={cn("px-4 py-3 text-slate-600")}>{sub.supplier}</td>
                    <td className={cn("px-4 py-3 text-slate-800")}>{formatNZD(sub.amountIncl)}</td>
                    <td className={cn("px-4 py-3 capitalize text-slate-600")}>{sub.frequency}</td>
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
                      {formatNextDue(sub.nextDue)}
                      {overdue && <span className={cn("ml-1 text-xs")}>(overdue)</span>}
                    </td>
                    <td className={cn("px-4 py-3")}>
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
                    <td className={cn("px-4 py-3")}>
                      <div className={cn("flex gap-2")}>
                        <button
                          onClick={() => {
                            void handleRecord(sub);
                          }}
                          disabled={recording === sub.id}
                          className={cn(
                            "rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50",
                          )}
                        >
                          {recording === sub.id ? "Recording..." : "Record"}
                        </button>
                        <button
                          onClick={() => startEdit(sub)}
                          className={cn(
                            "rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            void handleDelete(sub);
                          }}
                          disabled={deleting === sub.id}
                          className={cn(
                            "rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50",
                          )}
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
      )}
    </div>
  );
}
