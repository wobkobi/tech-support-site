"use client";
// src/features/business/components/AddToContactsModal.tsx
// Post-action prompt asking the operator whether to save the current client to the DB
// Contact table (and Google Contacts via the fire-and-forget sync). Triggered after an
// invoice save succeeds or when the calculator hands off to the invoice builder, but only
// when the email doesn't already exist in the DB. When the client is a known contact
// missing that email, it offers to add the email to them instead.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import type React from "react";
import { useState } from "react";

/**
 * Props for AddToContactsModal.
 */
interface AddToContactsModalProps {
  /** Client name to seed the new Contact row with. */
  name: string;
  /** Client email - dedup key on the server. */
  email: string;
  /** Optional phone number (E.164 or local format). */
  phone?: string | null;
  /** Optional Google People API resource name (e.g. "people/c1234"). */
  googleContactId?: string | null;
  /**
   * Name of the contact already linked to `googleContactId` that lacks this email.
   * When set, the popup offers to add the email to that contact instead.
   */
  existingContactName?: string | null;
  /**
   * Called whenever the modal closes - Yes, No, backdrop, Escape.
   * When the operator confirmed and the POST returned a Contact id, that id
   * is passed back so the caller can backfill an FK (e.g. patch the just-
   * saved invoice's `contactId`). Null on dismiss / failure.
   */
  onClose: (contactDbId?: string | null) => void;
}

/**
 * Confirmation popup: "{name} isn't in your contacts yet - add them?", or, when
 * the client is already a contact without this email, "add the email to them?".
 * On Yes, POSTs to /api/admin/contacts (which attaches the email to the linked
 * contact in the second case) and closes once the request settles.
 * @param props - Component props.
 * @param props.name - Client name to seed the new Contact row with.
 * @param props.email - Client email; the dedup key on the server.
 * @param props.phone - Optional phone number (E.164 or local format).
 * @param props.googleContactId - Optional Google People API resource name.
 * @param props.existingContactName - Existing contact that lacks this email, if any.
 * @param props.onClose - Called whenever the modal closes.
 * @returns Modal element.
 */
export function AddToContactsModal({
  name,
  email,
  phone,
  googleContactId,
  existingContactName,
  onClose,
}: AddToContactsModalProps): React.ReactElement {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  /**
   * Persists the contact then closes. Passes the new Contact's DB id back via
   * `onClose` so the caller can backfill an FK on a parent row (e.g. set
   * `Invoice.contactId`). Closes anyway with `null` if the request fails so
   * the caller's deferred navigation still happens.
   */
  async function handleConfirm(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, googleContactId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save contact");
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        contact?: { id?: string };
      };
      toast(existingContactName ? "Email added to contact." : "Contact saved.", {
        tone: "success",
      });
      onClose(data.contact?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => onClose(null)}
      title={existingContactName ? "Add email to contact?" : "Add to contacts?"}
      size="sm"
      footer={
        <>
          <AdminButton variant="secondary" onClick={() => onClose(null)} disabled={saving}>
            Not now
          </AdminButton>
          <AdminButton variant="primary" onClick={() => void handleConfirm()} busy={saving}>
            {existingContactName ? "Yes, add email" : "Yes, add"}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-sm text-admin-text">
        {existingContactName ? (
          <p>
            <span className="font-semibold">{existingContactName}</span>
            {
              " is in your contacts but doesn't have this email. Add it so you can send review links and pre-fill future invoices?"
            }
          </p>
        ) : (
          <p>
            <span className="font-semibold">{name}</span>
            {
              " isn't in your contacts yet. Add them so you can send review links and pre-fill future invoices?"
            }
          </p>
        )}
        <p className="text-xs text-admin-muted">{email}</p>
        {error && <p className="text-sm text-coquelicot-500">{error}</p>}
      </div>
    </Modal>
  );
}
