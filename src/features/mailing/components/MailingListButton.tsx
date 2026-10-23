"use client";
// src/features/mailing/components/MailingListButton.tsx
// Unsubscribe or Resubscribe on a contact page, for someone who asks by phone or reply.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/**
 * Takes a contact off the mailing list or puts them back, then refreshes the page.
 * @param props - Component props.
 * @param props.contactId - Contact id.
 * @param props.name - Their name, for the toast.
 * @param props.action - Which way.
 * @returns Button element.
 */
export function MailingListButton({
  contactId,
  name,
  action,
}: {
  contactId: string;
  name: string;
  action: "unsubscribe" | "resubscribe";
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  /** Sends the change through the opt-outs route. */
  async function move(): Promise<void> {
    setBusy(true);
    const res = await callApi("/api/admin/mailing/opt-outs", "POST", { action, contactId });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(
      action === "unsubscribe"
        ? `${name} won't get mailing-list emails.`
        : `${name} is back on the list.`,
      { tone: "success" },
    );
    router.refresh();
  }

  return (
    <AdminButton size="xs" variant="secondary" busy={busy} onClick={() => void move()}>
      {action === "unsubscribe" ? "Unsubscribe" : "Resubscribe"}
    </AdminButton>
  );
}
