"use client";
// src/features/admin/components/ContactConflictsView.tsx
/**
 * @file ContactConflictsView.tsx
 * @description Lists pending Google Contacts sync conflicts and lets the
 * admin pick a winner per row. POSTs to /api/admin/contacts/conflicts/[id]
 * which writes the chosen value to the site DB and triggers a fresh push to
 * Google. Once resolved, the row disappears from the list.
 */

import { cn } from "@/shared/lib/cn";
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
  field: "name" | "email" | "address" | string;
  siteValue: string | null;
  googleValue: string | null;
  createdAt: string;
}

interface ContactConflictsViewProps {
  /** Initial unresolved conflicts loaded server-side. */
  initial: ConflictRow[];
}

/**
 * Conflicts review UI. Renders one card per row with "Use site value" /
 * "Use Google value" buttons. Resolution is optimistic: the row drops out
 * of the list as soon as the API call succeeds.
 * @param props - Component props.
 * @param props.initial - Server-loaded conflicts.
 * @returns Conflicts view element.
 */
export function ContactConflictsView({ initial }: ContactConflictsViewProps): React.ReactElement {
  const [rows, setRows] = useState(initial);
  const [resolving, setResolving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Sends the chosen winner to the resolve endpoint and removes the row
   * from the list on success.
   * @param id - Conflict id.
   * @param winner - Which side wins.
   */
  async function resolve(id: string, winner: "site" | "google"): Promise<void> {
    setResolving(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/contacts/conflicts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winner }),
      });
      const d = (await res.json()) as { ok: true } | { error: string };
      if ("error" in d) throw new Error(d.error);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Could not resolve.",
      }));
    } finally {
      setResolving(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className={cn("rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm")}>
        <p className={cn("text-sm font-medium text-slate-700")}>No conflicts to review.</p>
        <p className={cn("mt-1 text-xs text-slate-400")}>
          All contact fields are in sync between the site and Google Contacts.
        </p>
        <Link
          href={`/admin/contacts`}
          className={cn(
            "mt-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:underline",
          )}
        >
          <FaCaretLeft className={cn("h-4 w-4")} aria-hidden />
          Back to Contacts
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4")}>
      <Link
        href={`/admin/contacts`}
        className={cn(
          "inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-600 hover:underline",
        )}
      >
        <FaCaretLeft className={cn("h-4 w-4")} aria-hidden />
        Back to Contacts
      </Link>

      <ul className={cn("flex flex-col gap-3")}>
        {rows.map((c) => {
          const isResolving = resolving === c.id;
          const err = errors[c.id];
          return (
            <li
              key={c.id}
              className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
            >
              <div className={cn("mb-3 flex items-baseline justify-between gap-3")}>
                <div className={cn("min-w-0")}>
                  <p className={cn("text-russian-violet truncate text-base font-semibold")}>
                    {c.contactName}
                  </p>
                  {c.contactEmail && (
                    <p className={cn("truncate text-xs text-slate-400")}>{c.contactEmail}</p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-coquelicot-500 bg-coquelicot-500/10 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase",
                  )}
                >
                  {c.field}
                </span>
              </div>

              <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2")}>
                <div className={cn("rounded-lg border border-slate-200 bg-slate-50 p-3")}>
                  <p className={cn("mb-1 text-xs font-semibold uppercase text-slate-400")}>
                    Site value
                  </p>
                  <p className={cn("text-sm font-medium text-slate-800")}>
                    {c.siteValue || <span className={cn("italic text-slate-400")}>empty</span>}
                  </p>
                  <button
                    type="button"
                    onClick={() => void resolve(c.id, "site")}
                    disabled={isResolving}
                    className={cn(
                      "bg-russian-violet hover:bg-russian-violet/90 mt-3 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50",
                    )}
                  >
                    {isResolving ? "Saving…" : "Use site value"}
                  </button>
                </div>
                <div className={cn("rounded-lg border border-slate-200 bg-slate-50 p-3")}>
                  <p className={cn("mb-1 text-xs font-semibold uppercase text-slate-400")}>
                    Google value
                  </p>
                  <p className={cn("text-sm font-medium text-slate-800")}>
                    {c.googleValue || <span className={cn("italic text-slate-400")}>empty</span>}
                  </p>
                  <button
                    type="button"
                    onClick={() => void resolve(c.id, "google")}
                    disabled={isResolving}
                    className={cn(
                      "mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50",
                    )}
                  >
                    {isResolving ? "Saving…" : "Use Google value"}
                  </button>
                </div>
              </div>

              {err && <p className={cn("text-coquelicot-500 mt-3 text-xs")}>{err}</p>}
              <p className={cn("mt-3 text-xs text-slate-400")}>
                Detected {new Date(c.createdAt).toLocaleString()}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
