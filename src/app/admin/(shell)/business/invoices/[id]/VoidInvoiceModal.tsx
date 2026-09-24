"use client";
// Void flow for the invoice detail page: the state + requests behind voiding (or
// re-notifying a VOIDED invoice), and the modal that previews the notification and warns
// when linked income entries would be left behind.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD } from "@/features/business/lib/business";
import { DEFAULT_VOID_EMAIL_BODY } from "@/features/business/lib/invoice-email-defaults";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useState } from "react";

/** Count + dollar total of income entries linked to this invoice. */
export interface LinkedIncome {
  count: number;
  total: number;
}

/** Void-flow state and actions returned by {@link useInvoiceVoid}. */
export interface InvoiceVoidFlow {
  voidModalOpen: boolean;
  voiding: boolean;
  error: string | null;
  voidGreetingName: string;
  setVoidGreetingName: (value: string) => void;
  voidCustomBody: string;
  setVoidCustomBody: (value: string) => void;
  voidSendNotification: boolean;
  setVoidSendNotification: (value: boolean) => void;
  voidPreview: { subject: string; html: string; to: string } | null;
  voidPreviewLoading: boolean;
  openVoidModal: () => void;
  resendVoidNotification: () => void;
  loadVoidPreview: (greetingOverride?: string, bodyOverride?: string) => Promise<void>;
  submitVoid: (opts: {
    sendNotification: boolean;
    greetingName?: string;
    customBody?: string;
  }) => Promise<void>;
  closeVoidModal: () => void;
}

const INPUT_CLS = cn(
  "w-full rounded-lg border border-admin-border-strong px-3 py-2 text-sm text-admin-text",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet",
);
const FIELD_LABEL_CLS = "mb-2 block text-xs font-semibold text-admin-muted uppercase";
/** Static JSON request headers - module-scoped so it's a stable useCallback dep. */
const headers = { "Content-Type": "application/json" };

/**
 * Owns the void modal's state and the preview/void requests.
 * @param opts - Hook options.
 * @param opts.invoiceId - Invoice id used by the preview-void-email and void routes.
 * @param opts.clientEmail - Recipient; with none the void goes through silently.
 * @param opts.onVoided - Called after a successful void so the caller can flip its status.
 * @returns Void-flow state and actions.
 */
export function useInvoiceVoid({
  invoiceId,
  clientEmail,
  onVoided,
}: {
  invoiceId: string;
  clientEmail: string;
  onVoided: () => void;
}): InvoiceVoidFlow {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

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
      onVoided();
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

  return {
    voidModalOpen,
    voiding,
    error,
    voidGreetingName,
    setVoidGreetingName,
    voidCustomBody,
    setVoidCustomBody,
    voidSendNotification,
    setVoidSendNotification,
    voidPreview,
    voidPreviewLoading,
    openVoidModal,
    resendVoidNotification,
    loadVoidPreview,
    submitVoid,
    closeVoidModal,
  };
}

/**
 * Void invoice / resend-notification modal.
 * @param props - Component props.
 * @param props.flow - Void-flow state and actions from {@link useInvoiceVoid}.
 * @param props.invoiceNumber - Used in the fallback subject line.
 * @param props.clientName - Used in the greeting placeholder.
 * @param props.clientEmail - Recipient; with none the modal explains the silent void.
 * @param props.isVoided - True when re-sending the notification on a VOIDED invoice.
 * @param props.linkedIncome - Linked income count + total for the pre-flight warning.
 * @returns Void modal element.
 */
export function VoidInvoiceModal({
  flow,
  invoiceNumber,
  clientName,
  clientEmail,
  isVoided,
  linkedIncome,
}: {
  flow: InvoiceVoidFlow;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  isVoided: boolean;
  linkedIncome: LinkedIncome;
}): React.ReactElement {
  const {
    voidModalOpen,
    voiding,
    error,
    voidGreetingName,
    setVoidGreetingName,
    voidCustomBody,
    setVoidCustomBody,
    voidSendNotification,
    setVoidSendNotification,
    voidPreview,
    voidPreviewLoading,
    loadVoidPreview,
    submitVoid,
    closeVoidModal,
  } = flow;

  return (
    <Modal
      open={voidModalOpen}
      onClose={closeVoidModal}
      dirty={!voiding && (voidGreetingName !== "" || voidCustomBody !== DEFAULT_VOID_EMAIL_BODY)}
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
        <p className="mb-4 rounded-lg border border-coquelicot-200 bg-coquelicot-100 px-4 py-3 text-sm text-coquelicot-800">
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
              <p className="mt-3 text-sm text-admin-muted italic">
                The VOIDED-stamped PDF will be attached automatically.
              </p>
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-admin-text-secondary">
          No notification will be sent. The invoice will be marked VOIDED and the Drive PDF will get
          a diagonal VOID stamp.
        </p>
      )}
    </Modal>
  );
}
