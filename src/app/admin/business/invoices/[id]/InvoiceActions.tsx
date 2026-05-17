"use client";

import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/shared/lib/cn";
import { DEFAULT_INVOICE_EMAIL_BODY } from "@/features/business/lib/invoice-email-defaults";

interface InvoiceActionsProps {
  backHref: string;
  driveWebUrl: string | null;
  invoiceId: string;
  invoiceNumber: string;
  clientEmail: string;
  status: string;
  token: string;
}

/**
 * Action bar for an invoice detail page: back, print, Drive PDF, and Send to
 * client (with an email-preview modal).
 * @param props - Component props.
 * @param props.backHref - URL for the back button.
 * @param props.driveWebUrl - Optional Google Drive PDF URL.
 * @param props.invoiceId - Invoice id used by the preview/send routes.
 * @param props.invoiceNumber - Invoice number used in the downloaded PDF filename.
 * @param props.clientEmail - Recipient email; "Send" is disabled when empty.
 * @param props.status - Current invoice status (drives the "Sent" indicator).
 * @param props.token - Admin token forwarded as X-Admin-Secret on POSTs.
 * @returns Invoice actions element with modal.
 */
export function InvoiceActions({
  backHref,
  driveWebUrl,
  invoiceId,
  invoiceNumber,
  clientEmail,
  status,
  token,
}: InvoiceActionsProps): React.ReactElement {
  const router = useRouter();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  // Operator-typed greeting override. Empty = use the first word of clientName.
  // Useful when the invoice is for a company but the email goes to a specific
  // person inside it.
  const [greetingName, setGreetingName] = useState("");
  // Editable email body. Pre-populated with the default copy; operator can
  // tweak before each send. White-space is preserved when rendered.
  const [customBody, setCustomBody] = useState(DEFAULT_INVOICE_EMAIL_BODY);

  const headers = { "X-Admin-Secret": token, "Content-Type": "application/json" };
  const alreadySent = currentStatus === "SENT" || sentAt !== null;
  const isPaid = currentStatus === "PAID";
  const isDraft = currentStatus === "DRAFT";

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
      const res = await fetch(`/api/business/invoices/${invoiceId}/preview-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ greetingName, customBody }),
      });
      const d = (await res.json()) as
        | { ok: true; subject: string; html: string; to: string }
        | { error: string };
      if ("error" in d) throw new Error(d.error);
      setPreview({ subject: d.subject, html: d.html, to: d.to });
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
        body: JSON.stringify({ greetingName, customBody }),
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
  }

  return (
    <>
      <div className={cn("mb-6 flex flex-wrap gap-3 print:hidden")}>
        <Link
          href={backHref}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
          )}
        >
          ← Back
        </Link>
        <button
          onClick={() => void downloadPdf()}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
          )}
        >
          Save PDF
        </button>
        {driveWebUrl && (
          <a
            href={driveWebUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
            )}
          >
            View PDF in Drive ↗
          </a>
        )}
        {isDraft && (
          <button
            type="button"
            onClick={() => void deleteDraft()}
            disabled={deleting}
            className={cn(
              "rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50",
            )}
          >
            {deleting ? "Deleting..." : "Delete draft"}
          </button>
        )}
        <div className={cn("ml-auto flex flex-wrap gap-3")}>
          {!isPaid && (
            <button
              type="button"
              onClick={() => void markPaid()}
              disabled={marking}
              className={cn(
                "rounded-lg border border-green-200 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50",
              )}
            >
              {marking ? "Saving..." : "Mark as paid"}
            </button>
          )}
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
        </div>
      </div>

      {error && !previewOpen && (
        <p
          className={cn(
            "mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden",
          )}
        >
          {error}
        </p>
      )}

      {previewOpen && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden",
          )}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={cn(
              "flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                "flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4",
              )}
            >
              <div className={cn("min-w-0")}>
                <h2 className={cn("text-russian-violet text-lg font-bold")}>Send invoice</h2>
                <p className={cn("mt-1 text-sm text-slate-600")}>
                  To: <span className={cn("font-medium")}>{preview?.to ?? clientEmail}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                aria-label="Close"
                className={cn("text-slate-400 hover:text-slate-700")}
              >
                ×
              </button>
            </div>

            <div className={cn("flex-1 overflow-y-auto")}>
              {loading && (
                <p className={cn("p-6 text-center text-sm text-slate-500")}>Loading preview...</p>
              )}
              {error && !loading && (
                <p
                  className={cn(
                    "m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700",
                  )}
                >
                  {error}
                </p>
              )}
              {preview && !loading && (
                <div className={cn("p-6")}>
                  <label
                    htmlFor="greeting-name"
                    className={cn("mb-2 block text-xs font-semibold uppercase text-slate-400")}
                  >
                    Greeting (the person you're emailing)
                  </label>
                  <input
                    id="greeting-name"
                    type="text"
                    value={greetingName}
                    onChange={(e) => setGreetingName(e.target.value)}
                    onBlur={() => void openPreview()}
                    placeholder="Vicky (leave blank to use the first word of clientName)"
                    disabled={sending}
                    className={cn(
                      "mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm",
                      "ring-russian-violet/20 focus:border-russian-violet focus:outline-none focus:ring-1",
                    )}
                  />
                  <label
                    htmlFor="custom-body"
                    className={cn("mb-2 block text-xs font-semibold uppercase text-slate-400")}
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
                      "ring-russian-violet/20 focus:border-russian-violet focus:outline-none focus:ring-1",
                    )}
                  />
                  <p className={cn("mb-2 text-xs font-semibold uppercase text-slate-400")}>
                    Subject
                  </p>
                  <p className={cn("mb-4 text-sm font-medium text-slate-800")}>{preview.subject}</p>
                  <p className={cn("mb-2 text-xs font-semibold uppercase text-slate-400")}>Body</p>
                  <div
                    className={cn(
                      "rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-800",
                    )}
                  >
                    <iframe
                      title="Invoice email preview"
                      srcDoc={preview.html}
                      sandbox=""
                      className={cn("h-105 w-full rounded bg-white")}
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              className={cn("flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-4")}
            >
              <button
                type="button"
                onClick={closePreview}
                disabled={sending}
                className={cn(
                  "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
                )}
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
    </>
  );
}
