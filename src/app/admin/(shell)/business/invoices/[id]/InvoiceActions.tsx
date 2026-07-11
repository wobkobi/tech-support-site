"use client";
// src/app/admin/(shell)/business/invoices/[id]/InvoiceActions.tsx
/**
 * @description Action buttons + modals for the invoice detail page: save PDF,
 * open Drive PDF, record payment (via {@link PaymentDialog}), send-to-client,
 * void, and delete-draft. The send flow opens a preview modal with an editable
 * email body/greeting plus an optional review link based on eligibility; the
 * void flow previews the notification and warns when linked income entries would
 * be left behind. Housed beside the page so it ships in the PageHeader actions
 * slot. Built on the shared admin primitives (Modal / ConfirmDialog / AdminButton
 * / Toast).
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import { PaymentDialog } from "@/features/business/components/invoice/PaymentDialog";
import { formatNZD } from "@/features/business/lib/business";
import type { InvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_VOID_EMAIL_BODY,
} from "@/features/business/lib/invoice-email-defaults";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Count + dollar total of income entries linked to this invoice. */
interface LinkedIncome {
  count: number;
  total: number;
}

interface InvoiceActionsProps {
  driveWebUrl: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  status: string;
  /** Invoice total - passed to {@link PaymentDialog}. */
  total: number;
  /** First-sent stamp; drives the "Re-send" label. */
  sentAt?: string | null;
  /** Payment stamp; passed to {@link PaymentDialog}. */
  paidAt?: string | null;
  /** Linked income entries - shown as a pre-flight warning in the void modal. */
  linkedIncome: LinkedIncome;
  /** When true, open the send preview once on mount (calculator "Save & send"). */
  autoOpenSend?: boolean;
}

