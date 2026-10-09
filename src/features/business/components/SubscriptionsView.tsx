"use client";
// src/features/business/components/SubscriptionsView.tsx
// Records and lists recurring subscription expenses (description, supplier, amount, GST,
// frequency, next due) and flags overdue ones. The rows render in SubscriptionsListRows.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  SubscriptionsListCards,
  SubscriptionsListTable,
} from "@/features/business/components/SubscriptionsListRows";
import { todayISO } from "@/features/business/lib/business";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  VALID_FREQUENCIES,
} from "@/features/business/lib/constants";
import type { Subscription } from "@/features/business/types/business";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

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
 * Subscriptions manager - list, add, edit, record payment, delete.
 * @param props - Component props.
 * @param props.reloadKey - Bumped by the parent to force a reload (e.g. after an expense migrate).
 * @returns Subscriptions view element.
 */
export function SubscriptionsView({ reloadKey = 0 }: { reloadKey?: number }): React.ReactElement {
  const { toast } = useToast();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load shows a Try again banner, not "No subscriptions yet."
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteSub, setConfirmDeleteSub] = useState<Subscription | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/business/subscriptions");
      const data = (await res.json()) as { ok: boolean; subscriptions: Subscription[] };
      if (!data.ok) throw new Error(`subscriptions load failed (${res.status})`);
      setSubs(data.subscriptions);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, reloadKey]);

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
      nextDue: sub.nextDue.split("T")[0] ?? "",
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
        toast(editId ? "Subscription updated." : "Subscription added.", { tone: "success" });
        cancelForm();
        await load();
      } else {
        toast("Save failed.", { tone: "error" });
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
      });
      const data = (await res.json()) as {
        ok: boolean;
        nextDue?: string;
        sheetSyncWarning?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        const msg = data.sheetSyncWarning
          ? "Payment recorded - sheet sync failed, add row manually."
          : "Payment recorded.";
        toast(msg, { tone: data.sheetSyncWarning ? "warning" : "success" });
        await load();
      } else {
        // A 409 means the period was already claimed (cron got there first, or a
        // double click), so show the server's wording rather than "failed".
        toast(data.error ?? "Record failed.", { tone: "error" });
        if (res.status === 409) await load();
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
    setConfirmDeleteSub(null);
    setDeleting(sub.id);
    try {
      await fetch(`/api/business/subscriptions/${sub.id}`, {
        method: "DELETE",
      });
      toast("Deleted.", { tone: "success" });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-admin-text">Subscriptions</h2>
        {!showForm && (
          <AdminButton
            variant="outline"
            onClick={() => {
              setEditId(null);
              setForm(emptyForm());
              setShowForm(true);
            }}
          >
            + Add subscription
          </AdminButton>
        )}
      </div>

      {showForm && (
        <Card className="mb-6">
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
          >
            <h3 className="mb-4 text-base font-bold text-admin-text">
              {editId ? "Edit subscription" : "New subscription"}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <AdminField
                label="Description"
                htmlFor="sub-description"
                required
                className="col-span-2 sm:col-span-2"
              >
                <AdminInput
                  id="sub-description"
                  required
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                />
              </AdminField>
              <AdminField label="Supplier" htmlFor="sub-supplier" required>
                <AdminInput
                  id="sub-supplier"
                  required
                  value={form.supplier}
                  onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
                />
              </AdminField>
              <AdminField label="Category" htmlFor="sub-category">
                <AdminSelect
                  id="sub-category"
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
              <AdminField label="Amount (incl. GST)" htmlFor="sub-amount" required>
                <AdminInput
                  id="sub-amount"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amountIncl}
                  onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
                />
              </AdminField>
              <AdminField label="GST rate" htmlFor="sub-gst">
                <AdminSelect
                  id="sub-gst"
                  value={form.gstRate}
                  onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
                >
                  <option value="0.15">15%</option>
                  <option value="0">No GST</option>
                </AdminSelect>
              </AdminField>
              <AdminField label="Payment method" htmlFor="sub-method">
                <AdminSelect
                  id="sub-method"
                  value={form.method}
                  onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
              <AdminField label="Frequency" htmlFor="sub-frequency">
                <AdminSelect
                  id="sub-frequency"
                  value={form.frequency}
                  onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                >
                  {VALID_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
              <AdminField label={editId ? "Next due" : "First due"} htmlFor="sub-nextdue" required>
                <AdminInput
                  id="sub-nextdue"
                  required
                  type="date"
                  value={form.nextDue}
                  onChange={(e) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
                />
              </AdminField>
              <AdminField
                label="Notes"
                htmlFor="sub-notes"
                optional
                className="col-span-2 sm:col-span-3"
              >
                <AdminInput
                  id="sub-notes"
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </AdminField>
            </div>
            {/* Outline, not primary: the expense form above holds the page's one primary. */}
            <div className="mt-4 flex gap-2">
              <AdminButton type="submit" variant="outline" disabled={saving}>
                {saving ? "Saving..." : editId ? "Update" : "Add"}
              </AdminButton>
              <AdminButton type="button" variant="ghost" onClick={cancelForm}>
                Cancel
              </AdminButton>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-sm text-admin-muted">Loading...</p>
        </Card>
      ) : loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>Couldn&apos;t load your subscriptions. Try again, or come back later.</span>
          <AdminButton variant="secondary" onClick={() => void load()}>
            Try again
          </AdminButton>
        </div>
      ) : subs.length === 0 ? (
        <Card padding="none">
          <EmptyState title="No subscriptions yet." />
        </Card>
      ) : (
        <>
          <SubscriptionsListCards
            subs={subs}
            recording={recording}
            deleting={deleting}
            onRecord={(sub) => void handleRecord(sub)}
            onToggleActive={(sub) => void handleToggleActive(sub)}
            onEdit={startEdit}
            onDelete={setConfirmDeleteSub}
          />
          <SubscriptionsListTable
            subs={subs}
            recording={recording}
            deleting={deleting}
            onRecord={(sub) => void handleRecord(sub)}
            onToggleActive={(sub) => void handleToggleActive(sub)}
            onEdit={startEdit}
            onDelete={setConfirmDeleteSub}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteSub !== null}
        title="Delete subscription?"
        body={
          confirmDeleteSub
            ? `Delete "${confirmDeleteSub.description}"? This stops future reminders; recorded payments stay on the ledger.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => confirmDeleteSub && void handleDelete(confirmDeleteSub)}
        onCancel={() => setConfirmDeleteSub(null)}
      />
    </div>
  );
}
