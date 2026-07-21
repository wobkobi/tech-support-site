"use client";
// src/features/admin/components/ContactDetailActions.tsx
/**
 * @description Header actions for the customer-360 detail page: edit the core
 * fields, sync to Google, send a review link, and soft-delete. Edits and the
 * sync PATCH/POST the same routes the contacts list uses; a delete routes back
 * to the list, since the contact no longer exists to show.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** The subset of contact fields these actions read or edit. */
interface ContactDetailActionsProps {
  /** Contact id. */
  id: string;
  /** Current name. */
  name: string;
  /** Current primary email, or null. */
  email: string | null;
  /** Current primary phone, or null. */
  phone: string | null;
  /** Current address, or null. */
  address: string | null;
  /** Google People resource id when synced, else null. */
  googleContactId: string | null;
}

const inputClass =
  "w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:border-russian-violet focus:outline-none";

/**
 * Action bar for the contact detail page.
 * @param props - Component props.
 * @param props.id - Contact id.
 * @param props.name - Current name.
 * @param props.email - Current primary email.
 * @param props.phone - Current primary phone.
 * @param props.address - Current address.
 * @param props.googleContactId - Google resource id when synced.
 * @returns Action bar element.
 */
export function ContactDetailActions({
  id,
  name,
  email,
  phone,
  address,
  googleContactId,
}: ContactDetailActionsProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "sync" | "delete">(null);

  const [form, setForm] = useState({
    name,
    email: email ?? "",
    phone: phone ?? "",
    address: address ?? "",
  });

  /** PATCHes the edited fields, then refreshes the server data on success. */
  async function save(): Promise<void> {
    if (!form.name.trim()) {
      toast("Name can't be empty.", { tone: "error" });
      return;
    }
    setBusy("save");
    try {
      const res = await fetch(`/api/admin/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setEditOpen(false);
      toast("Contact updated.", { tone: "success" });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  /** Pushes this contact to Google People. Best-effort - the server logs failures. */
  async function syncGoogle(): Promise<void> {
    setBusy("sync");
    try {
      const res = await fetch(`/api/admin/contacts/${id}/sync-google`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      toast("Synced to Google.", { tone: "success" });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  /** Soft-deletes the contact, then returns to the list. */
  async function remove(): Promise<void> {
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/contacts/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      toast("Contact deleted.", { tone: "success" });
      router.push("/admin/contacts");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed.", { tone: "error" });
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <AdminButton variant="secondary" onClick={() => setEditOpen(true)}>
        Edit
      </AdminButton>
      <AdminButton variant="secondary" onClick={() => void syncGoogle()} busy={busy === "sync"}>
        {googleContactId ? "Re-sync" : "Sync to Google"}
      </AdminButton>
      <AdminButton variant="secondary" href={`/admin/reviews?contactId=${id}`}>
        Send review link
      </AdminButton>
      <AdminButton variant="danger" onClick={() => setConfirmDelete(true)}>
        Delete
      </AdminButton>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit contact"
        footer={
          <>
            <AdminButton variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton onClick={() => void save()} busy={busy === "save"}>
              Save
            </AdminButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-admin-muted">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-admin-muted">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-admin-muted">Phone</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-admin-muted">Address</span>
            <input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this contact?"
        body="It's removed from the list and unlinked from its reviews. Bookings and invoices are kept."
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
