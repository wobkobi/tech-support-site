"use client";
// src/features/mailing/components/UnsubscribeForm.tsx
// The button on the public unsubscribe page. Nothing changes until it's pressed:
// email security scanners open every link in a message, and a page that
// unsubscribed on load would quietly drop people who never asked.

import { Button } from "@/shared/components/Button";
import React, { useState } from "react";

/**
 * Unsubscribe / resubscribe toggle.
 * @param props - Component props.
 * @param props.token - Signed unsubscribe token from the link.
 * @param props.initiallyUnsubscribed - Whether they are already off the list.
 * @returns Form element.
 */
export function UnsubscribeForm({
  token,
  initiallyUnsubscribed,
}: {
  token: string;
  initiallyUnsubscribed: boolean;
}): React.ReactElement {
  const [unsubscribed, setUnsubscribed] = useState(initiallyUnsubscribed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sends the change to the unsubscribe route.
   * @param action - Which way to switch.
   */
  async function change(action: "unsubscribe" | "resubscribe"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!data?.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setUnsubscribed(action === "unsubscribe");
    } catch {
      setError("Couldn't connect. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {unsubscribed ? (
        <>
          <p className="text-lg font-semibold text-russian-violet" role="status">
            You&apos;re unsubscribed. You won&apos;t get any more of these emails.
          </p>
          <p className="text-base text-rich-black/80">
            You&apos;ll still get emails about your own bookings and invoices. Changed your mind?
          </p>
          <div>
            <Button variant="secondary" disabled={busy} onClick={() => void change("resubscribe")}>
              {busy ? "Saving..." : "Keep getting emails"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base text-rich-black/80">
            Press the button to stop getting emails like promos and updates. You&apos;ll still get
            emails about your own bookings and invoices.
          </p>
          <div>
            <Button disabled={busy} onClick={() => void change("unsubscribe")}>
              {busy ? "Saving..." : "Unsubscribe"}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="text-base text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
