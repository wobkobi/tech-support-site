"use client";
// src/features/contacts/components/ContactConflictsView.tsx
// Pending Google Contacts sync conflicts; the admin picks a winner per row, which is
// saved and pushed back to Google.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { FaCaretLeft } from "react-icons/fa6";

/** A single unresolved conflict as returned by the GET endpoint. */
export interface ConflictRow {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  // `string & {}` keeps the literal hints from collapsing into plain string.
  field: "name" | "email" | "address" | (string & {});
  siteValue: string | null;
  googleValue: string | null;
  createdAt: string;
}

interface ContactConflictsViewProps {
  /** Initial unresolved conflicts loaded server-side. */
  initial: ConflictRow[];
}

/**
 * Conflicts review UI: one card per row; a row drops out once its resolve succeeds.
 * @param props - Component props.
 * @param props.initial - Server-loaded conflicts.
 * @returns Conflicts view element.
 */
export function ContactConflictsView({ initial }: ContactConflictsViewProps): React.ReactElement {
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [resolving, setResolving] = useState<string | null>(null);

  /**
   * Sends the chosen winner to the resolve endpoint and removes the row on success.
   * @param id - Conflict id.
   * @param winner - Which side wins.
   */
  async function resolve(id: string, winner: "site" | "google"): Promise<void> {
    setResolving(id);
    try {
      const res = await fetch(`/api/admin/contacts/conflicts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winner }),
      });
      const d = (await res.json()) as { ok: true } | { error: string };
      if ("error" in d) throw new Error(d.error);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast("Conflict resolved.", { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not resolve.", { tone: "error" });
    } finally {
      setResolving(null);
    }
  }

  const backLink = (
    <Link
      href="/admin/contacts"
      className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-admin-muted hover:underline"
    >
      <FaCaretLeft className="h-4 w-4" aria-hidden />
      Back to Contacts
    </Link>
  );

  if (rows.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          title="No conflicts to review."
          body="All contact fields are in sync between the site and Google Contacts."
          action={backLink}
        />
      </Card>
    );
  }

  // Headed like the address list above; the breadcrumb already links back.
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-admin-text">Fields that changed on both sides</h2>
        <p className="text-sm text-admin-faint">
          Pick the value to keep. It&apos;s saved here and pushed back to Google Contacts.
        </p>
      </div>
      <ul className="grid gap-3 xl:grid-cols-2">
        {rows.map((c) => {
          const isResolving = resolving === c.id;
          return (
            <li key={c.id}>
              <Card className="h-full">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/contacts/${c.contactId}`}
                      className="truncate text-base font-semibold text-russian-violet hover:underline"
                    >
                      {c.contactName}
                    </Link>
                    {c.contactEmail && (
                      <p className="truncate text-sm text-admin-faint">{c.contactEmail}</p>
                    )}
                  </div>
                  <StatusPill tone="warning">{c.field}</StatusPill>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
                    <p className="mb-1 text-sm font-semibold text-admin-faint uppercase">
                      Site value
                    </p>
                    <p className="text-sm font-medium text-admin-text">
                      {c.siteValue || <span className="text-admin-faint italic">empty</span>}
                    </p>
                    <AdminButton
                      onClick={() => void resolve(c.id, "site")}
                      busy={isResolving}
                      className="mt-3 w-full"
                    >
                      Use site value
                    </AdminButton>
                  </div>
                  <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
                    <p className="mb-1 text-sm font-semibold text-admin-faint uppercase">
                      Google value
                    </p>
                    <p className="text-sm font-medium text-admin-text">
                      {c.googleValue || <span className="text-admin-faint italic">empty</span>}
                    </p>
                    <AdminButton
                      variant="secondary"
                      onClick={() => void resolve(c.id, "google")}
                      busy={isResolving}
                      className="mt-3 w-full"
                    >
                      Use Google value
                    </AdminButton>
                  </div>
                </div>

                <p className="mt-3 text-sm text-admin-faint">
                  Detected {formatDateTimeShort(c.createdAt)}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
