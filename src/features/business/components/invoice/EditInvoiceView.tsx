"use client";
// src/features/business/components/invoice/EditInvoiceView.tsx
// DRAFT-invoice editor: form plus live preview. Submitting PATCHes the full update of
// /api/business/invoices/[id], then routes back to the detail page.

import { useToast } from "@/features/admin/components/ui/Toast";
import {
  InvoiceAiBox,
  type InvoiceAiContext,
} from "@/features/business/components/invoice/InvoiceAiBox";
import {
  InvoiceForm,
  type InvoiceFormData,
  type PreservedDiscounts,
} from "@/features/business/components/invoice/InvoiceForm";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import { alreadyPaidAmount } from "@/features/business/lib/already-paid-input";
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
  /** Discounts from creation; only an AI box rebuild re-prices them. */
  preservedDiscounts: PreservedDiscounts;
  /** Live business identity for the preview. */
  identity: IdentitySettings;
  /** Live GST-registration flag. */
  gstRegistered: boolean;
  /** Net payment terms in days. */
  paymentTermsDays: number;
  /** Booking and pricing context for the "Describe the job" box. */
  aiContext: InvoiceAiContext;
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
 * @param props.aiContext - Booking and pricing context for the AI box.
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
  aiContext,
}: EditInvoiceViewProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // Mirror of the form data so the preview updates as the operator types.
  const [preview, setPreview] = useState<InvoiceFormData>(initial);
  const [discounts, setDiscounts] = useState<PreservedDiscounts>(preservedDiscounts);
  // The lines the discounts were last worked out on: the saved ones, then each AI rebuild.
  const [pricedLines, setPricedLines] = useState(initial.lineItems);
  // Only sent when the AI box re-priced them, so a hand edit never rewrites the stored ones.
  const unsuccessfulChanged =
    (discounts.unsuccessfulDiscount ?? 0) !== (preservedDiscounts.unsuccessfulDiscount ?? 0);
  const promoChanged = (discounts.promoDiscount ?? 0) !== (preservedDiscounts.promoDiscount ?? 0);
  // Saved lines carry no rate tags, so a hand edit can't re-price the discounts; warn.
  const discountsStale =
    ((discounts.promoDiscount ?? 0) > 0 || (discounts.unsuccessfulDiscount ?? 0) > 0) &&
    JSON.stringify(preview.lineItems) !== JSON.stringify(pricedLines);

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
          // Null clears a part payment and removes its income entry.
          alreadyPaid: alreadyPaidAmount(data.alreadyPaid) || null,
          alreadyPaidMethod: data.alreadyPaid.method,
          ...(unsuccessfulChanged && { unsuccessfulDiscount: discounts.unsuccessfulDiscount ?? 0 }),
          ...(promoChanged && { promoDiscount: discounts.promoDiscount ?? 0 }),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't save changes.", { tone: "error" });
        setBusy(false);
        return;
      }
      toast(`Invoice ${invoiceNumber} updated.`, { tone: "success" });
      if (d.incomeSheetWarning) {
        // The sheet wins on the next import, so the row there has to be fixed by hand.
        toast(
          "Saved, but the Cashbook sheet didn't update for the already-paid amount. Fix that row in the sheet, or the next import puts the old one back.",
          { tone: "warning" },
        );
      }
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
          preservedDiscounts={discounts}
          discountNote={
            discountsStale
              ? "The discounts were worked out on the lines before your edits. Describe the job above to re-price them."
              : null
          }
          gstRegistered={gstRegistered}
          paymentTermsDays={paymentTermsDays}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(data) => void handleSubmit(data)}
          onChange={setPreview}
          renderAssist={(form, apply) => (
            <InvoiceAiBox
              context={aiContext}
              currentItems={form.lineItems}
              disabled={busy}
              // Parsed notes fill only an empty field; a stated cash amount fills Already paid.
              onApply={(lineItems, notes, cashPaid, repriced) => {
                setDiscounts((d) => ({ ...d, ...repriced }));
                setPricedLines(lineItems);
                apply({
                  lineItems,
                  ...(notes && !form.notes.trim() && { notes }),
                  ...(cashPaid && { alreadyPaid: { amount: cashPaid.toFixed(2), method: "Cash" } }),
                });
              }}
            />
          )}
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
          promoDiscount={discounts.promoDiscount ?? 0}
          unsuccessfulDiscount={discounts.unsuccessfulDiscount ?? 0}
          gstRegistered={gstRegistered}
          alreadyPaid={alreadyPaidAmount(preview.alreadyPaid)}
        />
      </div>
    </div>
  );
}
