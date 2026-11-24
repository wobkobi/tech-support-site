"use client";
// src/app/admin/(shell)/business/invoices/[id]/InvoiceActions.tsx
// Action buttons and modals for the invoice detail page (PDF, payment, send, text, void,
// change, re-issue, delete, edit details). Below lg, unpaid invoices pin Mark as paid, Text
// and Send to the screen bottom.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  type LikelyIncome,
  PaymentDialog,
} from "@/features/business/components/invoice/PaymentDialog";
import { reissueHref } from "@/features/business/lib/invoice-reissue";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { SendInvoiceModal, useInvoiceSend } from "./SendInvoiceModal";
import { TextInvoiceModal } from "./TextInvoiceModal";
import { type LinkedIncome, useInvoiceVoid, VoidInvoiceModal } from "./VoidInvoiceModal";

interface InvoiceActionsProps {
  driveWebUrl: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  /** Client mobile as displayed (local format), or "". Editable via "Edit details". */
  clientPhone: string;
  status: string;
  /** What the client still owes (total less any already-paid amount), for {@link PaymentDialog}. */
  balance: number;
  /** Whether a linked income entry records the balance payment (not the already-paid one). */
  hasPaymentIncome: boolean;
  /** Current notes; edited in place via the "Edit details" modal (SENT/PAID). */
  notes: string | null;
  /** First-sent stamp; drives the "Re-send" label. */
  sentAt?: string | null;
  /** Payment stamp; passed to {@link PaymentDialog}. */
  paidAt?: string | null;
  /** Linked income entries - shown as a pre-flight warning in the void modal. */
  linkedIncome: LinkedIncome;
  /** When true, open the send preview once on mount (calculator "Save & send"). */
  autoOpenSend?: boolean;
  /** True when the invoice is SENT and past due - gates the Send reminder action. */
  isOverdue?: boolean;
  /** Reminders already sent (null reads as 0); shown in the confirm copy. */
  reminderCount?: number | null;
  /** Last reminder stamp; passed to {@link PaymentDialog} to offer the apology. */
  reminderLastSentAt?: string | null;
  /** Apology stamp; passed to {@link PaymentDialog} so it can't be sent twice. */
  apologySentAt?: string | null;
  /** Unlinked income row that looks like this invoice's payment, offered for linking. */
  likelyIncome?: LikelyIncome | null;
  /** True when the row is a quote - swaps email copy, hides payment actions, adds Convert. */
  isQuote?: boolean;
  /** Live invoice that replaced this voided one; hides Re-issue and Resend void notification. */
  replacedBy?: { id: string; number: string } | null;
}

/** Static JSON request headers. */
const headers = { "Content-Type": "application/json" };

/**
 * Action buttons + modals for an invoice detail page.
 * @param props - Component props.
 * @param props.driveWebUrl - Optional Google Drive PDF URL.
 * @param props.invoiceId - Invoice id used by the preview/send/void/pay routes.
 * @param props.invoiceNumber - Filename for the downloaded PDF + email subjects.
 * @param props.clientName - Used in the greeting + "add to contacts" hook.
 * @param props.clientEmail - Recipient; "Send" is disabled when empty.
 * @param props.clientPhone - Client mobile as displayed, edited via the details modal.
 * @param props.status - Current invoice status (drives which actions show).
 * @param props.balance - Balance due, passed to the payment dialog.
 * @param props.hasPaymentIncome - Whether the balance payment already has an income entry.
 * @param props.notes - Current notes, edited via the details modal (SENT/PAID).
 * @param props.sentAt - First-sent stamp; drives the Send/Re-send label.
 * @param props.paidAt - Payment stamp, passed to the payment dialog.
 * @param props.linkedIncome - Linked income count + total for the void warning.
 * @param props.autoOpenSend - Open the send preview on mount when true (the Text modal when
 *   there's no email).
 * @param props.isOverdue - Whether the invoice is SENT and past due.
 * @param props.reminderCount - Reminders already sent (null reads as 0).
 * @param props.reminderLastSentAt - Last reminder stamp, passed to the payment dialog.
 * @param props.apologySentAt - Apology stamp, passed to the payment dialog.
 * @param props.likelyIncome - Unlinked income row matching this invoice, passed to the payment dialog.
 * @param props.isQuote - Whether the row is a quote.
 * @param props.replacedBy - Live replacement of this voided invoice, or null.
 * @returns Invoice actions element with its modals.
 */
