"use client";
// src/features/business/components/invoice/EditInvoiceView.tsx
/**
 * @description DRAFT-invoice editor: {@link InvoiceForm} on the left, a live
 * {@link InvoicePreviewPanel} (real invoice number, sticky on lg+) on the right.
 * Submitting PATCHes the full-update branch of /api/business/invoices/[id] (which
 * re-validates line items, recomputes totals with the preserved discounts, and
 * re-syncs the Drive PDF), then routes back to the detail page.
 */

import { useToast } from "@/features/admin/components/ui/Toast";
import {
  InvoiceForm,
  type InvoiceFormData,
  type PreservedDiscounts,
} from "@/features/business/components/invoice/InvoiceForm";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link EditInvoiceView}. */
interface EditInvoiceViewProps {
  invoiceId: string;
  /** Real invoice number, shown on the preview. */
  invoiceNumber: string;
  /** Initial form values (dates already ISO YYYY-MM-DD). */
  initial: InvoiceFormData;
  /** Discounts preserved from creation - shown in totals/preview, not editable. */
  preservedDiscounts: PreservedDiscounts;
  /** Live business identity for the preview. */
  identity: IdentitySettings;
  /** Live GST-registration flag. */
  gstRegistered: boolean;
  /** Net payment terms in days. */
  paymentTermsDays: number;
}

/**
 * DRAFT invoice edit view (form + live preview).
 * @param props - Component props.
 * @param props.invoiceId - Invoice id to PATCH.
 * @param props.invoiceNumber - Real invoice number for the preview.
 * @param props.initial - Initial form values.
 * @param props.preservedDiscounts - Preserved discount snapshot.
 * @param props.identity - Live business identity for the preview.
 * @param props.gstRegistered - Live GST-registration flag.
 * @param props.paymentTermsDays - Net payment terms in days.
 * @returns The edit view element.
 */
export function EditInvoiceView({
  invoiceId,
  invoiceNumber,
  initial,
  preservedDiscounts,
  identity,
  gstRegistered,
  paymentTermsDays,
}: EditInvoiceViewProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // Mirror of the form data so the preview updates as the operator types.
  const [preview, setPreview] = useState<InvoiceFormData>(initial);

  /**
   * PATCHes the full-update branch, then routes back to the detail page.
   * @param data - Validated form data.
   */
  async function handleSubmit(data: InvoiceFormData): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          lineItems: data.lineItems,
          notes: data.notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't save changes.", { tone: "error" });
        setBusy(false);
        return;
      }
      toast(`Invoice ${invoiceNumber} updated.`, { tone: "success" });
      router.push(`/admin/business/invoices/${invoiceId}`);
    } catch {
      toast("Couldn't save changes. Check your connection.", { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="max-w-7xl lg:grid lg:grid-cols-[minmax(20rem,1fr)_minmax(24rem,36rem)] lg:items-start lg:gap-8">
      <div className="min-w-0">
        <InvoiceForm
          initial={initial}
          preservedDiscounts={preservedDiscounts}
          gstRegistered={gstRegistered}
          paymentTermsDays={paymentTermsDays}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(data) => void handleSubmit(data)}
          onChange={setPreview}
        />
      </div>
      <div className="mt-6 lg:mt-0">
        <InvoicePreviewPanel
          identity={identity}
          number={invoiceNumber}
          clientName={preview.clientName}
          clientEmail={preview.clientEmail}
          issueDate={preview.issueDate}
          dueDate={preview.dueDate}
          lineItems={preview.lineItems}
          notes={preview.notes}
          promoTitle={preservedDiscounts.promoTitle ?? null}
          promoDiscount={preservedDiscounts.promoDiscount ?? 0}
          unsuccessfulDiscount={preservedDiscounts.unsuccessfulDiscount ?? 0}
          gstRegistered={gstRegistered}
        />
      </div>
    </div>
  );
}