const INPUT_CLS = cn(
  "w-full rounded-lg border border-admin-border-strong px-3 py-2 text-sm text-admin-text",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet",
);
const FIELD_LABEL_CLS = "mb-2 block text-xs font-semibold text-admin-muted uppercase";
/** Static JSON request headers - module-scoped so it's a stable useCallback dep. */
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
 * @param props.sentAt - First-sent stamp; drives the Send/Re-send label.
 * @param props.paidAt - Payment stamp, passed to the payment dialog.
 * @param props.linkedIncome - Linked income count + total for the void warning.
 * @param props.autoOpenSend - Open the send preview on mount when true.
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
  sentAt,
  paidAt,
  linkedIncome,
  autoOpenSend = false,
}: InvoiceActionsProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  // Send-email preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentLocal, setSentLocal] = useState<boolean>(sentAt != null);
  // Action busy flags
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  // Operator-typed greeting override. Empty = use the first word of clientName.
  const [greetingName, setGreetingName] = useState("");
  // Editable email body, pre-populated with the default copy.
  const [customBody, setCustomBody] = useState(DEFAULT_INVOICE_EMAIL_BODY);
  // Review-link inclusion. Defaults to whatever eligibility says when the modal opens.
  const [includeReview, setIncludeReview] = useState(true);
  const [eligibility, setEligibility] = useState<InvoiceReviewEligibility | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);

  // Confirm dialog (replacing window.confirm) + record-payment dialog.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // Void modal state.
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidGreetingName, setVoidGreetingName] = useState("");
  const [voidCustomBody, setVoidCustomBody] = useState(DEFAULT_VOID_EMAIL_BODY);
  const [voidSendNotification, setVoidSendNotification] = useState(true);
  const [voidPreview, setVoidPreview] = useState<{
    subject: string;
    html: string;
    to: string;
  } | null>(null);
  const [voidPreviewLoading, setVoidPreviewLoading] = useState(false);

  const alreadySent = currentStatus === "SENT" || sentLocal;
  const isPaid = currentStatus === "PAID";
  const isDraft = currentStatus === "DRAFT";
  const isVoided = currentStatus === "VOIDED";

  /**
   * Opens the SENT/PAID void modal, resetting the message to the default so a
   * previous custom message doesn't leak across voids.
   */
  function openVoidModal(): void {
    setError(null);
    setVoidCustomBody(DEFAULT_VOID_EMAIL_BODY);
    setVoidGreetingName("");
    setVoidSendNotification(Boolean(clientEmail));
    setVoidModalOpen(true);
    // Pass the just-reset values explicitly: the setters above have not applied
    // yet, so loadVoidPreview reading component state would post the previous
    // session's edited body/greeting.
    void loadVoidPreview("", DEFAULT_VOID_EMAIL_BODY);
  }

  /**
   * Reopens the void modal on an already-VOIDED invoice to (re)send the
   * notification. The void endpoint is idempotent on VOIDED rows: no status
   * change, just (re)send.
   */
  function resendVoidNotification(): void {
    if (!clientEmail) return;
    setError(null);
    setVoidCustomBody(DEFAULT_VOID_EMAIL_BODY);
    setVoidGreetingName("");
    setVoidSendNotification(true);
    setVoidModalOpen(true);
    void loadVoidPreview("", DEFAULT_VOID_EMAIL_BODY);
  }

  /**
   * Fetches the rendered void notification email into state for the iframe
   * preview. Only spins on the first load so edit re-fetches keep the preview.
   * @param greetingOverride - Greeting to preview instead of component state
   * (pass the just-set value right after a setState to dodge the stale closure).
   * @param bodyOverride - Body to preview instead of component state.
   */
  async function loadVoidPreview(greetingOverride?: string, bodyOverride?: string): Promise<void> {
    if (!clientEmail) return;
    setError(null);
    if (!voidPreview) setVoidPreviewLoading(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/preview-void-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          greetingName: greetingOverride ?? voidGreetingName,
          customBody: bodyOverride ?? voidCustomBody,
        }),
      });
      const d = (await res.json()) as
        { ok: true; subject: string; html: string; to: string } | { error: string };
      if ("error" in d) throw new Error(d.error);
      setVoidPreview({ subject: d.subject, html: d.html, to: d.to });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load preview");
    } finally {
      setVoidPreviewLoading(false);
    }
  }

  /**
   * Posts the void to the /void endpoint and updates local state. Shared by the
   * DRAFT silent path (via ConfirmDialog) and the modal Confirm action.
   * @param opts - Whether to notify + any operator overrides.
   * @param opts.sendNotification - True to email the client; false to void silently.
   * @param opts.greetingName - Optional override for the email greeting.
   * @param opts.customBody - Optional override for the email body.
   */
  async function submitVoid(opts: {
    sendNotification: boolean;
    greetingName?: string;
    customBody?: string;
  }): Promise<void> {
    setError(null);
    setVoiding(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/void`, {
        method: "POST",
        headers,
        body: JSON.stringify(opts),
      });
      const d = (await res.json()) as
        | {
            ok: true;
            voidedAt: string | null;
            notified: boolean;
            incomeEntryCount: number;
            alreadyVoided: boolean;
          }
        | { error: string };
      if ("error" in d) throw new Error(d.error);
      setCurrentStatus("VOIDED");
      setVoidModalOpen(false);
      // Compose a message surfacing the notification outcome + linked-income
      // warning. A remaining ledger entry or a failed email downgrades to warning.
      const parts: string[] = [];
      if (d.alreadyVoided) {
        parts.push(
          d.notified ? "Notification re-sent." : "Notification re-send failed - check server logs.",
        );
      } else {
        parts.push("Invoice voided.");
        if (opts.sendNotification) {
          parts.push(
            d.notified ? "Client notified." : "Notification email failed - send manually.",
          );
        }
      }
      if (d.incomeEntryCount > 0) {
        parts.push(
          `${d.incomeEntryCount} linked income entr${d.incomeEntryCount === 1 ? "y" : "ies"} remain - reverse manually in the ledger.`,
        );
      }
      const failed = (opts.sendNotification && !d.notified) || d.incomeEntryCount > 0;
      toast(parts.join(" "), { tone: failed ? "warning" : "success" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void invoice");
      toast(err instanceof Error ? err.message : "Could not void invoice", { tone: "error" });
    } finally {
      setVoiding(false);
    }
  }

  /** Closes the void modal without submitting. Disabled while a void is in-flight. */
  const closeVoidModal = useCallback((): void => {
    if (voiding) return;
    setVoidModalOpen(false);
    setError(null);
    setVoidPreview(null);
  }, [voiding]);

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
   * Opens the send modal and fetches the rendered email preview. Only spins on
   * the FIRST load so edit re-fetches keep the preview visible.
   * @param forceAdopt - Re-adopt the server's fresh eligibility verdict (and sync
   * the review checkbox) instead of keeping the operator's toggle; used after
   * "add to contacts" so the checkbox unlocks.
   * @param includeReviewOverride - Review value to preview instead of component
   * state; pass the just-toggled value so the re-fetch isn't stale.
   */
  const openPreview = useCallback(
    async function openPreviewImpl(
      forceAdopt = false,
      includeReviewOverride?: boolean,
    ): Promise<void> {
      setError(null);
      if (!preview) setLoading(true);
      setPreviewOpen(true);
      try {
        const sendIncludeReview = !forceAdopt && eligibility !== null;
        const effectiveIncludeReview = includeReviewOverride ?? includeReview;
        const res = await fetch(`/api/business/invoices/${invoiceId}/preview-email`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            greetingName,
            customBody,
            ...(sendIncludeReview ? { includeReview: effectiveIncludeReview } : {}),
          }),
        });
        const d = (await res.json()) as
          | {
              ok: true;
              subject: string;
              html: string;
              to: string;
              eligibility: InvoiceReviewEligibility;
            }
          | { error: string };
        if ("error" in d) throw new Error(d.error);
        setPreview({ subject: d.subject, html: d.html, to: d.to });
        if (!sendIncludeReview) setIncludeReview(d.eligibility.canSend);
        setEligibility(d.eligibility);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load preview");
      } finally {
        setLoading(false);
      }
    },
    // eligibility/includeReview/greetingName/customBody/preview are read fresh
    // each call so the preview matches the operator's current edits.
    [invoiceId, eligibility, includeReview, greetingName, customBody, preview],
  );

  /** Confirms the send action: POSTs to send-email, refreshes on success. */
  async function confirmSend(): Promise<void> {
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ greetingName, customBody, includeReview }),
      });
      const d = (await res.json()) as { ok: true; sentAt: string } | { error: string };
      if ("error" in d) throw new Error(d.error);
      setSentLocal(true);
      setPreviewOpen(false);
      setPreview(null);
      toast(`Invoice ${invoiceNumber} sent to ${clientName || "client"}.`, { tone: "success" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send email");
    } finally {
      setSending(false);
    }
  }

  /** Closes the send preview modal without sending. */
  const closePreview = useCallback((): void => {
    if (sending) return;
    setPreviewOpen(false);
    setPreview(null);
    setError(null);
    // Drop eligibility so the next open re-fetches it and re-syncs the toggle.
    setEligibility(null);
  }, [sending]);

  // Calculator "Save & send": open the send preview once on mount.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (autoOpenSend && clientEmail && !didAutoOpen.current) {
      didAutoOpen.current = true;
      void openPreview();
    }
  }, [autoOpenSend, clientEmail, openPreview]);

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
          <AdminButton variant="danger" onClick={() => setConfirmDeleteOpen(true)} busy={deleting}>
            Delete draft
          </AdminButton>
        )}
        {!isDraft && !isPaid && !isVoided && (
          <AdminButton variant="secondary" onClick={openVoidModal} busy={voiding}>
            Void invoice
          </AdminButton>
        )}
        {isVoided && clientEmail && (
          <AdminButton variant="secondary" onClick={resendVoidNotification} busy={voiding}>
            Resend void notification
          </AdminButton>
        )}
        {!isPaid && !isVoided && (
          <AdminButton variant="secondary" onClick={() => setPayOpen(true)}>
            Mark as paid
          </AdminButton>
        )}
        {isPaid && !paidAt && (
          // Legacy PAID row with no recorded date/method - let the operator backfill.
          <AdminButton variant="secondary" onClick={() => setPayOpen(true)}>
            Record payment details
          </AdminButton>
        )}
        {!isVoided && (
          <AdminButton
            onClick={() => void openPreview()}
            disabled={!clientEmail}
            aria-label={!clientEmail ? "Add a client email to enable sending" : undefined}
          >
            {alreadySent ? "Re-send to client" : "Send to client"}
          </AdminButton>
        )}
      </div>

      {/* Delete-draft confirm. */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete invoice ${invoiceNumber}?`}
        body="This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={() => void deleteDraft()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

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
      <Modal
        open={previewOpen}
        onClose={closePreview}
        title="Send invoice"
        description={
          <>
            To: <span className="font-medium">{preview?.to ?? clientEmail}</span>
          </>
        }
        size="lg"
        footer={
          <>
            <AdminButton variant="secondary" onClick={closePreview} disabled={sending}>
              Cancel
            </AdminButton>
            <AdminButton
              onClick={() => void confirmSend()}
              busy={sending}
              disabled={loading || !!error || !preview}
            >
              Send email
            </AdminButton>
          </>
        }
      >
        {loading && <p className="py-6 text-center text-sm text-admin-muted">Loading preview...</p>}
        {error && !loading && (
          <p className="rounded-lg border border-coquelicot-800 bg-coquelicot-900 px-4 py-3 text-sm text-coquelicot-200">
            {error}
          </p>
        )}
        {preview && !loading && (
          <div>
            <label htmlFor="greeting-name" className={FIELD_LABEL_CLS}>
              Greeting (the person you&apos;re emailing)
            </label>
            <input
              id="greeting-name"
              type="text"
              value={greetingName}
              onChange={(e) => setGreetingName(e.target.value)}
              onBlur={() => void openPreview()}
              placeholder="John (leave blank to use the first word of the client name)"
              disabled={sending}
              className={cn(INPUT_CLS, "mb-4")}
            />
            <label htmlFor="custom-body" className={FIELD_LABEL_CLS}>
              Message
            </label>
            <textarea
              id="custom-body"
              rows={4}
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              onBlur={() => void openPreview()}
              disabled={sending}
              className={cn(INPUT_CLS, "mb-4 resize-y")}
            />
            {eligibility && (
              <div className="mb-4">
                <label
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    !eligibility.canSend && "cursor-not-allowed",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={includeReview && eligibility.canSend}
                    disabled={!eligibility.canSend || sending}
                    onChange={(e) => {
                      setIncludeReview(e.target.checked);
                      void openPreview(false, e.target.checked);
                    }}
                    className="mt-0.5"
                  />
                  <span className={cn(!eligibility.canSend && "text-admin-faint")}>
                    Include review link in this email
                    {eligibility.canSend === false && (
                      <span className="ml-1 text-xs italic">
                        {eligibility.reason === "already-reviewed" &&
                          "(this customer has already left a review)"}
                        {eligibility.reason === "sent-recently" &&
                          ` (review request sent ${formatDateShort(eligibility.lastSentAt)} - can re-send from ${formatDateShort(eligibility.nextAllowedAt)})`}
                        {eligibility.reason === "no-contact" && (
                          <>
                            (no contact record -{" "}
                            <button
                              type="button"
                              onClick={() => setShowAddContact(true)}
                              className="font-semibold text-russian-violet underline hover:opacity-80"
                            >
                              add {clientName?.trim().split(" ")[0] || "them"} to contacts
                            </button>
                            )
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            )}
            <p className={FIELD_LABEL_CLS}>Subject</p>
            <p className="mb-4 text-sm font-medium text-admin-text">{preview.subject}</p>
            <p className={FIELD_LABEL_CLS}>Body</p>
            <div className="rounded-lg border border-admin-border bg-admin-bg p-2">
              <iframe
                title="Invoice email preview"
                srcDoc={preview.html}
                sandbox="allow-same-origin"
                className="h-105 w-full rounded bg-white"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Void invoice / resend-notification modal. */}
      <Modal
        open={voidModalOpen}
        onClose={closeVoidModal}
        title={isVoided ? "Resend void notification" : "Void invoice"}
        description={
          clientEmail ? (
            isVoided ? (
              <>
                Re-send the void notification to <span className="font-medium">{clientEmail}</span>.
                The invoice stays voided either way.
              </>
            ) : (
              <>
                This invoice was sent to <span className="font-medium">{clientEmail}</span>. Notify
                them so they don&apos;t pay the original.
              </>
            )
          ) : (
            "No client email on file - voiding silently."
          )
        }
        size="lg"
        footer={
          <>
            <AdminButton variant="secondary" onClick={closeVoidModal} disabled={voiding}>
              Cancel
            </AdminButton>
            <AdminButton
              variant={isVoided ? "primary" : "danger"}
              busy={voiding}
              onClick={() =>
                void submitVoid({
                  sendNotification: Boolean(clientEmail) && voidSendNotification,
                  greetingName: voidGreetingName || undefined,
                  customBody: voidCustomBody,
                })
              }
            >
              {isVoided
                ? "Send notification"
                : clientEmail && voidSendNotification
                  ? "Void & notify"
                  : "Void invoice"}
            </AdminButton>
          </>
        }
      >
        {error && (
          <p className="mb-4 rounded-lg border border-coquelicot-800 bg-coquelicot-900 px-4 py-3 text-sm text-coquelicot-200">
            {error}
          </p>
        )}

        {/* Pre-flight: voiding does not reverse a recorded payment's ledger row. */}
        {linkedIncome.count > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This invoice has {linkedIncome.count} linked income entr
            {linkedIncome.count === 1 ? "y" : "ies"} totalling {formatNZD(linkedIncome.total)}.
            Voiding won&apos;t reverse {linkedIncome.count === 1 ? "it" : "them"} - reverse manually
            in the ledger.
          </p>
        )}

        {clientEmail ? (
          <>
            <label className="mb-3 flex items-start gap-2 text-sm text-admin-text">
              <input
                type="checkbox"
                checked={voidSendNotification}
                onChange={(e) => setVoidSendNotification(e.target.checked)}
                disabled={voiding}
                className="mt-0.5"
              />
              <span>
                Send notification email to <strong>{clientEmail}</strong>
              </span>
            </label>

            {voidSendNotification && (
              <>
                <label htmlFor="void-greeting-name" className={FIELD_LABEL_CLS}>
                  Greeting (the person you&apos;re emailing)
                </label>
                <input
                  id="void-greeting-name"
                  type="text"
                  value={voidGreetingName}
                  onChange={(e) => setVoidGreetingName(e.target.value)}
                  onBlur={() => void loadVoidPreview()}
                  placeholder={`${clientName?.trim().split(" ")[0] || "First name"} (leave blank to use the first word of the client name)`}
                  disabled={voiding}
                  className={cn(INPUT_CLS, "mb-4")}
                />
                <label htmlFor="void-custom-body" className={FIELD_LABEL_CLS}>
                  Message
                </label>
                <textarea
                  id="void-custom-body"
                  rows={5}
                  value={voidCustomBody}
                  onChange={(e) => setVoidCustomBody(e.target.value)}
                  onBlur={() => void loadVoidPreview()}
                  disabled={voiding}
                  className={cn(INPUT_CLS, "mb-4 resize-y")}
                />
                <p className={FIELD_LABEL_CLS}>Subject</p>
                <p className="mb-4 text-sm font-medium text-admin-text">
                  {voidPreview?.subject ?? `Invoice ${invoiceNumber} - voided`}
                </p>
                <p className={FIELD_LABEL_CLS}>Body</p>
                <div className="rounded-lg border border-admin-border bg-admin-bg p-2">
                  {voidPreviewLoading && !voidPreview ? (
                    <p className="p-6 text-center text-sm text-admin-muted">Loading preview...</p>
                  ) : voidPreview ? (
                    <iframe
                      title="Void notification email preview"
                      srcDoc={voidPreview.html}
                      sandbox="allow-same-origin"
                      className="h-105 w-full rounded bg-white"
                    />
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-admin-muted italic">
                  The VOIDED-stamped PDF will be attached automatically.
                </p>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-admin-text-secondary">
            No notification will be sent. The invoice will be marked VOIDED and the Drive PDF will
            get a diagonal VOID stamp.
          </p>
        )}
      </Modal>

      {showAddContact && (
        <AddToContactsModal
          name={clientName}
          email={clientEmail}
          onClose={(newContactId) => {
            setShowAddContact(false);
            // When a contact was created, force a fresh eligibility adopt so the
            // review-link checkbox re-enables and auto-ticks.
            void openPreview(Boolean(newContactId));
          }}
        />
      )}
    </>
  );
}
