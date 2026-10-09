"use client";
// src/features/business/components/ExpenseForm.tsx
// The expenses ledger's add/edit form with its live GST split preview. Controlled:
// ExpensesView owns the form state, the submit and the phone fold-away.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { CardHeader } from "@/features/admin/components/ui/Card";
import { formatNZD } from "@/features/business/lib/business";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/features/business/lib/constants";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** The form's field values, as typed (numbers stay strings until submit). */
export interface ExpenseFormState {
  date: string;
  supplier: string;
  description: string;
  category: string;
  amountIncl: string;
  gstRate: string;
  method: string;
  receipt: boolean;
  notes: string;
}

/** Props for {@link ExpenseForm}. */
interface ExpenseFormProps {
  /** Ref the parent scrolls into view when an edit starts. */
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Phones only: false folds the form away (lg+ always shows it). */
  formOpen: boolean;
  /** Id of the entry being edited, or null when adding. */
  editingId: string | null;
  form: ExpenseFormState;
  setForm: React.Dispatch<React.SetStateAction<ExpenseFormState>>;
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  /** Leaves edit mode, or folds the form away on phones. */
  onCancel: () => void;
  saving: boolean;
  formError: string | null;
  /** Parsed GST-inclusive amount, for the preview. */
  inclNum: number;
  /** Parsed GST rate, for the preview. */
  rate: number;
  /** GST portion of `inclNum` at `rate`. */
  previewGst: number;
}

/**
 * Renders the add/edit expense form.
 * @param props - Component props.
 * @param props.formRef - Ref on the form element.
 * @param props.formOpen - Whether the form is open on phones.
 * @param props.editingId - Entry being edited, or null.
 * @param props.form - Field values.
 * @param props.setForm - Field value setter.
 * @param props.onSubmit - Submit handler.
 * @param props.onCancel - Cancel handler.
 * @param props.saving - Whether a save is in flight.
 * @param props.formError - Save error to show, or null.
 * @param props.inclNum - Parsed GST-inclusive amount.
 * @param props.rate - Parsed GST rate.
 * @param props.previewGst - GST portion for the preview.
 * @returns The form element.
 */
export function ExpenseForm({
  formRef,
  formOpen,
  editingId,
  form,
  setForm,
  onSubmit,
  onCancel,
  saving,
  formError,
  inclNum,
  rate,
  previewGst,
}: ExpenseFormProps): React.ReactElement {
  return (
    // The Card look sits on the form itself so the edit scroll lands on its top edge.
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className={cn(
        "mb-6 rounded-lg border border-admin-border bg-admin-surface p-4 sm:p-5",
        !formOpen && "max-lg:hidden",
      )}
    >
      <CardHeader title={editingId ? "Edit expense" : "Add expense"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="Date" htmlFor="exp-date" required>
          <AdminInput
            id="exp-date"
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
          />
        </AdminField>
        <AdminField label="Supplier" htmlFor="exp-supplier" required>
          <AdminInput
            id="exp-supplier"
            type="text"
            required
            value={form.supplier}
            onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
          />
        </AdminField>
        <AdminField label="Description" htmlFor="exp-description" required>
          <AdminInput
            id="exp-description"
            type="text"
            required
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
        </AdminField>
        <AdminField label="Category" htmlFor="exp-category">
          <AdminSelect
            id="exp-category"
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField label="Amount incl. GST" htmlFor="exp-amount" required>
          <AdminInput
            id="exp-amount"
            type="number"
            required
            min="0"
            step="0.01"
            value={form.amountIncl}
            onChange={(e) => setForm((p) => ({ ...p, amountIncl: e.target.value }))}
          />
        </AdminField>
        <AdminField label="GST rate" htmlFor="exp-gst">
          <AdminSelect
            id="exp-gst"
            value={form.gstRate}
            onChange={(e) => setForm((p) => ({ ...p, gstRate: e.target.value }))}
          >
            <option value="0.15">15%</option>
            <option value="0">0% (no GST)</option>
          </AdminSelect>
          {inclNum > 0 && rate > 0 && (
            <p className="mt-1 text-sm text-admin-muted">
              GST: {formatNZD(previewGst)} | Excl: {formatNZD(inclNum - previewGst)}
            </p>
          )}
        </AdminField>
        <AdminField label="Payment method" htmlFor="exp-method">
          <AdminSelect
            id="exp-method"
            value={form.method}
            onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField label="Notes" htmlFor="exp-notes" optional>
          <AdminInput
            id="exp-notes"
            type="text"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </AdminField>
        <AdminCheckbox
          checked={form.receipt}
          onChange={(receipt) => setForm((p) => ({ ...p, receipt }))}
          label="Receipt held"
        />
      </div>
      {formError && <p className="mt-2 text-sm text-coquelicot-600">{formError}</p>}
      <div className="mt-4 flex items-center gap-3">
        <AdminButton type="submit" busy={saving}>
          {editingId ? "Save changes" : "Add expense"}
        </AdminButton>
        {editingId ? (
          <AdminButton type="button" variant="ghost" onClick={onCancel}>
            Cancel edit
          </AdminButton>
        ) : (
          <AdminButton type="button" variant="ghost" onClick={onCancel} className="lg:hidden">
            Cancel
          </AdminButton>
        )}
      </div>
    </form>
  );
}