export function InvoiceActions({
  driveWebUrl,
  invoiceId,
  invoiceNumber,
  clientName,
  clientEmail,
  clientPhone,
  status,
  balance,
  hasPaymentIncome,
  notes,
  sentAt,
  paidAt,
  linkedIncome,
  autoOpenSend = false,
  isOverdue = false,
  reminderCount = null,
  reminderLastSentAt = null,
  apologySentAt = null,
  likelyIncome = null,
  isQuote = false,
  replacedBy = null,
}: InvoiceActionsProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  // Action busy flags
  const [deleting, setDeleting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const sendFlow = useInvoiceSend({
    invoiceId,
    invoiceNumber,
    clientName,
    clientEmail,
    isQuote,
    sentAt,
    autoOpenSend,
  });
  const voidFlow = useInvoiceVoid({
    invoiceId,
    clientEmail,
    /** Flip the local status so the action row re-renders as VOIDED. */
    onVoided: () => {
      setCurrentStatus("VOIDED");
    },
  });
  const { voiding } = voidFlow;
  // Convert-to-invoice confirm + busy flags.
  const [converting, setConverting] = useState(false);
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);

  // Confirm dialog (replacing window.confirm) + record-payment dialog.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // Overdue-reminder confirm + busy state.
  const [confirmReminderOpen, setConfirmReminderOpen] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  // Text modal; the key remounts it per open, so each open writes a fresh message. "Save &
  // send" for a client with no email lands here instead of on the email preview.
  const [textOpen, setTextOpen] = useState(
    () => autoOpenSend && !clientEmail && status !== "VOIDED",
  );
  const [textKey, setTextKey] = useState(0);

  // Drop ?send=1 once it has done its job, so a reload or the app's resume can't reopen it.
  const pathname = usePathname();
  useEffect(() => {
    if (autoOpenSend) router.replace(pathname, { scroll: false });
  }, [autoOpenSend, pathname, router]);

  // Edit-details modal (SENT/PAID): client details and notes stay editable post-send.
  const savedDetails = {
    name: clientName,
    email: clientEmail,
    phone: clientPhone,
    notes: notes ?? "",
  };
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState(savedDetails);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const detailsDirty = (Object.keys(savedDetails) as (keyof typeof savedDetails)[]).some(
    (k) => detailsDraft[k].trim() !== savedDetails[k].trim(),
  );

  // "Change invoice": silent void, then the calculator re-issue.
  const [confirmChangeOpen, setConfirmChangeOpen] = useState(false);
  const [changing, setChanging] = useState(false);

  const alreadySent = currentStatus === "SENT" || sendFlow.sentLocal;
  const isPaid = currentStatus === "PAID";
  const isDraft = currentStatus === "DRAFT";
  const isVoided = currentStatus === "VOIDED";
  // Paid and voided invoices have nothing left to chase, so their buttons stay in the row.
  const showPhoneBar = !isPaid && !isVoided;

  /**
   * Downloads the real branded PDF (same renderer as Drive and email).
   */
  async function downloadPdf(): Promise<void> {
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/pdf`, { headers });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Could not download PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice ${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not download PDF", { tone: "error" });
    }
  }

  /**
   * Sends an overdue reminder (same as the cron) and refreshes.
   */
  async function sendReminder(): Promise<void> {
    setSendingReminder(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/send-reminder`, {
        method: "POST",
        headers,
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reminderNumber?: number;
        error?: string;
      };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Reminder failed");
      toast(`Reminder sent to ${clientName || "client"}.`, { tone: "success" });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send reminder", { tone: "error" });
    } finally {
      setSendingReminder(false);
      setConfirmReminderOpen(false);
    }
  }

  /** DRAFT-only delete: DELETEs the invoice, redirects to the list. */
  async function deleteDraft(): Promise<void> {
    setDeleting(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, { method: "DELETE", headers });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        incomeSheetWarning?: boolean;
      };
      if (!res.ok) throw new Error(d.error ?? "Delete failed");
      // The already-paid row is still in the Cashbook sheet, which wins on import.
      if (d.incomeSheetWarning) {
        toast(
          "Draft deleted, but its already-paid row is still in the Cashbook sheet. Delete it there, or it stays in income.",
          { tone: "warning" },
        );
      }
      router.push("/admin/business/invoices");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", { tone: "error" });
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  /**
   * Promotes the quote to an invoice: next TTP number, dates restamped from today.
   */
  async function convertToInvoice(): Promise<void> {
    setConverting(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/convert`, {
        method: "POST",
        headers,
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        invoice?: { number: string };
        error?: string;
      };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Convert failed");
      toast(`Quote converted to invoice ${d.invoice?.number ?? ""}.`, { tone: "success" });
      setConfirmConvertOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not convert", { tone: "error" });
    } finally {
      setConverting(false);
    }
  }

  /**
   * Saves the details modal (SENT/PAID) via the sparse PATCH: only changed fields are sent,
   * so an untouched phone on an imported invoice can't fail validation.
   */
  async function saveDetails(): Promise<void> {
    const draft = {
      name: detailsDraft.name.trim(),
      email: detailsDraft.email.trim(),
      phone: detailsDraft.phone.trim(),
      notes: detailsDraft.notes.trim(),
    };
    const body: Record<string, string | null> = {};
    if (draft.name !== savedDetails.name.trim()) body.clientName = draft.name;
    if (draft.email !== savedDetails.email.trim()) body.clientEmail = draft.email;
    if (draft.phone !== savedDetails.phone.trim()) body.clientPhone = draft.phone;
    if (draft.notes !== savedDetails.notes.trim()) body.notes = draft.notes || null;
    if (Object.keys(body).length === 0) {
      setDetailsOpen(false);
      return;
    }
    setDetailsSaving(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't save the changes.", { tone: "error" });
        setDetailsSaving(false);
        return;
      }
      setDetailsOpen(false);
      setDetailsSaving(false);
      toast(
        isPaid
          ? "Saved. The PDF is updated."
          : "Saved. The PDF is updated - Re-send if they need the corrected copy.",
        { tone: "success" },
      );
      router.refresh();
    } catch {
      toast("Couldn't save the changes. Check your connection.", { tone: "error" });
      setDetailsSaving(false);
    }
  }

  /**
   * Voids the invoice without emailing the client, then opens the calculator re-issue. The
   * replacement's email names this invoice as the one it replaces, so one email covers both.
   */
  async function changeInvoice(): Promise<void> {
    setChanging(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/void`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sendNotification: false }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Could not void the invoice");
      setCurrentStatus("VOIDED");
      router.push(reissueHref(invoiceId));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not void the invoice", { tone: "error" });
      setChanging(false);
      setConfirmChangeOpen(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <AdminButton variant="secondary" onClick={() => void downloadPdf()}>
          Save PDF
        </AdminButton>
        {driveWebUrl && (
          <AdminButton variant="secondary" href={driveWebUrl}>
            View PDF in Drive ↗
          </AdminButton>
        )}
        {isDraft && (
          <AdminButton variant="secondary" href={`/admin/business/invoices/${invoiceId}/edit`}>
            Edit
          </AdminButton>
        )}
        {!isDraft && !isVoided && (
          <AdminButton
            variant="secondary"
            onClick={() => {
              setDetailsDraft(savedDetails);
              setDetailsOpen(true);
            }}
          >
            Edit details
          </AdminButton>
        )}
        {!isDraft && !isPaid && !isVoided && !isQuote && (
          <AdminButton
            variant="secondary"
            onClick={() => setConfirmChangeOpen(true)}
            busy={changing}
          >
            Change invoice
          </AdminButton>
        )}
        {isDraft && (
          <AdminButton variant="danger" onClick={() => setConfirmDeleteOpen(true)} busy={deleting}>
            {isQuote ? "Delete quote" : "Delete draft"}
          </AdminButton>
        )}
        {!isDraft && !isPaid && !isVoided && (
          <AdminButton variant="secondary" onClick={voidFlow.openVoidModal} busy={voiding}>
            {isQuote ? "Void quote" : "Void invoice"}
          </AdminButton>
        )}
        {/* Once replaced, "nothing to pay" would be wrong and a second re-issue double-bills. */}
        {isVoided && clientEmail && !replacedBy && (
          <AdminButton variant="secondary" onClick={voidFlow.resendVoidNotification} busy={voiding}>
            Resend void notification
          </AdminButton>
        )}
        {/* Nothing is saved until the calculator saves, so no confirm is needed. */}
        {isVoided && !isQuote && !replacedBy && (
          <Link href={reissueHref(invoiceId)} className={adminButtonClass({})}>
            Re-issue in calculator
          </Link>
        )}
        {isVoided && replacedBy && (
          <Link
            href={`/admin/business/invoices/${replacedBy.id}`}
            className={adminButtonClass({ variant: "secondary" })}
          >
            Replaced by {replacedBy.number}
          </Link>
        )}
        {isOverdue && !isPaid && !isVoided && clientEmail && (
          <AdminButton
            variant="secondary"
            onClick={() => setConfirmReminderOpen(true)}
            busy={sendingReminder}
          >
            Send reminder
          </AdminButton>
        )}
        {isPaid && !paidAt && (
          // Legacy PAID row with no recorded date/method - let the operator backfill.
          <AdminButton variant="secondary" onClick={() => setPayOpen(true)}>
            Record payment details
          </AdminButton>
        )}
        {/* The phone bar; on lg `contents` drops the wrapper so the buttons join the row. */}
        <div
          data-phone-bar={showPhoneBar ? "fixed" : undefined}
          className={
            showPhoneBar
              ? "fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-admin-border bg-admin-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-6 lg:contents"
              : "contents"
          }
        >
          {!isPaid && !isVoided && !isQuote && (
            <AdminButton
              variant="secondary"
              onClick={() => setPayOpen(true)}
              className="max-lg:flex-1"
            >
              Mark as paid
            </AdminButton>
          )}
          {isQuote && !isVoided && (
            <AdminButton
              onClick={() => setConfirmConvertOpen(true)}
              busy={converting}
              className="max-lg:flex-1"
            >
              {/* One span, so the button's flex gap can't widen the word space. */}
              <span>
                Convert<span className="max-sm:hidden"> to invoice</span>
              </span>
            </AdminButton>
          )}
          {!isVoided && (
            <AdminButton
              variant="secondary"
              onClick={() => {
                setTextKey((k) => k + 1);
                setTextOpen(true);
              }}
              className={cn(showPhoneBar && "max-lg:flex-1")}
            >
              <span>
                Text<span className="max-sm:hidden"> to client</span>
              </span>
            </AdminButton>
          )}
          {!isVoided && (
            <AdminButton
              onClick={() => void sendFlow.openPreview()}
              disabled={!clientEmail}
              aria-label={!clientEmail ? "Add a client email to enable sending" : undefined}
              className={cn(showPhoneBar && "max-lg:flex-1")}
            >
              {/* Short labels on phones, where two of these share the bar. One span, so
                  the button's flex gap can't widen the word space. */}
              <span>
                {alreadySent ? "Re-send" : "Send"}
                <span className="max-sm:hidden"> to client</span>
              </span>
            </AdminButton>
          )}
        </div>
      </div>

      {/* Convert-to-invoice confirm. */}
      <ConfirmDialog
        open={confirmConvertOpen}
        title={`Convert ${invoiceNumber} to an invoice?`}
        body="Allocates the next invoice number and starts the payment clock from today. The quote number is retired; this can't be undone."
        confirmLabel="Convert"
        busy={converting}
        onConfirm={() => void convertToInvoice()}
        onCancel={() => setConfirmConvertOpen(false)}
      />

      {/* Delete-draft confirm. */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete ${isQuote ? "quote" : "invoice"} ${invoiceNumber}?`}
        body="This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={() => void deleteDraft()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        open={confirmReminderOpen}
        title="Send an overdue reminder?"
        body={
          (reminderCount ?? 0) > 0
            ? `${clientName || "The client"} has already been reminded ${reminderCount === 1 ? "once" : `${reminderCount} times`}. This sends another polite nudge with the invoice attached.`
            : `Emails ${clientName || "the client"} a polite nudge with the invoice attached.`
        }
        confirmLabel="Send reminder"
        busy={sendingReminder}
        onConfirm={() => void sendReminder()}
        onCancel={() => setConfirmReminderOpen(false)}
      />

      {/* Change invoice: silent void, then the calculator re-issue. */}
      <ConfirmDialog
        open={confirmChangeOpen}
        title={`Change ${invoiceNumber}?`}
        body={`${invoiceNumber} is voided without emailing ${clientName || "the client"}, and the calculator opens with the job filled in. Save and send the new one - it says it replaces ${invoiceNumber}, so they won't pay both. If you leave without saving, come back here and use Re-issue in calculator.`}
        confirmLabel="Void and change"
        busy={changing}
        onConfirm={() => void changeInvoice()}
        onCancel={() => setConfirmChangeOpen(false)}
      />

      {/* Edit-details modal: SENT/PAID money and dates are locked, but client details and
          notes stay editable. */}
      <Modal
        open={detailsOpen}
        onClose={() => !detailsSaving && setDetailsOpen(false)}
        dirty={!detailsSaving && detailsDirty}
        title="Edit details"
        description={
          isPaid || isQuote
            ? "The Drive PDF updates on save."
            : "The Drive PDF updates on save. To change lines, amounts or dates, use Change invoice."
        }
        size="md"
        footer={
          <>
            <AdminButton
              variant="secondary"
              onClick={() => setDetailsOpen(false)}
              disabled={detailsSaving}
            >
              Cancel
            </AdminButton>
            <AdminButton onClick={() => void saveDetails()} busy={detailsSaving}>
              Save
            </AdminButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <AdminField label="Client name" htmlFor="details-name">
            <AdminInput
              id="details-name"
              value={detailsDraft.name}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, name: e.target.value }))}
              disabled={detailsSaving}
            />
          </AdminField>
          <AdminField label="Email" htmlFor="details-email">
            <AdminInput
              id="details-email"
              type="email"
              value={detailsDraft.email}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, email: e.target.value }))}
              disabled={detailsSaving}
            />
          </AdminField>
          <AdminField label="Mobile" htmlFor="details-phone">
            <AdminInput
              id="details-phone"
              type="tel"
              value={detailsDraft.phone}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, phone: e.target.value }))}
              disabled={detailsSaving}
            />
          </AdminField>
          <AdminField label="Notes" htmlFor="details-notes">
            <AdminTextarea
              id="details-notes"
              rows={4}
              value={detailsDraft.notes}
              onChange={(e) => setDetailsDraft((d) => ({ ...d, notes: e.target.value }))}
              disabled={detailsSaving}
              placeholder="Optional note shown on the invoice."
            />
          </AdminField>
        </div>
      </Modal>

      {/* Record payment - the real /pay flow (stamps + income + PDF re-sync). */}
      {payOpen && (
        <PaymentDialog
          open
          invoice={{
            id: invoiceId,
            number: invoiceNumber,
            balance,
            clientName,
            status: currentStatus,
            paidAt,
            reminderLastSentAt,
            apologySentAt,
          }}
          hasLinkedIncome={hasPaymentIncome}
          likelyIncome={likelyIncome}
          onClose={(recorded) => {
            setPayOpen(false);
            if (recorded) {
              setCurrentStatus("PAID");
              router.refresh();
            }
          }}
        />
      )}

      {/* Send invoice preview modal. */}
      <SendInvoiceModal
        flow={sendFlow}
        invoiceId={invoiceId}
        clientName={clientName}
        clientEmail={clientEmail}
      />

      <TextInvoiceModal
        key={textKey}
        open={textOpen}
        onClose={() => setTextOpen(false)}
        invoiceId={invoiceId}
        clientName={clientName}
        isQuote={isQuote}
        alreadySent={alreadySent || isPaid}
        onSent={() => {
          if (isDraft) setCurrentStatus("SENT");
          router.refresh();
        }}
      />

      {/* Void invoice / resend-notification modal. */}
      <VoidInvoiceModal
        flow={voidFlow}
        invoiceNumber={invoiceNumber}
        clientName={clientName}
        clientEmail={clientEmail}
        isVoided={isVoided}
        linkedIncome={linkedIncome}
      />
    </>
  );
}
