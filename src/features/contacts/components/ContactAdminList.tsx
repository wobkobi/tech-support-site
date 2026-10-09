"use client";
// src/features/contacts/components/ContactAdminList.tsx
// Admin component listing contacts saved from booking submissions, with inline editing
// and Google Places autocomplete for the address field. Contacts are split into
// sections: new (last 7 days), unsynced (needs attention) and synced (already linked to
// Google Contacts, shown in a collapsible drawer). Phones show each contact as a
// ContactCard; from lg each section is a ContactTable.

import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ShowMoreButton } from "@/features/admin/components/ui/ShowMoreButton";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { type PageQuery, queryValue, useQuerySync } from "@/features/admin/hooks/use-query-sync";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import { validateEmail } from "@/features/booking/lib/booking";
import {
  ContactCard,
  type ContactCardProps,
  type ContactRow,
  type EditValues,
} from "@/features/contacts/components/ContactCard";
import {
  ContactListToolbar,
  type ContactSort,
  type SyncFilter,
} from "@/features/contacts/components/ContactListToolbar";
import {
  ContactMergeBanner,
  ContactMergeDialog,
} from "@/features/contacts/components/ContactMergePrompts";
import { ContactTable } from "@/features/contacts/components/ContactTable";
import { cn } from "@/shared/lib/cn";
import { validatePhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useEffect, useState } from "react";

/** Section heading: the admin eyebrow, coloured per section. */
const SECTION_HEADING_CLS = "text-sm font-bold tracking-wide uppercase";

const PAGE_LOAD_TIME = Date.now();

/** Synced contacts per "Show more" batch. */
const BATCH = 25;

/**
 * Editable list of contacts captured from booking submissions.
 * Unsynced contacts (no Google Contact link) are shown prominently at the top.
 * Synced contacts are grouped in a collapsible section below.
 * @param props - Component props.
 * @param props.contacts - Contact rows to display.
 * @param props.query - The page's searchParams, the starting filters.
 * @returns Contact list element.
 */
