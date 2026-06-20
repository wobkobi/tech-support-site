"use client";
// src/features/admin/components/ContactsAdminView.tsx
import type { ConflictEntry } from "@/app/api/admin/contacts/enrich-from-reviews/route";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useState } from "react";
import { ContactAdminList, type ContactRow } from "./ContactAdminList";

interface ContactsAdminViewProps {
  initialConflicts: ConflictEntry[];
  contacts: ContactRow[];
}

/**
 * Client wrapper for the contacts page handling conflict resolution and Google sync state.
 * @param props - Component props.
 * @param props.initialConflicts - Conflicts pre-computed by autoMaintain on page load.
 * @param props.contacts - All contact rows to display.
 * @returns Contacts admin view element.
 */
export function ContactsAdminView({
  initialConflicts,
  contacts,
}: ContactsAdminViewProps): React.ReactElement {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<ConflictEntry[]>(initialConflicts);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncConfirmPending, setSyncConfirmPending] = useState(false);

  const syncedCount = contacts.filter((c) => !!c.googleContactId).length;
  const unsyncedCount = contacts.filter((c) => !c.googleContactId).length;

  const runSync = useCallback(async () => {
    setSyncConfirmPending(false);
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/contacts/sync", {
        method: "POST",
        headers: {},
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
        router.refresh();
      } else {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setSyncResult("Network error - try again.");
    } finally {
      setSyncing(false);
    }
  }, [router]);

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
        await fetch("/api/admin/contacts/resolve-conflict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        router.refresh();
      } catch {
        // best-effort
      }
      setConflicts((prev) => prev.filter((c) => c.sourceId !== conflict.sourceId));
    },
    [router],
  );

  const skipConflict = useCallback((sourceId: string) => {
    setConflicts((prev) => prev.filter((c) => c.sourceId !== sourceId));
  }, []);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      {/* Left column: conflicts + contact list */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="mb-3 text-sm font-semibold text-amber-700">
              {conflicts.length} data conflict{conflicts.length === 1 ? "" : "s"} need your
              attention
            </p>
            <div className="flex flex-col gap-3">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.sourceId}
                  className="rounded-lg border border-amber-200 bg-white p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      {conflict.contactName}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
                      {conflict.contactEmail ?? conflict.contactPhone ?? "Unknown"}
                    </span>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {conflict.source === "Booking" ? "Booking" : "Review"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {conflict.conflictFields.includes("name") && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                          Name - pick one
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, conflict.contactName, null)
                            }
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-russian-violet hover:text-russian-violet"
                          >
                            {conflict.contactName}
                          </button>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, conflict.sourceName, null)
                            }
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-russian-violet hover:text-russian-violet"
                          >
                            {conflict.sourceName}
                          </button>
                        </div>
                      </div>
                    )}
                    {conflict.conflictFields.includes("phone") && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                          Phone - pick one
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.contactPhone)
                            }
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-russian-violet hover:text-russian-violet"
                          >
                            {conflict.contactPhone ?? "-"}
                          </button>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.sourcePhone)
                            }
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-russian-violet hover:text-russian-violet"
                          >
                            {conflict.sourcePhone}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => skipConflict(conflict.sourceId)}
                      className="rounded px-2 py-1 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact list */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ContactAdminList contacts={contacts} />
        </div>
      </div>
      {/* end left column */}

      {/* Right column: Google sync */}
      <div className="lg:sticky lg:top-8">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">Google Contacts sync</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {syncedCount} synced · {unsyncedCount} not yet in Google
              </p>
            </div>
            <button
              onClick={() => setSyncConfirmPending(true)}
              disabled={syncing || syncConfirmPending}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                syncing || syncConfirmPending
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-russian-violet text-white hover:bg-russian-violet/90",
              )}
            >
              {syncing ? "Syncing…" : "Sync with Google Contacts"}
            </button>
          </div>

          {syncConfirmPending && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Confirm sync with Google?</p>
              <ul className="mb-3 space-y-1 text-xs text-slate-500">
                <li>• {unsyncedCount} contacts will be created in Google Contacts</li>
                <li>
                  • {syncedCount} contacts will have their email, phone, and address pushed to
                  Google
                </li>
                <li>• Google contacts not in your local DB will be imported</li>
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={() => void runSync()}
                  className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setSyncConfirmPending(false)}
                  className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {syncResult && <p className="mt-3 text-xs text-slate-500">{syncResult}</p>}
        </div>
      </div>
      {/* end right column */}
    </div>
  );
}
