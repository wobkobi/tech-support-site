"use client";
// src/features/mailing/components/SubscribersPanel.tsx
// Who's on the mailing list. Lets the operator unsubscribe someone who asked by
// phone or reply, and email someone who wants back on a button to confirm it.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
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
   * Unsubscribes a contact, or emails them a button to confirm coming back, through the
   * opt-outs route. An asked contact stays under Unsubscribed until they press it.
   * @param r - Contact.
   * @param action - Which way.
   */
  async function move(r: Recipient, action: "unsubscribe" | "ask-resubscribe"): Promise<void> {
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
    if (action === "ask-resubscribe") {
      toast(
        `Sent ${r.name} an email to confirm. They're back on the list once they press the button in it.`,
        { tone: "success" },
      );
      return;
    }
    setSubscribed((prev) => prev.filter((x) => x.contactId !== r.contactId));
    setUnsubscribed((prev) => [...prev, r].sort((a, b) => a.name.localeCompare(b.name)));
    toast(`${r.name} won't get mailing-list emails.`, { tone: "success" });
  }

  const lists = (
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
        actionLabel="Ask to resubscribe"
        busyId={busyId}
        // A bounced address can't get the confirm email.
        canAct={(r) => r.optOutReason !== "bounce"}
        onAction={(r) => void move(r, "ask-resubscribe")}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Subscribers"
        description={`${subscribed.length} on the list, ${unsubscribed.length} unsubscribed. Everyone in Contacts with an email address is on it until they unsubscribe. Find someone to take them off, or to email them a button to come back on.`}
      />
      <AdminInput
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find someone by name or email"
        className="mt-3"
        aria-label="Find a subscriber"
      />
      {/* A search shows its matches straight away; with none, everyone stays folded away. */}
      {q ? (
        lists
      ) : (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-russian-violet">
            Show everyone
          </summary>
          {lists}
        </details>
      )}
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
 * @param props.canAct - Whether a row gets the action button; every row when unset.
 * @param props.onAction - Runs the row action.
 * @returns List element.
 */
function SubscriberList({
  heading,
  rows,
  actionLabel,
  busyId,
  canAct,
  onAction,
}: {
  heading: string;
  rows: Recipient[];
  actionLabel: string;
  busyId: string | null;
  canAct?: (r: Recipient) => boolean;
  onAction: (r: Recipient) => void;
}): React.ReactElement {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-admin-text">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-admin-muted">Nobody.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
          {rows.map((r) => (
            <li key={r.contactId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-admin-text">{r.name}</p>
                <p className="truncate text-sm text-admin-muted">{r.email}</p>
                {r.optOutReason && (
                  <p className="text-sm text-admin-muted">
                    {r.optOutReason === "bounce"
                      ? "Email bounced: this address doesn't exist"
                      : "Marked an email as spam"}
                  </p>
                )}
              </div>
              {(!canAct || canAct(r)) && (
                <AdminButton
                  size="xs"
                  variant="secondary"
                  busy={busyId === r.contactId}
                  onClick={() => onAction(r)}
                >
                  {actionLabel}
                </AdminButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
