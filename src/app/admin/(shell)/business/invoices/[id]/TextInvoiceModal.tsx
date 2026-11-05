"use client";
// src/app/admin/(shell)/business/invoices/[id]/TextInvoiceModal.tsx
// Text an invoice or quote from the operator's own phone: the server writes the message
// (with the customer link), Messages or the clipboard carries it, and Mark as sent records
// it like an emailed send. There's no SMS provider, so the site never sends it itself.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { apiFetch } from "@/shared/lib/api-client";
import { displayNZPhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useEffect, useState } from "react";

interface TextInvoiceModalProps {
  /** Whether the modal is showing. Remount it (a new key) per open for a fresh message. */
  open: boolean;
  /** Closes the modal. */
  onClose: () => void;
  invoiceId: string;
  clientName: string;
  isQuote: boolean;
  /** Already sent by email or text, so there's nothing left to record. */
  alreadySent: boolean;
  /** Called once a draft is recorded as sent. */
  onSent: () => void;
}

/**
 * An `sms:` link that opens Messages with the number and text filled in. The `?&body=`
 * form works on both iPhone and Android; with no number the phone asks who to send it to.
 * @param phone - The contact's mobile as stored, or null.
 * @param body - The message text.
 * @returns The link.
 */
function smsHref(phone: string | null, body: string): string {
  const to = phone ? phone.replace(/[^\d+]/g, "") : "";
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

/**
 * The Text modal: an editable message, Open in Messages, Copy, and Mark as sent.
 * @param props - Component props.
 * @param props.open - Whether the modal is showing.
 * @param props.onClose - Closes the modal.
 * @param props.invoiceId - Invoice to text.
 * @param props.clientName - Shown in the title.
 * @param props.isQuote - Quote or invoice wording in the title.
 * @param props.alreadySent - Hides Mark as sent once the invoice has gone out.
 * @param props.onSent - Called after Mark as sent records a draft as sent.
 * @returns The modal element.
 */
export function TextInvoiceModal({
  open,
  onClose,
  invoiceId,
  clientName,
  isQuote,
  alreadySent,
  onSent,
}: TextInvoiceModalProps): React.ReactElement {
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);

  // The parent remounts this on every open, so each open writes a fresh message.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void apiFetch<{ text: string; phone: string | null }>(
      `/api/business/invoices/${invoiceId}/text`,
      { method: "POST" },
    ).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText(res.data.text);
      setPhone(res.data.phone);
    });
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId]);

  /** Copies the message as it stands, edits included. */
  async function copy(): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast("Couldn't copy - select the text and copy it instead.", { tone: "error" });
    }
  }

  /** Records the text as sent, as an email send would. */
  async function markSent(): Promise<void> {
    setMarking(true);
    const res = await apiFetch(`/api/business/invoices/${invoiceId}/texted`, { method: "POST" });
    setMarking(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`${isQuote ? "Quote" : "Invoice"} marked as sent.`, { tone: "success" });
    onSent();
    onClose();
  }

  const noun = isQuote ? "quote" : "invoice";
  return (
    <Modal
      open={open}
      onClose={() => !marking && onClose()}
      title={`Text the ${noun} to ${clientName || "the client"}`}
      description={
        phone
          ? `To ${displayNZPhone(phone)}. It sends from your own phone, so replies come to you.`
          : `No mobile on the ${noun} or their contact - pick them when Messages opens. It sends from your own phone.`
      }
      size="md"
      placement="top"
      footer={
        <>
          <AdminButton variant="secondary" onClick={() => void copy()} disabled={!text}>
            {copied ? "Copied!" : "Copy text"}
          </AdminButton>
          {text ? (
            <a href={smsHref(phone, text)} className={adminButtonClass({ variant: "secondary" })}>
              Open in Messages
            </a>
          ) : (
            <AdminButton variant="secondary" disabled>
              Open in Messages
            </AdminButton>
          )}
          {alreadySent ? (
            <AdminButton onClick={onClose}>Done</AdminButton>
          ) : (
            <AdminButton onClick={() => void markSent()} busy={marking} disabled={!text}>
              Mark as sent
            </AdminButton>
          )}
        </>
      }
    >
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : text === null ? (
        <p className="text-sm text-admin-muted">Writing the text...</p>
      ) : (
        <div className="space-y-2">
          <AdminTextarea
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCopied(false);
            }}
            aria-label="Message"
          />
          {!alreadySent && (
            <p className="text-sm text-admin-muted">
              Once it&apos;s gone, press Mark as sent so the {noun} shows as sent.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
