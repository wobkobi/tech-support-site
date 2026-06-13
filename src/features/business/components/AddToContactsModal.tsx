"use client";
// src/features/business/components/AddToContactsModal.tsx
/**
 * @file AddToContactsModal.tsx
 * @description Post-action prompt asking the operator whether to save the
 * current client to the DB Contact table (and Google Contacts via the
 * fire-and-forget sync). Triggered after an invoice save succeeds or when
 * the calculator hands off to the invoice builder, but only when the email
 * doesn't already exist in the DB.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useState } from "react";

/**
 * Props for AddToContactsModal.
 */
export interface AddToContactsModalProps {
  /** Client name to seed the new Contact row with. */
  name: string;
  /** Client email - dedup key on the server. */
  email: string;
  /** Optional phone number (E.164 or local format). */
  phone?: string | null;
  /** Optional Google People API resource name (e.g. "people/c1234"). */
  googleContactId?: string | null;
  /**
   * Called whenever the modal closes - Yes, No, backdrop, Escape.
   * When the operator confirmed and the POST returned a Contact id, that id
   * is passed back so the caller can backfill an FK (e.g. patch the just-
   * saved invoice's `contactId`). Null on dismiss / failure.
   */
  onClose: (contactDbId?: string | null) => void;
}

/**
 * Confirmation popup: "{name} isn't in your contacts yet - add them?".
 * On Yes, POSTs to /api/admin/contacts and closes once the request settles.
 * @param props - Component props.
 * @param props.name - Client name to seed the new Contact row with.
 * @param props.email - Client email; the dedup key on the server.
 * @param props.phone - Optional phone number (E.164 or local format).
 * @param props.googleContactId - Optional Google People API resource name.
 * @param props.onClose - Called whenever the modal closes.
 * @returns Modal element.
 */
export function AddToContactsModal({
  name,
  email,
  phone,
  googleContactId,
  onClose,
}: AddToContactsModalProps): React.ReactElement {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /**
     * Closes the modal on Escape.
     * @param e - Keyboard event.
     */
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
      onClose(data.contact?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact");
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm",
      )}
      onClick={() => onClose(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Add to contacts"
    >
      <div
        className={cn(
          "w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn("flex items-center justify-between border-b border-slate-200 px-5 py-4")}
        >
          <h2 className={cn("text-base font-semibold text-russian-violet")}>Add to contacts?</h2>
          <button
            type="button"
            onClick={() => onClose(null)}
            className={cn(
              "text-2xl leading-none text-slate-400 transition-colors hover:text-slate-700",
            )}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={cn("space-y-3 px-5 py-4 text-sm text-slate-700")}>
          <p>
            <span className={cn("font-semibold")}>{name}</span>
            {
              " isn't in your contacts yet. Add them so you can send review links and pre-fill future invoices?"
            }
          </p>
          <p className={cn("text-xs text-slate-500")}>{email}</p>
          {error && <p className={cn("text-xs text-coquelicot-500")}>{error}</p>}
        </div>

        <div className={cn("flex justify-end gap-2 border-t border-slate-200 px-5 py-3")}>
          <button
            type="button"
            onClick={() => onClose(null)}
            disabled={saving}
            className={cn(
              "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
            )}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving}
            className={cn(
              "rounded-lg bg-moonstone-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-moonstone-700 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {saving ? "Adding..." : "Yes, add"}
          </button>
        </div>
      </div>
    </div>
  );
}
