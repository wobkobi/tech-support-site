"use client";
// src/app/admin/(shell)/business/invoices/[id]/SendInvoiceModal.tsx
// Send flow for the invoice detail page: the state + requests behind the send-to-client
// preview, and the modal with the editable greeting/body, the automatic review ask
// checkbox, and the "add to contacts" prompt when the ask would otherwise be skipped.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_QUOTE_EMAIL_BODY,
} from "@/features/business/lib/invoice-email-defaults";
import type { InvoiceReviewAskInfo } from "@/features/reviews/lib/review-ask-rules";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Send-flow state and actions returned by {@link useInvoiceSend}. */
export interface InvoiceSendFlow {
  previewOpen: boolean;
  /** `defaultGreeting` is who a blank greeting greets - the person behind a company invoice. */
  preview: { subject: string; html: string; to: string; defaultGreeting?: string } | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  sentLocal: boolean;
  greetingName: string;
  setGreetingName: (value: string) => void;
  customBody: string;
  setCustomBody: (value: string) => void;
  reviewAsk: boolean;
  setReviewAsk: (value: boolean) => void;
  /** Null when the invoice gets no automatic ask (quote, already decided, or asks off). */
  reviewAskInfo: InvoiceReviewAskInfo | null;
  showAddContact: boolean;
  setShowAddContact: (value: boolean) => void;
  openPreview: () => Promise<void>;
  confirmSend: () => Promise<void>;
  closePreview: () => void;
}

const FIELD_LABEL_CLS = "mb-2 block text-xs font-semibold text-admin-muted uppercase";
/** Static JSON request headers - module-scoped so it's a stable useCallback dep. */
const headers = { "Content-Type": "application/json" };

/**
 * Owns the send preview's state and the preview/send requests, and opens the
 * preview once on mount when asked to (calculator "Save & send").
 * @param opts - Hook options.
 * @param opts.invoiceId - Invoice id used by the preview-email and send-email routes.
 * @param opts.invoiceNumber - Used in the success toast.
 * @param opts.clientName - Used in the success toast.
 * @param opts.clientEmail - Recipient; auto-open is skipped when empty.
 * @param opts.isQuote - Swaps the default body to the quote wording.
 * @param opts.sentAt - First-sent stamp; seeds the local "already sent" flag.
 * @param opts.autoOpenSend - Open the send preview on mount when true.
 * @returns Send-flow state and actions.
 */
export function useInvoiceSend({
  invoiceId,
  invoiceNumber,
  clientName,
  clientEmail,
  isQuote,
  sentAt,
  autoOpenSend,
}: {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  isQuote: boolean;
  sentAt?: string | null;
  autoOpenSend: boolean;
}): InvoiceSendFlow {
  const router = useRouter();
  const { toast } = useToast();
  // Send-email preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
    to: string;
    defaultGreeting?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentLocal, setSentLocal] = useState<boolean>(sentAt != null);
  // Operator-typed greeting override. Empty = the preview's defaultGreeting.
  const [greetingName, setGreetingName] = useState("");
  // Editable email body, pre-populated with the default copy (quote wording
  // when the row is a quote).
  const [customBody, setCustomBody] = useState(
    isQuote ? DEFAULT_QUOTE_EMAIL_BODY : DEFAULT_INVOICE_EMAIL_BODY,
  );
  // The automatic review ask goes out unless the operator unticks it.
  const [reviewAsk, setReviewAsk] = useState(true);
  const [reviewAskInfo, setReviewAskInfo] = useState<InvoiceReviewAskInfo | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);

  /**
   * Opens the send modal and fetches the rendered email preview. Only spins on
   * the FIRST load so edit re-fetches keep the preview visible.
   */
  const openPreview = useCallback(
    async function openPreviewImpl(): Promise<void> {
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
          | {
              ok: true;
              subject: string;
              html: string;
              to: string;
              reviewAsk: InvoiceReviewAskInfo | null;
              defaultGreeting?: string;
            }
          | { error: string };
        if ("error" in d) throw new Error(d.error);
        setPreview({
          subject: d.subject,
          html: d.html,
          to: d.to,
          defaultGreeting: d.defaultGreeting,
        });
        setReviewAskInfo(d.reviewAsk);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load preview");
      } finally {
        setLoading(false);
      }
    },
    // greetingName/customBody/preview are read fresh each call so the preview
    // matches the operator's current edits.
    [invoiceId, greetingName, customBody, preview],
  );

  /** Confirms the send action: POSTs to send-email, refreshes on success. */
  async function confirmSend(): Promise<void> {
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          greetingName,
          customBody,
          ...(reviewAskInfo ? { reviewAsk } : {}),
        }),
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
    setReviewAsk(true);
  }, [sending]);

  // Calculator "Save & send": open the send preview once on mount.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (autoOpenSend && clientEmail && !didAutoOpen.current) {
      didAutoOpen.current = true;
      void openPreview();
    }
  }, [autoOpenSend, clientEmail, openPreview]);

  return {
    previewOpen,
    preview,
    loading,
    sending,
    error,
    sentLocal,
    greetingName,
    setGreetingName,
    customBody,
    setCustomBody,
    reviewAsk,
    setReviewAsk,
    reviewAskInfo,
    showAddContact,
    setShowAddContact,
    openPreview,
    confirmSend,
    closePreview,
  };
}

