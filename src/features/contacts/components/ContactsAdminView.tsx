"use client";
// src/features/contacts/components/ContactsAdminView.tsx
// Client wrapper for the contacts page. Surfaces name/phone conflicts for one-click
// resolution and drives the Google Contacts sync (import + push) with a confirmation step
// and result message.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import type { PageQuery } from "@/features/admin/hooks/use-query-sync";
import type { ConflictEntry } from "@/features/contacts/lib/maintenance";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ContactAdminList } from "./ContactAdminList";
import type { ContactRow } from "./ContactCard";

/** Small uppercase label above each conflict's pick buttons. */
const CONFLICT_LABEL_CLS = "text-sm font-semibold tracking-wide text-admin-muted uppercase";

interface ContactsAdminViewProps {
  initialConflicts: ConflictEntry[];
  contacts: ContactRow[];
  /** The page's searchParams, the list's starting filters. */
  query: PageQuery;
}

/**
 * Client wrapper for the contacts page handling conflict resolution and Google sync state.
 * @param props - Component props.
 * @param props.initialConflicts - Conflicts pre-computed by enrichContactsFromBookings on page load.
 * @param props.contacts - All contact rows to display.
 * @param props.query - The page's searchParams, the list's starting filters.
 * @returns Contacts admin view element.
 */
