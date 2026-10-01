"use client";
// src/features/mailing/components/SubscribersPanel.tsx
// Who's on the mailing list. Lets the operator unsubscribe someone who asked by
// phone or reply, and put back someone who unsubscribed by mistake.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { Recipient } from "@/features/mailing/lib/recipients";
import React, { useState } from "react";

/**
 * True when a contact's name or email contains the search text.
 * @param r - Contact.
 * @param query - Lowercased search text.
 * @returns Whether it matches.
 */
function matches(r: Recipient, query: string): boolean {
  return !query || r.name.toLowerCase().includes(query) || r.email.toLowerCase().includes(query);
}

/**
 * Subscribers card on the Mailing page.
 * @param props - Component props.
 * @param props.initialSubscribed - Contacts on the list.
 * @param props.initialUnsubscribed - Contacts who have unsubscribed.
 * @returns Subscribers panel element.
 */
export function SubscribersPanel({
  initialSubscribed,
  initialUnsubscribed,
}: {
  initialSubscribed: Recipient[];
  initialUnsubscribed: Recipient[];
}): React.ReactElement {
  const { toast } = useToast();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [unsubscribed, setUnsubscribed] = useState(initialUnsubscribed);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  /**
   * Moves a contact between the two lists through the opt-outs route.
   * @param r - Contact to move.
   * @param action - Which way.
   */
  async function move(r: Recipient, action: "unsubscribe" | "resubscribe"): Promise<void> {
    setBusyId(r.contactId);
    const res = await callApi("/api/admin/mailing/opt-outs", "POST", {
      action,
      contactId: r.contactId,
    });
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    /**
     * Alphabetical order by name.
     * @param a - First contact.
     * @param b - Second contact.
     * @returns Sort comparison.
     */
    const byName = (a: Recipient, b: Recipient): number => a.name.localeCompare(b.name);
    if (action === "unsubscribe") {
      setSubscribed((prev) => prev.filter((x) => x.contactId !== r.contactId));
      setUnsubscribed((prev) => [...prev, r].sort(byName));
      toast(`${r.name} won't get mailing-list emails.`, { tone: "success" });
    } else {
      setUnsubscribed((prev) => prev.filter((x) => x.contactId !== r.contactId));
      setSubscribed((prev) => [...prev, r].sort(byName));
      toast(`${r.name} is back on the list.`, { tone: "success" });
    }
  }

  return (
    <Card>
      <CardHeader
        title="Subscribers"
        description={`${subscribed.length} on the list, ${unsubscribed.length} unsubscribed. Everyone in Contacts with an email address is on it until they unsubscribe.`}
      />
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-russian-violet">
          Show everyone
        </summary>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email"
          className={`${ADMIN_INPUT_CLS} mt-3`}
          aria-label="Search subscribers"
        />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <SubscriberList
            heading="On the list"
            rows={subscribed.filter((r) => matches(r, q))}
            actionLabel="Unsubscribe"
            busyId={busyId}
            onAction={(r) => void move(r, "unsubscribe")}
          />
          <SubscriberList
            heading="Unsubscribed"
            rows={unsubscribed.filter((r) => matches(r, q))}
            actionLabel="Resubscribe"
            busyId={busyId}
            onAction={(r) => void move(r, "resubscribe")}
          />
        </div>
      </details>
    </Card>
  );
}

/**
 * One column of the subscribers panel.
 * @param props - Component props.
 * @param props.heading - Column title.
 * @param props.rows - Contacts to list.
 * @param props.actionLabel - Button text for each row.
 * @param props.busyId - Contact id whose request is running.
 * @param props.onAction - Runs the row action.
 * @returns List element.
 */
function SubscriberList({
  heading,
  rows,
  actionLabel,
  busyId,
  onAction,
}: {
  heading: string;
  rows: Recipient[];
  actionLabel: string;
  busyId: string | null;
  onAction: (r: Recipient) => void;
}): React.ReactElement {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-admin-text">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-admin-muted">Nobody.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
          {rows.map((r) => (
            <li key={r.contactId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-admin-text">{r.name}</p>
                <p className="truncate text-sm text-admin-muted">{r.email}</p>
              </div>
              <AdminButton
                size="xs"
                variant="secondary"
                busy={busyId === r.contactId}
                onClick={() => onAction(r)}
              >
                {actionLabel}
              </AdminButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
