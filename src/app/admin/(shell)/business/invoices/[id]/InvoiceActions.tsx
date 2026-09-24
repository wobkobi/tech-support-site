"use client";
// src/app/admin/(shell)/business/invoices/[id]/InvoiceActions.tsx
// Action buttons + modals for the invoice detail page: save PDF, open Drive PDF, record
// payment (via PaymentDialog), send-to-client, void, and delete-draft. Below lg, an
// invoice still awaiting payment pins Mark as paid and Send to the screen bottom. The
// send flow opens a preview modal with an editable email body/greeting plus an optional
// review link based on eligibility; the void flow previews the notification and warns
// when linked income entries would be left behind. Housed beside the page so it ships in
// the PageHeader actions slot. Built on the shared admin primitives (Modal /
// ConfirmDialog / AdminButton / Toast). The send and void flows live in
// SendInvoiceModal.tsx and VoidInvoiceModal.tsx.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { PaymentDialog } from "@/features/business/components/invoice/PaymentDialog";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { SendInvoiceModal, useInvoiceSend } from "./SendInvoiceModal";
import { type LinkedIncome, useInvoiceVoid, VoidInvoiceModal } from "./VoidInvoiceModal";

interface InvoiceActionsProps {
  driveWebUrl: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  status: string;
  /** Invoice total - passed to {@link PaymentDialog}. */
  total: number;
  /** Current notes; edited in place via the "Edit notes" modal (SENT/PAID). */
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
  /** True when the row is a quote - swaps email copy, hides payment actions, adds Convert. */
  isQuote?: boolean;
}

const INPUT_CLS = cn(
  "w-full rounded-lg border border-admin-border-strong px-3 py-2 text-sm text-admin-text",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet",
);
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
 * @param props.status - Current invoice status (drives which actions show).
 * @param props.total - Invoice total, passed to the payment dialog.
 * @param props.notes - Current notes, edited via the notes modal (SENT/PAID).
 * @param props.sentAt - First-sent stamp; drives the Send/Re-send label.
 * @param props.paidAt - Payment stamp, passed to the payment dialog.
 * @param props.linkedIncome - Linked income count + total for the void warning.
 * @param props.autoOpenSend - Open the send preview on mount when true.
 * @param props.isOverdue - Whether the invoice is SENT and past due.
 * @param props.reminderCount - Reminders already sent (null reads as 0).
 * @param props.reminderLastSentAt - Last reminder stamp, passed to the payment dialog.
 * @param props.apologySentAt - Apology stamp, passed to the payment dialog.
 * @param props.isQuote - Whether the row is a quote.
 * @returns Invoice actions element with its modals.
 */
export function InvoiceActions({
  driveWebUrl,
  invoiceId,
  invoiceNumber,
  clientName,
  clientEmail,
  status,
  total,
  notes,
  sentAt,
  paidAt,
  linkedIncome,
  autoOpenSend = false,
  isOverdue = false,
  reminderCount = null,
  reminderLastSentAt = null,
  apologySentAt = null,
  isQuote = false,
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

  // Edit-notes modal (SENT/PAID quick edit; notes stay editable post-send).
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);

  const alreadySent = currentStatus === "SENT" || sendFlow.sentLocal;
  const isPaid = currentStatus === "PAID";
  const isDraft = currentStatus === "DRAFT";
  const isVoided = currentStatus === "VOIDED";
  // Paid and voided invoices have nothing left to chase, so their buttons stay in the row.
  const showPhoneBar = !isPaid && !isVoided;

  /**
   * Downloads the real customer-facing PDF (same renderer as Drive + email
   * attachment), bypassing window.print() so the file is the branded PDF.
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
   * Sends an overdue reminder (same variant + stamping as the cron) and
   * refreshes so the timeline picks up the new stamp.
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
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Delete failed");
      }
      router.push("/admin/business/invoices");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", { tone: "error" });
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  /**
   * Promotes the quote to a real invoice: the server allocates the next TTP
   * number, clears the quote flag, and restamps issue/due dates from today.
   * The page refreshes in place - same row, new number.
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
   * Saves a notes-only edit (allowed on SENT/PAID, not VOIDED) via the sparse
   * PATCH branch, then refreshes so the preview + rail reflect the new note.
   */
  async function saveNotes(): Promise<void> {
    setNotesSaving(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ notes: notesDraft.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't save the note.", { tone: "error" });
        setNotesSaving(false);
        return;
      }
      setNotesOpen(false);
      setNotesSaving(false);
      toast("Note saved.", { tone: "success" });
      router.refresh();
    } catch {
      toast("Couldn't save the note. Check your connection.", { tone: "error" });
      setNotesSaving(false);
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
              setNotesDraft(notes ?? "");
              setNotesOpen(true);
            }}
          >
            Edit notes
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
        {isVoided && clientEmail && (
          <AdminButton variant="secondary" onClick={voidFlow.resendVoidNotification} busy={voiding}>
            Resend void notification
          </AdminButton>
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
        {/* The phone bar. On lg, or with no bar, `contents` drops the wrapper's box
            and the buttons join the row. The page reserves room under it (see
            globals.css). */}
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
              Convert to invoice
            </AdminButton>
          )}
          {!isVoided && (
            <AdminButton
              onClick={() => void sendFlow.openPreview()}
              disabled={!clientEmail}
              aria-label={!clientEmail ? "Add a client email to enable sending" : undefined}
              className={cn(showPhoneBar && "max-lg:flex-1")}
            >
              {alreadySent ? "Re-send to client" : "Send to client"}
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

      {/* Edit-notes modal (SENT/PAID - content is audit-locked but notes stay
          editable for IRD annotations via the sparse PATCH). */}
      <Modal
        open={notesOpen}
        onClose={() => !notesSaving && setNotesOpen(false)}
        dirty={!notesSaving && notesDraft !== (notes ?? "")}
        title="Edit notes"
        description="Shown on the invoice; the Drive PDF re-syncs on save."
        size="md"
        footer={
          <>
            <AdminButton
              variant="secondary"
              onClick={() => setNotesOpen(false)}
              disabled={notesSaving}
            >
              Cancel
            </AdminButton>
            <AdminButton onClick={() => void saveNotes()} busy={notesSaving}>
              Save note
            </AdminButton>
          </>
        }
      >
        <textarea
          rows={5}
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          disabled={notesSaving}
          placeholder="Optional note shown on the invoice."
          className={cn(INPUT_CLS, "resize-y")}
        />
      </Modal>

      {/* Record payment - the real /pay flow (stamps + income + PDF re-sync). */}
      {payOpen && (
        <PaymentDialog
          open
          invoice={{
            id: invoiceId,
            number: invoiceNumber,
            total,
            clientName,
            status: currentStatus,
            paidAt,
            reminderLastSentAt,
            apologySentAt,
          }}
          hasLinkedIncome={linkedIncome.count > 0}
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