export function ContactsAdminView({
  initialConflicts,
  contacts,
  query,
}: ContactsAdminViewProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [conflicts, setConflicts] = useState<ConflictEntry[]>(initialConflicts);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncConfirmPending, setSyncConfirmPending] = useState(false);
  const [checkingAddresses, setCheckingAddresses] = useState(false);
  const [addressResult, setAddressResult] = useState<string | null>(null);

  // `syncing` is component state, so navigating away and back resets it mid-run - that is
  // how a second sync gets fired into the middle of the first. Ask the server on mount,
  // then poll until it finishes so the button tracks reality.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only refresh on a running > finished transition. Refreshing whenever the
    // server simply reports "not running" would fire on every page load.
    let sawRunning = false;

    /**
     * Reads live sync state and re-arms while a run is in flight.
     */
    async function poll(): Promise<void> {
      try {
        const res = await fetch("/api/admin/contacts/sync");
        if (!res.ok) return;
        const { running } = (await res.json()) as { running?: boolean };
        if (cancelled) return;
        setSyncing(running === true);
        if (running) {
          sawRunning = true;
          timer = setTimeout(() => void poll(), 5000);
        } else if (sawRunning) {
          // It finished while this page was open, so the rows on screen predate it.
          router.refresh();
        }
      } catch {
        // Offline or a transient failure - leave the button as it is.
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  const syncedCount = contacts.filter((c) => !!c.googleContactId).length;
  const unsyncedCount = contacts.filter((c) => !c.googleContactId).length;

  const runSync = useCallback(async () => {
    setSyncConfirmPending(false);
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/contacts/sync", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok: boolean;
        importedCount?: number;
        syncedCount?: number;
        error?: string;
      };
      if (data.ok) {
        setSyncResult(
          `Done - ${data.importedCount ?? 0} imported from Google, ${data.syncedCount ?? 0} pushed to Google.`,
        );
        toast(`Contacts synced - ${data.importedCount ?? 0} in, ${data.syncedCount ?? 0} out.`, {
          tone: "success",
        });
        router.refresh();
      } else {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
        toast(data.error ?? "Contact sync failed.", { tone: "error" });
      }
    } catch {
      setSyncResult("Network error - try again.");
      toast("Network error - the contact sync didn't finish.", { tone: "error" });
    } finally {
      setSyncing(false);
    }
  }, [router, toast]);

  const runAddressCheck = useCallback(async () => {
    setCheckingAddresses(true);
    setAddressResult(null);
    try {
      const res = await fetch("/api/admin/contacts/check-addresses", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        checked?: number;
        flagged?: number;
        error?: string;
      };
      if (data.ok) {
        setAddressResult(`Checked ${data.checked ?? 0} - ${data.flagged ?? 0} need a look.`);
        toast(`Address check done - ${data.flagged ?? 0} of ${data.checked ?? 0} need a look.`, {
          tone: "success",
        });
        router.refresh();
      } else {
        setAddressResult(`Error: ${data.error ?? "unknown"}`);
        toast(data.error ?? "Address check failed.", { tone: "error" });
      }
    } catch {
      setAddressResult("Network error - try again.");
      toast("Network error - the address check didn't finish.", { tone: "error" });
    } finally {
      setCheckingAddresses(false);
    }
  }, [router, toast]);

  const resolveConflict = useCallback(
    async (conflict: ConflictEntry, chosenName: string | null, chosenPhone: string | null) => {
      const body: Record<string, string> = {
        contactId: conflict.contactId,
        sourceId: conflict.sourceId,
        source: conflict.source,
      };
      if (chosenName !== null) body.name = chosenName;
      if (chosenPhone !== null) body.phone = chosenPhone;
      try {
        const res = await fetch("/api/admin/contacts/resolve-conflict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`resolve failed (${res.status})`);
        // Drop the row only once the write has landed. Clearing it regardless
        // hid failures: the conflict left the screen but was never resolved.
        setConflicts((prev) => prev.filter((c) => c.sourceId !== conflict.sourceId));
        toast("Conflict resolved.", { tone: "success" });
        router.refresh();
      } catch {
        toast("Couldn't resolve that conflict - try again.", { tone: "error" });
      }
    },
    [router, toast],
  );

  const skipConflict = useCallback((sourceId: string) => {
    setConflicts((prev) => prev.filter((c) => c.sourceId !== sourceId));
  }, []);

  return (
    // The list's seven-column table needs about 60rem, so the sync rail only sits beside
    // it on screens 1800px and wider. Below that, from lg, the left column dissolves into
    // the grid (contents) and the list is ordered last, so the conflicts panel still leads,
    // then the rail's two cards share a row, then the list. Phones keep the rail under it.
    <div className="grid grid-cols-1 items-start gap-6 min-[1800px]:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Left column: conflicts + contact list */}
      <div className="flex min-w-0 flex-col gap-6 lg:max-[1800px]:contents">
        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5">
            <p className="mb-3 text-sm font-bold text-amber-900">
              {conflicts.length} data conflict{conflicts.length === 1 ? "" : "s"} need your
              attention
            </p>
            <div className="flex flex-col gap-3">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.sourceId}
                  className="rounded-lg border border-amber-200 bg-admin-surface p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-admin-text">
                      {conflict.contactName}
                    </span>
                    <StatusPill tone="neutral">
                      {conflict.contactEmail ?? conflict.contactPhone ?? "Unknown"}
                    </StatusPill>
                    <StatusPill tone="warning">
                      {conflict.source === "Booking" ? "Booking" : "Review"}
                    </StatusPill>
                  </div>
                  <div className="space-y-3">
                    {conflict.conflictFields.includes("name") && (
                      <div className="space-y-1.5">
                        <p className={CONFLICT_LABEL_CLS}>Name - pick one</p>
                        <div className="flex flex-wrap gap-2">
                          <AdminButton
                            variant="secondary"
                            onClick={() =>
                              void resolveConflict(conflict, conflict.contactName, null)
                            }
                          >
                            {conflict.contactName}
                          </AdminButton>
                          <AdminButton
                            variant="secondary"
                            onClick={() =>
                              void resolveConflict(conflict, conflict.sourceName, null)
                            }
                          >
                            {conflict.sourceName}
                          </AdminButton>
                        </div>
                      </div>
                    )}
                    {conflict.conflictFields.includes("phone") && (
                      <div className="space-y-1.5">
                        <p className={CONFLICT_LABEL_CLS}>Phone - pick one</p>
                        <div className="flex flex-wrap gap-2">
                          <AdminButton
                            variant="secondary"
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.contactPhone)
                            }
                          >
                            {conflict.contactPhone ?? "-"}
                          </AdminButton>
                          <AdminButton
                            variant="secondary"
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.sourcePhone)
                            }
                          >
                            {conflict.sourcePhone}
                          </AdminButton>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <AdminButton variant="ghost" onClick={() => skipConflict(conflict.sourceId)}>
                      Skip
                    </AdminButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact list */}
        <Card flushOnPhone className="min-w-0 lg:max-[1800px]:order-last">
          <ContactAdminList contacts={contacts} query={query} />
        </Card>
      </div>
      {/* end left column */}

      {/* Right column: Google sync. top-22 clears the 56px top bar. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1800px]:sticky min-[1800px]:top-22 lg:max-[1800px]:grid-cols-2">
        <Card>
          <CardHeader
            className="mb-3"
            title="Google Contacts sync"
            description={`${syncedCount} synced · ${unsyncedCount} not yet in Google`}
          />
          <AdminButton
            variant="outline"
            onClick={() => setSyncConfirmPending(true)}
            disabled={syncing || syncConfirmPending}
            className="w-full"
          >
            {syncing ? "Syncing…" : "Sync with Google Contacts"}
          </AdminButton>

          {syncConfirmPending && (
            <div className="mt-4 rounded-lg border border-admin-border bg-admin-bg p-4">
              <p className="mb-2 text-sm font-bold text-admin-text">Confirm sync with Google?</p>
              <ul className="mb-3 space-y-1 text-sm text-admin-text-secondary">
                <li>• {unsyncedCount} contacts will be created in Google Contacts</li>
                <li>
                  • {syncedCount} contacts will have their email, phone, and address pushed to
                  Google
                </li>
                <li>• Google contacts not in your local DB will be imported</li>
              </ul>
              <div className="flex gap-2">
                <AdminButton variant="outline" onClick={() => void runSync()}>
                  Confirm
                </AdminButton>
                <AdminButton variant="secondary" onClick={() => setSyncConfirmPending(false)}>
                  Cancel
                </AdminButton>
              </div>
            </div>
          )}

          {syncResult && <p className="mt-3 text-sm text-admin-muted">{syncResult}</p>}
        </Card>

        <Card>
          <CardHeader
            className="mb-3"
            title="Address check"
            description={
              <>
                Re-checks every stored address and flags the ones that don&apos;t match a single
                Auckland address. Takes a while - one lookup per contact.
              </>
            }
          />
          <AdminButton
            variant="outline"
            onClick={() => void runAddressCheck()}
            disabled={checkingAddresses}
            className="w-full"
          >
            {checkingAddresses ? "Checking…" : "Check all addresses"}
          </AdminButton>
          {addressResult && <p className="mt-3 text-sm text-admin-muted">{addressResult}</p>}
        </Card>
      </div>
      {/* end right column */}
    </div>
  );
}
