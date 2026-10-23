"use client";
// src/features/mailing/components/MailingListButton.tsx
// Unsubscribe, or ask to resubscribe, on a contact page, for someone who asks by phone or reply.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/**
 * Takes a contact off the mailing list, or emails them a button to confirm coming back,
 * then refreshes the page.
 * @param props - Component props.
 * @param props.contactId - Contact id.
 * @param props.name - Their name, for the toast.
 * @param props.action - Which way.
 * @param props.asked - Whether they've been emailed to confirm already.
 * @returns Button element.
 */
export function MailingListButton({
  contactId,
  name,
  action,
  asked = false,
}: {
  contactId: string;
  name: string;
  action: "unsubscribe" | "ask-resubscribe";
  asked?: boolean;
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
        : `Sent ${name} an email to confirm. They're back on the list once they press the button in it.`,
      { tone: "success" },
    );
    router.refresh();
  }

  return (
    <AdminButton size="xs" variant="secondary" busy={busy} onClick={() => void move()}>
      {action === "unsubscribe" ? "Unsubscribe" : asked ? "Ask again" : "Ask to resubscribe"}
    </AdminButton>
  );
}
