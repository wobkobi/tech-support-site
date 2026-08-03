"use client";
// src/features/admin/components/ContactAddressReviewList.tsx
/**
 * @description Review queue for imported contact addresses the geocoder could
 * not confidently resolve. Each card offers the Auckland candidates as
 * one-click picks plus a free-text box checked through
 * /api/booking/verify-address, and saves through PATCH
 * /api/admin/contacts/[id]. A saved or dismissed row drops out of the list.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

/** One contact whose stored address needs an operator decision. */
export interface AddressReviewRow {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  /** Address as imported - stored verbatim because it did not resolve. */
  address: string;
  /** Auckland candidates from the geocoder; empty when nothing matched. */
  candidates: string[];
}

/**
 * Candidate buttons carry full formatted addresses, so they override the
 * AdminButton default of a single centred line.
 */
const CANDIDATE_CLASS = "w-full justify-start text-left whitespace-normal";

interface AddressReviewCardProps {
  row: AddressReviewRow;
  onDone: (contactId: string) => void;
}

/**
 * One review card: candidate picks, a checked free-text box, and a dismiss.
 * @param props - Component props.
 * @param props.row - Contact under review.
 * @param props.onDone - Called with the contact id once the row is resolved.
 * @returns Review card element.
 */
function AddressReviewCard({ row, onDone }: AddressReviewCardProps): React.ReactElement {
  const { toast } = useToast();
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Writes the chosen address to the contact and drops the row.
   * @param address - Address to store, or null to dismiss and keep as imported.
   */
  async function save(address: string | null): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/contacts/${row.contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          address === null ? { addressReviewed: true } : { address, addressReviewed: true },
        ),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not save.");
      toast(address === null ? "Kept as imported." : "Address updated.", { tone: "success" });
      onDone(row.contactId);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save.", { tone: "error" });
      setSaving(false);
    }
  }

  /** Geocodes the typed address so the operator sees the match before saving. */
  async function check(): Promise<void> {
    if (!typed.trim()) return;
    setChecking(true);
    setChecked(null);
    try {
      const res = await fetch("/api/booking/verify-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: typed.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; candidates?: string[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not check that address.");
      setChecked(data.candidates ?? []);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not check.", { tone: "error" });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/contacts/${row.contactId}`}
            className="truncate text-base font-semibold text-russian-violet hover:underline"
          >
            {row.contactName}
          </Link>
          {row.contactEmail && (
            <p className="truncate text-sm text-admin-faint">{row.contactEmail}</p>
          )}
        </div>
        <StatusPill tone="warning">address</StatusPill>
      </div>

      <div className="rounded-lg border border-admin-border bg-admin-bg p-3">
        <p className="mb-1 text-xs font-semibold text-admin-faint uppercase">As imported</p>
        <p className="text-base font-medium text-admin-text">{row.address}</p>
      </div>

      {row.candidates.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold text-admin-text">Did you mean?</p>
          <ul className="flex flex-col gap-2">
            {row.candidates.map((candidate) => (
              <li key={candidate}>
                <AdminButton
                  onClick={() => void save(candidate)}
                  busy={saving}
                  className={CANDIDATE_CLASS}
                >
                  {candidate}
                </AdminButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <label
          htmlFor={`addr-${row.contactId}`}
          className="mb-1 block text-sm font-semibold text-admin-text"
        >
          {row.candidates.length > 0 ? "Or type it" : "Type the correct address"}
        </label>
        <div className="flex gap-2">
          <input
            id={`addr-${row.contactId}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="e.g. 4 Name Street, Onehunga"
            className="min-w-0 flex-1 rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-base text-admin-text"
          />
          <AdminButton variant="secondary" onClick={() => void check()} busy={checking}>
            Check
          </AdminButton>
        </div>

        {checked !== null && checked.length === 0 && (
          <p className="mt-2 text-sm text-admin-faint">
            No Auckland match for that. Save it anyway if you know it&apos;s right.
          </p>
        )}
        {checked !== null && checked.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {checked.map((candidate) => (
              <li key={candidate}>
                <AdminButton
                  onClick={() => void save(candidate)}
                  busy={saving}
                  className={CANDIDATE_CLASS}
                >
                  Save {candidate}
                </AdminButton>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {typed.trim() && (
            <AdminButton onClick={() => void save(typed.trim())} busy={saving}>
              Save as typed
            </AdminButton>
          )}
          <AdminButton variant="secondary" onClick={() => void save(null)} busy={saving}>
            Keep as imported
          </AdminButton>
        </div>
      </div>
    </Card>
  );
}

interface ContactAddressReviewListProps {
  /** Contacts flagged at import, loaded server-side. */
  initial: AddressReviewRow[];
}

/**
 * Lists every contact whose imported address needs a decision. Renders nothing
 * when the queue is empty so the conflicts page stays clean.
 * @param props - Component props.
 * @param props.initial - Server-loaded review rows.
 * @returns Review list element, or null when there is nothing to review.
 */
export function ContactAddressReviewList({
  initial,
}: ContactAddressReviewListProps): React.ReactElement | null {
  const [rows, setRows] = useState(initial);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-admin-text">Addresses to check</h2>
        <p className="text-sm text-admin-faint">
          These came in from an import but didn&apos;t match one Auckland address, so they&apos;re
          stored exactly as they were typed.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.contactId}>
            <AddressReviewCard
              row={row}
              onDone={(id) => setRows((prev) => prev.filter((r) => r.contactId !== id))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
