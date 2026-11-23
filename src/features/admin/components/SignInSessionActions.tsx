// src/features/admin/components/SignInSessionActions.tsx
// Sign-out buttons for the Sign-ins page: one device, or every device but this one. Both confirm
// first, then refresh the page so the session list updates.

"use client";

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link SignOutSessionButton}. */
interface SignOutSessionButtonProps {
  /**
   * Sign-in-log row id of the session to end, or "others" for every session but this one.
   */
  target: string;
  /** Device name shown in the confirm dialog (single-session mode). */
  device?: string;
}

/**
 * A sign-out button with its confirm dialog.
 * @param props - Component props.
 * @param props.target - Row id to sign out, or "others".
 * @param props.device - Device name for the confirm text.
 * @returns The button element.
 */
export function SignOutSessionButton({
  target,
  device,
}: SignOutSessionButtonProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = target === "others";

  /** Sends the sign-out, then refreshes the list. */
  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sign-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { action: "others" } : { action: "one", id: target }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(data?.error ?? `Sign-out failed (${res.status}).`, { tone: "error" });
        return;
      }
      toast(all ? "Every other device is signed out." : "Signed out.", { tone: "success" });
      setOpen(false);
      router.refresh();
    } catch {
      toast("Network error.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminButton variant={all ? "danger" : "outline"} size="sm" onClick={() => setOpen(true)}>
        {all ? "Sign out all other devices" : "Sign out"}
      </AdminButton>
      <ConfirmDialog
        open={open}
        title={all ? "Sign out all other devices?" : `Sign out ${device ?? "this device"}?`}
        body={
          all
            ? "Every device except this one has to sign in again, including any not on this list. An open page there goes to the sign-in screen on its next click or reload."
            : "It has to sign in again with the admin secret. An open page there goes to the sign-in screen on its next click or reload."
        }
        confirmLabel="Sign out"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
