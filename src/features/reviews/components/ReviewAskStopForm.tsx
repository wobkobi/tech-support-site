"use client";
// src/features/reviews/components/ReviewAskStopForm.tsx
// The button on the public "stop asking me for reviews" page. Nothing changes until it's
// pressed: email security scanners open every link in a message, and a page that opted
// out on load would quietly drop people who never asked.

import { Button } from "@/shared/components/Button";
import React, { useState } from "react";

/**
 * Stop / allow toggle for review asks.
 * @param props - Component props.
 * @param props.token - Signed stop token from the link.
 * @param props.initiallyStopped - Whether they have already opted out.
 * @returns Form element.
 */
export function ReviewAskStopForm({
  token,
  initiallyStopped,
}: {
  token: string;
  initiallyStopped: boolean;
}): React.ReactElement {
  const [stopped, setStopped] = useState(initiallyStopped);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sends the change to the stop route.
   * @param action - Which way to switch.
   */
  async function change(action: "stop" | "allow"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/review-asks/stop/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!data?.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStopped(action === "stop");
    } catch {
      setError("Couldn't connect. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {stopped ? (
        <>
          <p className="text-lg font-semibold text-russian-violet" role="status">
            Done. I won&apos;t ask you for a review again.
          </p>
          <p className="text-base text-rich-black/80">
            You&apos;ll still get your invoices and booking emails. Changed your mind?
          </p>
          <div>
            <Button variant="secondary" disabled={busy} onClick={() => void change("allow")}>
              {busy ? "Saving..." : "Asking is fine"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base text-rich-black/80">
            Press the button and I&apos;ll stop sending you emails asking for a review. You&apos;ll
            still get your invoices and booking emails.
          </p>
          <div>
            <Button disabled={busy} onClick={() => void change("stop")}>
              {busy ? "Saving..." : "Stop asking me for reviews"}
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
