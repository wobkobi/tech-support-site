"use client";
// src/features/reviews/components/admin/AllowReviewAsksButton.tsx
// "Allow again" on a contact page, for someone who opted out of review asks and has
// since said asking is fine.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { apiFetch } from "@/shared/lib/api-client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/**
 * Clears a contact's review-ask opt-out.
 * @param props - Component props.
 * @param props.contactId - Contact id.
 * @returns Button element.
 */
export function AllowReviewAsksButton({ contactId }: { contactId: string }): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  /** Removes the opt-out and refreshes the page. */
  async function allow(): Promise<void> {
    setBusy(true);
    const res = await apiFetch(`/api/admin/contacts/${contactId}/review-ask-opt-out`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast("Review asks allowed again.", { tone: "success" });
    router.refresh();
  }

  return (
    <AdminButton size="xs" variant="secondary" busy={busy} onClick={() => void allow()}>
      Allow again
    </AdminButton>
  );
}
