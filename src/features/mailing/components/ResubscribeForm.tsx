"use client";
// src/features/mailing/components/ResubscribeForm.tsx
// The public "Yes, add me back" button. Nothing changes on load, since email scanners
// open every link.

import { Button } from "@/shared/components/Button";
import React, { useState } from "react";

/**
 * Confirms a resubscribe through the unsubscribe route.
 * @param props - Component props.
 * @param props.token - Signed unsubscribe token from the link.
 * @param props.initiallyOnList - Whether they're already on the list.
 * @returns Form element.
 */
export function ResubscribeForm({
  token,
  initiallyOnList,
}: {
  token: string;
  initiallyOnList: boolean;
}): React.ReactElement {
  const [onList, setOnList] = useState(initiallyOnList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Puts them back on the list. */
  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resubscribe" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!data?.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setOnList(true);
    } catch {
      setError("Couldn't connect. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {onList ? (
        <>
          <p className="text-lg font-semibold text-russian-violet" role="status">
            You&apos;re on my list. Thanks!
          </p>
          <p className="text-base text-rich-black/80">
            You&apos;ll get the occasional email about offers, holiday hours or scam warnings. Every
            one has an unsubscribe link if you change your mind.
          </p>
        </>
      ) : (
        <>
          <p className="text-base text-rich-black/80">
            Press the button to get the occasional email about offers, holiday hours or scam
            warnings again. Every one has an unsubscribe link.
          </p>
          <div>
            <Button disabled={busy} onClick={() => void confirm()}>
              {busy ? "Saving..." : "Yes, add me back"}
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
