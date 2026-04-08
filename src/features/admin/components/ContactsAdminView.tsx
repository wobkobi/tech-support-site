"use client";
// src/features/admin/components/ContactsAdminView.tsx
import { useState, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { ContactAdminList, type ContactRow } from "./ContactAdminList";
import type { ConflictEntry } from "@/app/api/admin/contacts/enrich-from-reviews/route";

interface ContactsAdminViewProps {
  initialConflicts: ConflictEntry[];
  contacts: ContactRow[];
  token: string;
}

/**
 * Client wrapper for the contacts page handling conflict resolution and Google sync state.
 * @param props - Component props.
 * @param props.initialConflicts - Conflicts pre-computed by autoMaintain on page load.
 * @param props.contacts - All contact rows to display.
 * @param props.token - Admin token for API calls.
 * @returns Contacts admin view element.
 */
export function ContactsAdminView({
  initialConflicts,
  contacts,
  token,
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
        headers: { "X-Admin-Secret": token },
      });
      const data = (await res.json()) as {
        ok: boolean;
        importedCount?: number;
        syncedCount?: number;
        error?: string;
      };
      if (data.ok) {
        setSyncResult(
          `Done — ${data.importedCount ?? 0} imported from Google, ${data.syncedCount ?? 0} pushed to Google.`,
        );
        router.refresh();
      } else {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setSyncResult("Network error — try again.");
    } finally {
      setSyncing(false);
    }
  }, [token, router]);

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
          headers: { "X-Admin-Secret": token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        router.refresh();
      } catch {
        // best-effort
      }
      setConflicts((prev) => prev.filter((c) => c.sourceId !== conflict.sourceId));
    },
    [token, router],
  );

  const skipConflict = useCallback((sourceId: string) => {
    setConflicts((prev) => prev.filter((c) => c.sourceId !== sourceId));
  }, []);

  return (
    <div className={cn("grid grid-cols-1 items-start gap-6 lg:grid-cols-3")}>
      {/* Left column: conflicts + contact list */}
      <div className={cn("flex flex-col gap-6 lg:col-span-2")}>
        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-5")}>
            <p className={cn("mb-3 text-sm font-semibold text-amber-700")}>
              {conflicts.length} data conflict{conflicts.length === 1 ? "" : "s"} need your
              attention
            </p>
            <div className={cn("flex flex-col gap-3")}>
              {conflicts.map((conflict) => (
                <div
                  key={conflict.sourceId}
                  className={cn("rounded-lg border border-amber-200 bg-white p-4")}
                >
                  <div className={cn("mb-2 flex flex-wrap items-center gap-2")}>
                    <span className={cn("text-sm font-medium text-slate-700")}>
                      {conflict.contactName}
                    </span>
                    <span
                      className={cn(
                        "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500",
                      )}
                    >
                      {conflict.contactEmail ?? conflict.contactPhone ?? "Unknown"}
                    </span>
                    <span
                      className={cn(
                        "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700",
                      )}
                    >
                      {conflict.source === "ReviewRequest"
                        ? "Review request"
                        : conflict.source === "Booking"
                          ? "Booking"
                          : "Review"}
                    </span>
                  </div>
                  <div className={cn("space-y-3")}>
                    {conflict.conflictFields.includes("name") && (
                      <div className={cn("space-y-1.5")}>
                        <p
                          className={cn(
                            "text-xs font-medium uppercase tracking-wide text-slate-400",
                          )}
                        >
                          Name — pick one
                        </p>
                        <div className={cn("flex flex-wrap gap-2")}>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, conflict.contactName, null)
                            }
                            className={cn(
                              "hover:border-russian-violet hover:text-russian-violet rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors",
                            )}
                          >
                            {conflict.contactName}
                          </button>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, conflict.sourceName, null)
                            }
                            className={cn(
                              "hover:border-russian-violet hover:text-russian-violet rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors",
                            )}
                          >
                            {conflict.sourceName}
                          </button>
                        </div>
                      </div>
                    )}
                    {conflict.conflictFields.includes("phone") && (
                      <div className={cn("space-y-1.5")}>
                        <p
                          className={cn(
                            "text-xs font-medium uppercase tracking-wide text-slate-400",
                          )}
                        >
                          Phone — pick one
                        </p>
                        <div className={cn("flex flex-wrap gap-2")}>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.contactPhone)
                            }
                            className={cn(
                              "hover:border-russian-violet hover:text-russian-violet rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors",
                            )}
                          >
                            {conflict.contactPhone ?? "—"}
                          </button>
                          <button
                            onClick={() =>
                              void resolveConflict(conflict, null, conflict.sourcePhone)
                            }
                            className={cn(
                              "hover:border-russian-violet hover:text-russian-violet rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors",
                            )}
                          >
                            {conflict.sourcePhone}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={cn("mt-3 flex justify-end")}>
                    <button
                      onClick={() => skipConflict(conflict.sourceId)}
                      className={cn(
                        "rounded px-2 py-1 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600",
                      )}
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
        <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
          <ContactAdminList contacts={contacts} token={token} />
        </div>
      </div>
      {/* end left column */}

      {/* Right column: Google sync */}
      <div className={cn("lg:sticky lg:top-8")}>
        <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm")}>
          <div className={cn("flex flex-wrap items-center justify-between gap-4")}>
            <div>
              <p className={cn("text-sm font-semibold text-slate-700")}>Google Contacts sync</p>
              <p className={cn("mt-0.5 text-xs text-slate-400")}>
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
                  : "bg-russian-violet hover:bg-russian-violet/90 text-white",
              )}
            >
              {syncing ? "Syncing…" : "Sync with Google Contacts"}
            </button>
          </div>

          {syncConfirmPending && (
            <div className={cn("mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4")}>
              <p className={cn("mb-2 text-sm font-medium text-slate-700")}>
                Confirm sync with Google?
              </p>
              <ul className={cn("mb-3 space-y-1 text-xs text-slate-500")}>
                <li>• {unsyncedCount} contacts will be created in Google Contacts</li>
                <li>
                  • {syncedCount} contacts will have their email, phone, and address pushed to
                  Google
                </li>
                <li>• Google contacts not in your local DB will be imported</li>
              </ul>
              <div className={cn("flex gap-2")}>
                <button
                  onClick={() => void runSync()}
                  className={cn(
                    "bg-russian-violet hover:bg-russian-violet/90 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors",
                  )}
                >
                  Confirm
                </button>
                <button
                  onClick={() => setSyncConfirmPending(false)}
                  className={cn(
                    "rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-300",
                  )}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {syncResult && <p className={cn("mt-3 text-xs text-slate-500")}>{syncResult}</p>}
        </div>
      </div>
      {/* end right column */}
    </div>
  );
}
