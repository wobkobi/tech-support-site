"use client";

import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import type { InvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_VOID_EMAIL_BODY,
} from "@/features/business/lib/invoice-email-defaults";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaCaretLeft } from "react-icons/fa6";

interface InvoiceActionsProps {
  backHref: string;
  driveWebUrl: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  status: string;
}

/**
 * Action bar for an invoice detail page: back, print, Drive PDF, send-to-client.
 * @param props - Component props.
 * @param props.backHref - URL for the back button.
 * @param props.driveWebUrl - Optional Google Drive PDF URL.
 * @param props.invoiceId - Invoice id used by the preview/send routes.
 * @param props.invoiceNumber - Filename for the downloaded PDF.
 * @param props.clientName - Used in the "add to contacts" link in the send modal.
 * @param props.clientEmail - Recipient; "Send" is disabled when empty.
 * @param props.status - Drives the "Sent" indicator.
 * @returns Invoice actions element with modal.
 */
export function InvoiceActions({
  backHref,
  driveWebUrl,
  invoiceId,
  invoiceNumber,
  clientName,
  clientEmail,
  status,
}: InvoiceActionsProps): React.ReactElement {
  const router = useRouter();
  // Send-email preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  // Action busy flags
  const [marking, setMarking] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  // Operator-typed greeting override. Empty = use the first word of clientName.
  // Useful when the invoice is for a company but the email goes to a specific
  // person inside it.
  const [greetingName, setGreetingName] = useState("");
  // Editable email body. Pre-populated with the default copy; operator can
  // tweak before each send. White-space is preserved when rendered.
  const [customBody, setCustomBody] = useState(DEFAULT_INVOICE_EMAIL_BODY);
  // Review-link inclusion. Defaults to whatever eligibility says when the
  // modal opens; operator can toggle if eligible.
  const [includeReview, setIncludeReview] = useState(true);
  const [eligibility, setEligibility] = useState<InvoiceReviewEligibility | null>(null);
  // Drives the inline "Add to contacts" popup spawned from the no-contact
  // eligibility row inside the send-invoice modal.
  const [showAddContact, setShowAddContact] = useState(false);

  // Void modal state. Opened for SENT/PAID voids so the operator can decide
  // whether to notify the client and tweak the message. DRAFT voids skip the
  // modal entirely (no client to notify).
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidGreetingName, setVoidGreetingName] = useState("");
  const [voidCustomBody, setVoidCustomBody] = useState(DEFAULT_VOID_EMAIL_BODY);
  const [voidSendNotification, setVoidSendNotification] = useState(true);
  // Rendered preview of the void notification email. Re-fetched on greeting /
  // body blur so the operator sees the exact subject + body the client will
  // receive, mirroring the send-invoice preview UX.
  const [voidPreview, setVoidPreview] = useState<{
    subject: string;
    html: string;
    to: string;
  } | null>(null);
  const [voidPreviewLoading, setVoidPreviewLoading] = useState(false);
  // Post-void toast: surfaces notification success/failure + the linked income
  // entry warning when the voided invoice had been marked PAID.
  const [voidToast, setVoidToast] = useState<string | null>(null);

  const headers = { "Content-Type": "application/json" };
  const alreadySent = currentStatus === "SENT" || sentAt !== null;
  const isPaid = currentStatus === "PAID";
  const isDraft = currentStatus === "DRAFT";
  const isVoided = currentStatus === "VOIDED";

  /**
   * Flips the invoice status to PAID via PATCH; refreshes the page on success.
   */
  async function markPaid(): Promise<void> {
    if (!confirm("Mark this invoice as paid?")) return;
    setError(null);
    setMarking(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "PAID" }),
      });
      const d = (await res.json()) as { ok: true } | { error: string };
      if ("error" in d) throw new Error(d.error);
      setCurrentStatus("PAID");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark as paid");
    } finally {
      setMarking(false);
    }
  }

  /**
   * Entry point for voiding an invoice. DRAFT voids run silently (no client to
   * notify); SENT/PAID voids open a modal so the operator can decide whether
   * to email the client and tweak the message. The actual server call lives
   * in {@link submitVoid} below so both paths share the network code.
   */
  async function voidInvoice(): Promise<void> {
    if (isDraft) {
      if (
        !confirm(
          "Void this draft? It will be marked as cancelled. The client never received it so no notification will be sent.",
        )
      )
        return;
      await submitVoid({ sendNotification: false });
      return;
    }
    // SENT or PAID: open the modal. Reset body to the default each time so a
    // previous custom message doesn't leak across voids.
    setError(null);
    setVoidCustomBody(DEFAULT_VOID_EMAIL_BODY);
    setVoidGreetingName("");
    // Default notification ON when the client has an email - the common case.
    setVoidSendNotification(Boolean(clientEmail));
    setVoidModalOpen(true);
    void loadVoidPreview();
  }

  /**
   * Reopens the void modal on an already-VOIDED invoice so the operator can
   * (re)send the notification email - useful when the first attempt was
   * silent (dropdown void) or failed (Resend rejected). The void endpoint is
   * idempotent on already-VOIDED rows: no status change, just (re)send.
   */
  function resendVoidNotification(): void {
    if (!clientEmail) return;
    setError(null);
    setVoidCustomBody(DEFAULT_VOID_EMAIL_BODY);
    setVoidGreetingName("");
    setVoidSendNotification(true);
    setVoidModalOpen(true);
    void loadVoidPreview();
  }

  /**
   * Fetches the rendered void notification email and stores it in state so
   * the modal can show an iframe preview. Only shows a spinner on the first
   * load so subsequent re-fetches (after editing greeting/body) keep the
   * existing preview visible.
   */
  async function loadVoidPreview(): Promise<void> {
    if (!clientEmail) return;
    setError(null);
    if (!voidPreview) setVoidPreviewLoading(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/preview-void-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          greetingName: voidGreetingName,
          customBody: voidCustomBody,
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
   * Posts the void to the dedicated /void endpoint and updates local state.
   * Shared by the DRAFT silent path and the modal Confirm action.
   * @param opts - Whether to send the notification email and any operator overrides.
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
      // Compose a toast that surfaces both the notification outcome and the
      // linked-income-entry warning when present. Cleared after 6s.
      const parts: string[] = [d.alreadyVoided ? "Notification re-sent." : "Invoice voided."];
      if (opts.sendNotification && !d.alreadyVoided) {
        parts.push(d.notified ? "Client notified." : "Notification email failed - send manually.");
      }
      if (opts.sendNotification && d.alreadyVoided && !d.notified) {
        parts.push("Notification email failed - check server logs.");
      }
      if (d.incomeEntryCount > 0) {
        parts.push(
          `${d.incomeEntryCount} linked income entr${d.incomeEntryCount === 1 ? "y" : "ies"} remain - reverse manually in /admin/business.`,
        );
      }
      setVoidToast(parts.join(" "));
      setTimeout(() => setVoidToast(null), 6000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void invoice");
    } finally {
      setVoiding(false);
    }
  }

  /** Closes the void modal without submitting. Disabled while a void is in-flight. */
  function closeVoidModal(): void {
    if (voiding) return;
    setVoidModalOpen(false);
    setError(null);
    setVoidPreview(null);
  }

  /**
   * Downloads the actual customer-facing PDF (same renderer as Drive + email
   * attachment) for the saved invoice. Bypasses window.print() so the file
   * is the real branded PDF, not a browser screenshot of the HTML preview.
   */
  async function downloadPdf(): Promise<void> {
    setError(null);
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
      setError(err instanceof Error ? err.message : "Could not download PDF");
    }
  }

  /**
   * DRAFT-only delete: confirms, DELETEs the invoice, redirects to the list.
   */
  async function deleteDraft(): Promise<void> {
    if (!confirm(`Delete invoice ${invoiceId}? This cannot be undone.`)) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Delete failed");
      }
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setDeleting(false);
    }
  }

  /**
   * Opens the modal and fetches the rendered email preview from the API.
   * Uses the current `greetingName` and `customBody` state so the previewed
   * email exactly matches what'll be sent. Only shows the spinner on the
   * FIRST load - subsequent re-fetches (after editing greeting or body) keep
   * the existing preview visible so the modal doesn't flash/shrink.
   */
  async function openPreview(): Promise<void> {
    setError(null);
    if (!preview) setLoading(true);
    setPreviewOpen(true);
    try {
      // First open: send no includeReview override so the server defaults to
      // whatever eligibility says, and that result is adopted into local state.
      // On re-fetch (after edits), pass the current toggle so the preview matches.
      const sendIncludeReview = eligibility !== null;
      const res = await fetch(`/api/business/invoices/${invoiceId}/preview-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          greetingName,
          customBody,
          ...(sendIncludeReview ? { includeReview } : {}),
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
      // On the first open, sync the toggle to eligibility. Subsequent
      // re-fetches keep the operator's choice (sendIncludeReview === true).
      if (!sendIncludeReview) {
        setIncludeReview(d.eligibility.canSend);
      }
      setEligibility(d.eligibility);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load preview");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Confirms the send action: POSTs to send-email, refreshes the page on success.
   */
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
      setSentAt(d.sentAt);
      setPreviewOpen(false);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send email");
    } finally {
      setSending(false);
    }
  }

  /**
   * Closes the preview modal without sending.
   */
  function closePreview(): void {
    if (sending) return;
    setPreviewOpen(false);
    setPreview(null);
    setError(null);
    // Drop eligibility so the next open re-fetches it and re-syncs the toggle
    // (state may have changed since this modal was last opened).
    setEligibility(null);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-3 print:hidden">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <FaCaretLeft className="h-4 w-4" aria-hidden />
          Back
        </Link>
        <button
          onClick={() => void downloadPdf()}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Save PDF
        </button>
        {driveWebUrl && (
          <a
            href={driveWebUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View PDF in Drive ↗
          </a>
        )}
        {isDraft && (
          <button
            type="button"
            onClick={() => void deleteDraft()}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete draft"}
          </button>
        )}
        {!isDraft && !isPaid && !isVoided && (
          <button
            type="button"
            onClick={() => void voidInvoice()}
            disabled={voiding}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {voiding ? "Voiding..." : "Void invoice"}
          </button>
        )}
        {isVoided && clientEmail && (
          <button
            type="button"
            onClick={resendVoidNotification}
            disabled={voiding}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-[#5a2a82] hover:bg-slate-50 disabled:opacity-50"
          >
            {voiding ? "Sending..." : "Resend void notification"}
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-3">
          {!isPaid && !isVoided && (
            <button
              type="button"
              onClick={() => void markPaid()}
              disabled={marking}
              className="rounded-lg border border-green-200 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              {marking ? "Saving..." : "Mark as paid"}
            </button>
          )}
          {!isVoided && (
            <button
              type="button"
              onClick={() => void openPreview()}
              disabled={!clientEmail}
              title={!clientEmail ? "Add a client email to enable sending" : undefined}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors",
                "bg-russian-violet hover:opacity-90",
                !clientEmail && "cursor-not-allowed opacity-40 hover:opacity-40",
              )}
            >
              {alreadySent ? "Re-send to client" : "Send to client"}
            </button>
          )}
        </div>
      </div>

      {error && !previewOpen && !voidModalOpen && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </p>
      )}

      {voidToast && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          {voidToast}
        </p>
      )}

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-russian-violet">Send invoice</h2>
                <p className="mt-1 text-sm text-slate-600">
                  To: <span className="font-medium">{preview?.to ?? clientEmail}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <p className="p-6 text-center text-sm text-slate-500">Loading preview...</p>
              )}
              {error && !loading && (
                <p className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              {preview && !loading && (
                <div className="p-6">
                  <label
                    htmlFor="greeting-name"
                    className="mb-2 block text-xs font-semibold text-slate-400 uppercase"
                  >
                    Greeting (the person you're emailing)
                  </label>
                  <input
                    id="greeting-name"
                    type="text"
                    value={greetingName}
                    onChange={(e) => setGreetingName(e.target.value)}
                    onBlur={() => void openPreview()}
                    placeholder="John (leave blank to use the first word of clientName)"
                    disabled={sending}
                    className={cn(
                      "mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm",
                      "ring-russian-violet/20 focus:border-russian-violet focus:ring-1 focus:outline-none",
                    )}
                  />
                  <label
                    htmlFor="custom-body"
                    className="mb-2 block text-xs font-semibold text-slate-400 uppercase"
                  >
                    Message
                  </label>
                  <textarea
                    id="custom-body"
                    rows={4}
                    value={customBody}
                    onChange={(e) => setCustomBody(e.target.value)}
                    onBlur={() => void openPreview()}
                    disabled={sending}
                    className={cn(
                      "mb-4 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm",
                      "ring-russian-violet/20 focus:border-russian-violet focus:ring-1 focus:outline-none",
                    )}
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
                            void openPreview();
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-russian-violet focus:ring-russian-violet/30"
                        />
                        <span className={cn(!eligibility.canSend && "text-slate-400")}>
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
                  <p className="mb-2 text-xs font-semibold text-slate-400 uppercase">Subject</p>
                  <p className="mb-4 text-sm font-medium text-slate-800">{preview.subject}</p>
                  <p className="mb-2 text-xs font-semibold text-slate-400 uppercase">Body</p>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                    <iframe
                      title="Invoice email preview"
                      srcDoc={preview.html}
                      sandbox="allow-same-origin"
                      className="h-105 w-full rounded bg-white"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={closePreview}
                disabled={sending}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmSend()}
                disabled={sending || loading || !!error || !preview}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white",
                  "bg-russian-violet hover:opacity-90 disabled:opacity-50",
                )}
              >
                {sending ? "Sending..." : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {voidModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-russian-violet">
                  {isVoided ? "Resend void notification" : "Void invoice"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {clientEmail ? (
                    isVoided ? (
                      <>
                        Re-send the void notification to{" "}
                        <span className="font-medium">{clientEmail}</span>. The invoice stays voided
                        either way.
                      </>
                    ) : (
                      <>
                        This invoice was sent to <span className="font-medium">{clientEmail}</span>.
                        Notify them so they don't pay the original.
                      </>
                    )
                  ) : (
                    "No client email on file - voiding silently."
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={closeVoidModal}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {error && (
                <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}

              {clientEmail && (
                <>
                  <label className="mb-3 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={voidSendNotification}
                      onChange={(e) => setVoidSendNotification(e.target.checked)}
                      disabled={voiding}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-russian-violet focus:ring-russian-violet/30"
                    />
                    <span>
                      Send notification email to <strong>{clientEmail}</strong>
                    </span>
                  </label>

                  {voidSendNotification && (
                    <>
                      <label
                        htmlFor="void-greeting-name"
                        className="mb-2 block text-xs font-semibold text-slate-400 uppercase"
                      >
                        Greeting (the person you're emailing)
                      </label>
                      <input
                        id="void-greeting-name"
                        type="text"
                        value={voidGreetingName}
                        onChange={(e) => setVoidGreetingName(e.target.value)}
                        onBlur={() => void loadVoidPreview()}
                        placeholder={`${clientName?.trim().split(" ")[0] || "First name"} (leave blank to use the first word of clientName)`}
                        disabled={voiding}
                        className={cn(
                          "mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm",
                          "ring-russian-violet/20 focus:border-russian-violet focus:ring-1 focus:outline-none",
                        )}
                      />
                      <label
                        htmlFor="void-custom-body"
                        className="mb-2 block text-xs font-semibold text-slate-400 uppercase"
                      >
                        Message
                      </label>
                      <textarea
                        id="void-custom-body"
                        rows={5}
                        value={voidCustomBody}
                        onChange={(e) => setVoidCustomBody(e.target.value)}
                        onBlur={() => void loadVoidPreview()}
                        disabled={voiding}
                        className={cn(
                          "mb-4 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm",
                          "ring-russian-violet/20 focus:border-russian-violet focus:ring-1 focus:outline-none",
                        )}
                      />
                      <p className="mb-2 text-xs font-semibold text-slate-400 uppercase">Subject</p>
                      <p className="mb-4 text-sm font-medium text-slate-800">
                        {voidPreview?.subject ?? `Invoice ${invoiceNumber} - voided`}
                      </p>
                      <p className="mb-2 text-xs font-semibold text-slate-400 uppercase">Body</p>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800">
                        {voidPreviewLoading && !voidPreview ? (
                          <p className="p-6 text-center text-sm text-slate-500">
                            Loading preview...
                          </p>
                        ) : voidPreview ? (
                          <iframe
                            title="Void notification email preview"
                            srcDoc={voidPreview.html}
                            sandbox="allow-same-origin"
                            className="h-105 w-full rounded bg-white"
                          />
                        ) : null}
                      </div>
                      <p className="mt-3 text-xs text-slate-500 italic">
                        The VOIDED-stamped PDF will be attached automatically.
                      </p>
                    </>
                  )}
                </>
              )}
              {!clientEmail && (
                <p className="text-sm text-slate-600">
                  No notification will be sent. The invoice will be marked VOIDED and the Drive PDF
                  will get a diagonal VOID stamp.
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={closeVoidModal}
                disabled={voiding}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void submitVoid({
                    sendNotification: Boolean(clientEmail) && voidSendNotification,
                    greetingName: voidGreetingName || undefined,
                    customBody: voidCustomBody,
                  })
                }
                disabled={voiding}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white",
                  "bg-russian-violet hover:opacity-90 disabled:opacity-50",
                )}
              >
                {voiding
                  ? isVoided
                    ? "Sending..."
                    : "Voiding..."
                  : isVoided
                    ? "Send notification"
                    : clientEmail && voidSendNotification
                      ? "Void & notify"
                      : "Void invoice"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddContact && (
        <AddToContactsModal
          name={clientName}
          email={clientEmail}
          onClose={() => {
            setShowAddContact(false);
            // Re-fetch eligibility so the review-link toggle unlocks once the
            // contact exists.
            void openPreview();
          }}
        />
      )}
    </>
  );
}
