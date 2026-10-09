"use client";
// src/features/business/components/assets/AssetFormModal.tsx
// Add or edit one asset in a dialog. Holds the form state, lays out the name, origin,
// class and disposal sections, and saves through the assets API (POST for a new asset,
// PUT for a saved one); a refusal shows the API's message inline. Mounted fresh per
// target (AssetsView keys it), so the starting values always match what was opened.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Modal } from "@/features/admin/components/ui/Modal";
import { AssetClassFields } from "@/features/business/components/assets/AssetClassFields";
import { AssetDisposalFields } from "@/features/business/components/assets/AssetDisposalFields";
import { AssetOriginFields } from "@/features/business/components/assets/AssetOriginFields";
import {
  formToBody,
  initialForm,
  type AssetFormState,
  type AssetFormTarget,
} from "@/features/business/components/assets/asset-form-state";
import type { ExpenseOption } from "@/features/business/lib/assets";
import type { GstStatus } from "@/features/business/lib/tax";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** Props for {@link AssetFormModal}. */
interface AssetFormModalProps {
  /** The asset to edit, or a new one (maybe filled from an expense). */
  target: AssetFormTarget;
  /** Every expense, with any asset already linked to it. */
  expenseOptions: readonly ExpenseOption[];
  /** Low-value write-off threshold, for the supplier hint. */
  lowValueThreshold: number;
  /** GST registration, for the cost label and hint. */
  gst: GstStatus;
  /** Closes the dialog without saving. */
  onClose: () => void;
  /** Called after a successful save with the confirmation to toast. */
  onSaved: (message: string) => void;
}

/**
 * Line under the dialog title.
 * @param target - What the form works on.
 * @returns Description text, or undefined for an edit.
 */
function formDescription(target: AssetFormTarget): string | undefined {
  if (target.mode === "edit") return undefined;
  return target.prefill
    ? "Filled in from the expense. Pick the asset class, then check the rest."
    : "Something the business uses for more than a year.";
}

/**
 * Asset add/edit dialog.
 * @param props - Component props.
 * @param props.target - The asset to edit, or a new one.
 * @param props.expenseOptions - Every expense with its linked asset.
 * @param props.lowValueThreshold - Low-value write-off threshold.
 * @param props.gst - GST registration status, for the cost label and hint.
 * @param props.onClose - Closes without saving.
 * @param props.onSaved - Called after a save.
 * @returns The dialog.
 */
export function AssetFormModal({
  target,
  expenseOptions,
  lowValueThreshold,
  gst,
  onClose,
  onSaved,
}: AssetFormModalProps): React.ReactElement {
  const [initial] = useState<AssetFormState>(() => initialForm(target));
  const [form, setForm] = useState<AssetFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The alert sits at the foot of a scrolling body, so a save from higher up the form
  // (a phone's usual view) would leave the refusal off screen.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const editing = target.mode === "edit" ? target.asset : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  // Expenses free to link: unlinked ones, plus the one this asset already holds.
  const linkable = expenseOptions.filter(
    (o) => o.linkedAssetId === null || o.linkedAssetId === editing?.id,
  );

  /** Sends the form to the API and reports the outcome. */
  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        editing ? `/api/business/assets/${editing.id}` : "/api/business/assets",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formToBody(form)),
        },
      );
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) onSaved(editing ? "Asset saved." : "Asset added.");
      else setError(d.error ?? "Couldn't save the asset.");
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dirty={dirty && !saving}
      title={editing ? `Edit ${editing.name}` : "Add asset"}
      description={formDescription(target)}
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </AdminButton>
          <AdminButton onClick={() => void save()} busy={saving}>
            {editing ? "Save changes" : "Add asset"}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-5">
        <AdminField
          label="Name"
          htmlFor="asset-name"
          required
          hint="What it is, e.g. Dell laptop or office desk."
        >
          <AdminInput
            id="asset-name"
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </AdminField>
        <AssetOriginFields
          form={form}
          setForm={setForm}
          expenseOptions={linkable}
          lowValueThreshold={lowValueThreshold}
          gst={gst}
        />
        <AssetClassFields form={form} setForm={setForm} />
        <AssetDisposalFields form={form} setForm={setForm} />
        <AdminField label="Notes" htmlFor="asset-notes" optional>
          <AdminTextarea
            id="asset-notes"
            rows={2}
            maxLength={1000}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </AdminField>
        {error && (
          <p ref={errorRef} role="alert" className="text-sm font-bold text-coquelicot-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