/**
 * Send invoice preview modal, plus the "add to contacts" modal it can open.
 * @param props - Component props.
 * @param props.flow - Send-flow state and actions from {@link useInvoiceSend}.
 * @param props.invoiceId - Invoice id the new contact gets backfilled onto.
 * @param props.clientName - Used in the "add to contacts" link and modal.
 * @param props.clientEmail - Recipient shown until the preview loads.
 * @returns Send modal element.
 */
export function SendInvoiceModal({
  flow,
  invoiceId,
  clientName,
  clientEmail,
}: {
  flow: InvoiceSendFlow;
  invoiceId: string;
  clientName: string;
  clientEmail: string;
}): React.ReactElement {
  const {
    previewOpen,
    preview,
    loading,
    sending,
    error,
    greetingName,
    setGreetingName,
    customBody,
    setCustomBody,
    reviewAsk,
    setReviewAsk,
    reviewAskInfo,
    showAddContact,
    setShowAddContact,
    openPreview,
    confirmSend,
    closePreview,
  } = flow;

  return (
    <>
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
          <p className="rounded-lg border border-coquelicot-200 bg-coquelicot-100 px-4 py-3 text-sm text-coquelicot-800">
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
              placeholder={
                preview.defaultGreeting
                  ? `Leave blank to greet ${preview.defaultGreeting}`
                  : "John (leave blank to use the first word of the client name)"
              }
              disabled={sending}
              className={cn(ADMIN_INPUT_CLS, "mb-4")}
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
              className={cn(ADMIN_INPUT_CLS, "mb-4 resize-y")}
            />
            {reviewAskInfo && (
              <div className="mb-4">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewAsk}
                    disabled={sending}
                    onChange={(e) => setReviewAsk(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Ask for a Google review in {reviewAskInfo.delayDays}{" "}
                    {reviewAskInfo.delayDays === 1 ? "day" : "days"}
                    <span className="ml-1 text-xs text-admin-muted">
                      (a separate email on {reviewAskInfo.dueLabel})
                    </span>
                  </span>
                </label>
                {reviewAsk && !reviewAskInfo.hasContact && (
                  <p className="mt-1 ml-6 text-xs text-admin-muted italic">
                    Not in your contacts yet -{" "}
                    <button
                      type="button"
                      onClick={() => setShowAddContact(true)}
                      className="font-semibold text-russian-violet not-italic underline hover:opacity-80"
                    >
                      add {clientName?.trim() || "them"} to contacts
                    </button>{" "}
                    before {reviewAskInfo.dueLabel} or no review ask will go out.
                  </p>
                )}
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

      {showAddContact && (
        <AddToContactsModal
          name={clientName}
          email={clientEmail}
          onClose={(newContactId) => {
            setShowAddContact(false);
            if (newContactId) {
              // Backfill the invoice's contactId (parity with the calculator's
              // save flow, so a "Save & send" invoice still links the contact).
              // Best-effort - the send proceeds without the FK if this fails.
              void fetch(`/api/business/invoices/${invoiceId}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ contactId: newContactId }),
              }).catch(() => undefined);
            }
            // Re-fetch so the "not in your contacts" note clears.
            void openPreview();
          }}
        />
      )}
    </>
  );
}