export function ContactAdminList({
  contacts: initialContacts,
  query: pageQuery,
}: {
  contacts: ContactRow[];
  query: PageQuery;
}): React.ReactElement {
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContacts(initialContacts);
  }, [initialContacts]);
  // Edit, sync, and UI state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({
    name: "",
    email: "",
    phone: "",
    address: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { toast } = useToast();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmSyncId, setConfirmSyncId] = useState<string | null>(null);
  const [expandedReviewsId, setExpandedReviewsId] = useState<string | null>(null);
  const [syncedOpen, setSyncedOpen] = useState(true);
  // The search, chips and sort start from the URL and write back to it.
  const [query, setQuery] = useState(() => queryValue(pageQuery, "q"));
  // Filter chips, AND-combined with the search. Sync is tri-state (all/one/other)
  // since a contact is exactly one of synced or not.
  const [syncFilter, setSyncFilter] = useState<SyncFilter>(() => {
    const v = queryValue(pageQuery, "sync");
    return v === "synced" || v === "unsynced" ? v : "all";
  });
  const [reviewedOnly, setReviewedOnly] = useState(() => queryValue(pageQuery, "reviewed") === "1");
  const [retainerOnly, setRetainerOnly] = useState(() => queryValue(pageQuery, "retainer") === "1");
  const [noEmail, setNoEmail] = useState(() => queryValue(pageQuery, "noemail") === "1");
  const [noPhone, setNoPhone] = useState(() => queryValue(pageQuery, "nophone") === "1");
  const [sort, setSort] = useState<ContactSort>(() => {
    const v = queryValue(pageQuery, "sort");
    return v === "newest" || v === "oldest" ? v : "name";
  });
  useQuerySync({
    q: query,
    sync: syncFilter === "all" ? "" : syncFilter,
    reviewed: reviewedOnly ? "1" : "",
    retainer: retainerOnly ? "1" : "",
    noemail: noEmail ? "1" : "",
    nophone: noPhone ? "1" : "",
    sort: sort === "name" ? "" : sort,
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Ticked by default: deleting a contact normally means dropping the person
  // altogether, and leaving the Google entry would let the sync pull them back.
  const [deleteGoogle, setDeleteGoogle] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Contact currently selected to merge away; while set, every other card offers
  // to become the survivor. Null when no merge is in progress.
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  // The survivor picked for that merge, held while the confirm dialog is open.
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const NEW_CONTACT_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Sorts contacts alphabetically by name (case-insensitive).
   * @param a - First contact.
   * @param b - Second contact.
   * @returns Negative, zero, or positive sort order.
   */
  function alphSort(a: ContactRow, b: ContactRow): number {
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  }

  /**
   * Sorts contacts by the chosen order: name, or created date newest/oldest.
   * @param a - First contact.
   * @param b - Second contact.
   * @returns Comparator result.
   */
  function bySort(a: ContactRow, b: ContactRow): number {
    if (sort === "name") return alphSort(a, b);
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    return sort === "newest" ? bt - at : at - bt;
  }

  /**
   * Returns true if the contact was created within the last 7 days.
   * @param c - Contact row to test.
   * @returns Whether the contact is considered new.
   */
  function isNew(c: ContactRow): boolean {
    return PAGE_LOAD_TIME - new Date(c.createdAt).getTime() < NEW_CONTACT_MS;
  }

  // Filter and bucket contacts
  const q = query.toLowerCase().trim();
  const visible = q
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.altEmails.some((e) => e.toLowerCase().includes(q)) ||
          c.phone?.includes(q) ||
          c.altPhones.some((p) => p.includes(q)) ||
          c.address?.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q),
      )
    : contacts;

  const anyFilter = syncFilter !== "all" || reviewedOnly || retainerOnly || noEmail || noPhone;
  const filtered = visible.filter((c) => {
    if (syncFilter === "synced" && !c.googleContactId) return false;
    if (syncFilter === "unsynced" && c.googleContactId) return false;
    if (reviewedOnly && c.reviews.length === 0) return false;
    if (retainerOnly && !c.retainerTier) return false;
    if (noEmail && c.email) return false;
    if (noPhone && c.phone) return false;
    return true;
  });

  const newContacts = filtered.filter(isNew).sort(bySort);
  const rest = filtered.filter((c) => !isNew(c));
  const unsynced = rest.filter((c) => !c.googleContactId).sort(bySort);
  const synced = rest.filter((c) => !!c.googleContactId).sort(bySort);
  // Only the synced group is capped: it holds nearly everyone, while the new and
  // needs-syncing groups are short and are the ones that want attention.
  const syncedPager = useShowMore(
    synced,
    BATCH,
    [q, syncFilter, reviewedOnly, retainerOnly, noEmail, noPhone, sort].join("|"),
  );

  /**
   * Opens the inline edit form for a contact row.
   * @param c - The contact row to edit.
   */
  function startEdit(c: ContactRow): void {
    setEditingId(c.id);
    setEditValues({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
    });
    setEditError(null);
  }

  /**
   * Updates one field of the edit form.
   * @param field - Field key.
   * @param value - New value.
   */
  function setEditField<K extends keyof EditValues>(field: K, value: EditValues[K]): void {
    setEditValues((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Closes the inline edit form without saving.
   */
  function cancelEdit(): void {
    setEditingId(null);
    setEditError(null);
  }

  /**
   * Downloads the full contacts CSV via the admin API and triggers a browser save dialog.
   * Uses fetch + blob rather than a plain download link, so a failed export is reported
   * instead of the browser saving the error page as contacts.csv.
   */
  async function exportContacts(): Promise<void> {
    setExporting(true);
    try {
      const res = await fetch("/api/admin/contacts/export");
      if (!res.ok) {
        toast(`Export failed (error ${res.status}) - try again.`, { tone: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "contacts.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[ContactAdminList] Export error:", err);
      toast("Network error - the export didn't download.", { tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  /**
   * Syncs a contact to Google Contacts via the admin API.
   * On success, updates the local state to reflect synced status.
   * @param id - Contact ID to sync.
   */
  async function syncToGoogle(id: string): Promise<void> {
    setConfirmSyncId(null);
    setSyncingId(id);
    try {
      const res = await fetch(`/api/admin/contacts/${id}/sync-google`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.id === id ? { ...c, googleContactId: "synced" } : c)),
        );
        toast("Synced to Google Contacts.", { tone: "success" });
      } else {
        toast(data.error ?? "Couldn't sync that contact - try again.", { tone: "error" });
      }
    } catch (err) {
      console.error("[ContactAdminList] Sync network error:", err);
      toast("Network error - the contact wasn't synced.", { tone: "error" });
    } finally {
      setSyncingId(null);
    }
  }

  /**
   * Saves the edited contact by calling PATCH and updating local state.
   * @param id - The contact ID being saved.
   */
  async function saveEdit(id: string): Promise<void> {
    if (!editValues.name.trim()) {
      setEditError("Name is required.");
      return;
    }
    if (validateEmail(editValues.email) !== "ok") {
      setEditError("Please enter a valid email address.");
      return;
    }
    if (validatePhone(editValues.phone).result === "invalid") {
      setEditError("Please enter a valid phone number.");
      return;
    }
    setEditError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/contacts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editValues),
      });
      const data = (await res.json()) as {
        ok: boolean;
        contact?: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          address: string | null;
        };
        error?: string;
      };
      if (data.ok && data.contact) {
        setContacts((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: data.contact!.name,
                  email: data.contact!.email,
                  phone: data.contact!.phone,
                  address: data.contact!.address,
                }
              : c,
          ),
        );
        setEditingId(null);
        setEditError(null);
        toast("Contact updated.", { tone: "success" });
      } else {
        setEditError(data.error ?? "Save failed. Please try again.");
      }
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Toggles the expanded reviews panel for a contact.
   * @param id - Contact ID whose reviews panel should be toggled.
   */
  function toggleReviews(id: string): void {
    setExpandedReviewsId((prev) => (prev === id ? null : id));
  }

  /**
   * Opens the delete confirmation for a contact. Resets the Google choice with
   * each open, so an earlier untick can't silently carry over to the next one.
   * @param id - Contact ID being confirmed for deletion.
   */
  function requestDelete(id: string): void {
    setDeleteGoogle(true);
    setDeleteConfirmId(id);
  }

  /**
   * Soft-deletes a contact via the admin API and drops it from the list.
   * @param id - Contact ID to delete.
   */
  async function deleteContact(id: string): Promise<void> {
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/admin/contacts/${id}${deleteGoogle ? "" : "?deleteGoogle=false"}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setContacts((prev) => prev.filter((c) => c.id !== id));
        toast("Contact deleted.", { tone: "success" });
      } else {
        // Say so. Acting only on ok left a failed delete completely silent: the
        // row stayed put with no explanation, which reads as a dead button.
        toast(data.error ?? "Couldn't delete that contact - try again.", { tone: "error" });
      }
    } catch (err) {
      console.error("[ContactAdminList] Delete error:", err);
      toast("Network error - the contact wasn't deleted.", { tone: "error" });
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  }

  /**
   * Merges the selected source contact into the chosen primary, then drops the
   * source (now soft-deleted) from the list.
   * @param primaryId - The contact to keep.
   */
  async function mergeInto(primaryId: string): Promise<void> {
    const secondaryId = mergeSourceId;
    if (!secondaryId || secondaryId === primaryId) {
      setMergeSourceId(null);
      setMergeTargetId(null);
      return;
    }
    setMerging(true);
    try {
      const res = await fetch(`/api/admin/contacts/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, secondaryId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setContacts((prev) => prev.filter((c) => c.id !== secondaryId));
        toast("Contacts merged.", { tone: "success" });
      } else {
        // A merge folds one contact into another and deletes it, so a silent
        // failure is the worst kind: the operator cannot tell whether the two
        // were combined or nothing happened at all.
        toast(data.error ?? "Couldn't merge those contacts - try again.", { tone: "error" });
      }
    } catch (err) {
      console.error("[ContactAdminList] Merge error:", err);
      toast("Network error - the contacts weren't merged.", { tone: "error" });
    } finally {
      setMerging(false);
      setMergeSourceId(null);
      setMergeTargetId(null);
    }
  }

  /**
   * Wraps saveEdit to return void for use as an event handler.
   * @param id - Contact ID to save.
   */
  function handleSaveEdit(id: string): void {
    void saveEdit(id);
  }

  /**
   * Confirms and executes the sync for the given contact ID.
   * @param id - Contact ID to sync.
   */
  function handleConfirmSyncToGoogle(id: string): void {
    void syncToGoogle(id);
  }

  /**
   * Clears the pending sync confirmation.
   */
  function handleCancelSyncToGoogle(): void {
    setConfirmSyncId(null);
  }

  /**
   * Wraps deleteContact to return void for use as an event handler.
   * @param id - Contact ID to delete.
   */
  function handleDeleteContact(id: string): void {
    void deleteContact(id);
  }

  /**
   * Wraps mergeInto to return void for use as an event handler.
   * @param id - Contact ID to keep (the merge target).
   */
  function handleMergeInto(id: string): void {
    void mergeInto(id);
  }

  const mergeSource = contacts.find((c) => c.id === mergeSourceId);
  const mergeTarget = contacts.find((c) => c.id === mergeTargetId);

  /**
   * Builds the per-card props (everything except `c` itself).
   * @param c - Contact row this card is for.
   * @returns Card props excluding `c`.
   */
  function buildCardProps(c: ContactRow): Omit<ContactCardProps, "c"> {
    return {
      edit:
        editingId === c.id
          ? {
              values: editValues,
              saving,
              error: editError,
              setField: setEditField,
              save: handleSaveEdit.bind(null, c.id),
              cancel: cancelEdit,
            }
          : null,
      isSyncing: syncingId === c.id,
      isConfirmingSync: confirmSyncId === c.id,
      isReviewsExpanded: expandedReviewsId === c.id,
      isConfirmingDelete: deleteConfirmId === c.id,
      deleteGoogle,
      onDeleteGoogleChange: setDeleteGoogle,
      isDeleting: deletingId === c.id,
      mergeRole: mergeSourceId === null ? "idle" : mergeSourceId === c.id ? "source" : "target",
      onStartEdit: startEdit.bind(null, c),
      onRequestSync: setConfirmSyncId.bind(null, c.id),
      onConfirmSync: handleConfirmSyncToGoogle.bind(null, c.id),
      onCancelSync: handleCancelSyncToGoogle,
      onToggleReviews: toggleReviews.bind(null, c.id),
      onRequestDelete: requestDelete.bind(null, c.id),
      onConfirmDelete: handleDeleteContact.bind(null, c.id),
      onCancelDelete: setDeleteConfirmId.bind(null, null),
      onStartMerge: setMergeSourceId.bind(null, c.id),
      // Merging can't be undone, so picking the survivor asks first.
      onMergeHere: setMergeTargetId.bind(null, c.id),
      onCancelMerge: setMergeSourceId.bind(null, null),
    };
  }

  /**
   * Renders one section's contacts: cards on phones, the table from lg.
   * @param list - Contacts in the section, already sorted and paged.
   * @returns The section body.
   */
  function renderGroup(list: ContactRow[]): React.ReactElement {
    return (
      <>
        <div className="flex flex-col gap-3 lg:hidden">
          {list.map((c) => (
            <ContactCard key={c.id} c={c} {...buildCardProps(c)} />
          ))}
        </div>
        <ContactTable contacts={list} cardProps={buildCardProps} />
      </>
    );
  }

  if (contacts.length === 0) {
    return <EmptyState title="No contacts yet. They will appear here after customers book." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {mergeSourceId && (
        <ContactMergeBanner source={mergeSource} onCancel={() => setMergeSourceId(null)} />
      )}

      <ContactListToolbar
        query={query}
        setQuery={setQuery}
        exporting={exporting}
        onExport={() => void exportContacts()}
        syncFilter={syncFilter}
        setSyncFilter={setSyncFilter}
        reviewedOnly={reviewedOnly}
        setReviewedOnly={setReviewedOnly}
        retainerOnly={retainerOnly}
        setRetainerOnly={setRetainerOnly}
        noEmail={noEmail}
        setNoEmail={setNoEmail}
        noPhone={noPhone}
        setNoPhone={setNoPhone}
        anyFilter={anyFilter}
        onClearFilters={() => {
          setSyncFilter("all");
          setReviewedOnly(false);
          setRetainerOnly(false);
          setNoEmail(false);
          setNoPhone(false);
        }}
        sort={sort}
        setSort={setSort}
      />

      <ContactMergeDialog
        source={mergeSource}
        target={mergeTarget}
        busy={merging}
        onConfirm={() => mergeTargetId && handleMergeInto(mergeTargetId)}
        onCancel={() => setMergeTargetId(null)}
      />

      {/* New contacts - added in the last 7 days */}
      {newContacts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className={cn(SECTION_HEADING_CLS, "flex items-center gap-2 text-admin-text")}>
            New
            <StatusPill tone="info">{newContacts.length}</StatusPill>
          </h3>
          {renderGroup(newContacts)}
        </section>
      )}

      {/* Unsynced contacts - shown prominently */}
      {unsynced.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className={cn(SECTION_HEADING_CLS, "text-russian-violet")}>
            Needs syncing ({unsynced.length})
          </h3>
          {renderGroup(unsynced)}
        </section>
      ) : (
        <p className="text-sm text-admin-muted">All contacts are synced to Google.</p>
      )}

      {/* Synced contacts - collapsible */}
      {synced.length > 0 && (
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setSyncedOpen((o) => !o)}
            aria-expanded={syncedOpen}
            className="flex items-center gap-2 self-start text-left"
          >
            <span className={cn(SECTION_HEADING_CLS, "text-admin-muted")}>
              Synced contacts ({synced.length})
            </span>
            <span className="text-sm text-admin-muted">{syncedOpen ? "▲" : "▼"}</span>
          </button>
          {syncedOpen && (
            <div className="flex flex-col gap-3">
              {renderGroup(syncedPager.visible)}
              <ShowMoreButton pager={syncedPager} noun={["contact", "contacts"]} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
